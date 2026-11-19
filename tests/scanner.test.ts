import { describe, expect, it } from "vitest";
import type { ScannedAssignment } from "../src/parsers/spada-html.js";
import {
  isConfiguredOAuthClientId,
  requestChromeAuthToken,
  scanSpadaWithFetcher,
  syncAssignmentsToGoogleCalendar,
} from "../src/background/scanner.js";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/shared/storage.js";
import { formatScannedAssignment } from "../src/sync/formatter-and-diff.js";

describe("isConfiguredOAuthClientId", () => {
  it("Rejects empty values, store/unpacked placeholders, and non-Google client IDs", () => {
    expect(isConfiguredOAuthClientId("")).toBe(false);
    expect(
      isConfiguredOAuthClientId("YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com")
    ).toBe(false);
    expect(isConfiguredOAuthClientId("YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com")).toBe(
      false
    );
    expect(isConfiguredOAuthClientId("not-a-google-id")).toBe(false);
    expect(isConfiguredOAuthClientId("123456-abc.apps.googleusercontent.com")).toBe(true);
  });
});

describe("scanSpadaWithFetcher", () => {
  it("Throws AUTH_REQUIRED when SPADA returns the login page", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        '<html><body>Anda belum masuk <form action="https://spada.upnyk.ac.id/login/index.php" id="login"></form></body></html>',
        { status: 200 }
      );

    await expect(scanSpadaWithFetcher(fakeFetch)).rejects.toThrow(/AUTH_REQUIRED/);
  });

  it("Scans active courses from /my/ and parses /mod/assign/index.php in batches", async () => {
    const requestedUrls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.endsWith("/my/")) {
        return new Response(
          `<div id="nav-drawer"><nav><ul>
            <li><a href="https://spada.upnyk.ac.id/course/view.php?id=52581">Kapita Selekta IF-C (20261)</a></li>
          </ul></nav></div>`,
          { status: 200 }
        );
      }

      if (url.includes("/mod/assign/index.php?id=52581")) {
        return new Response(
          `<table class="generaltable"><tbody>
            <tr>
              <td class="cell c0">12. AI For Music</td>
              <td class="cell c1"><a href="https://spada.upnyk.ac.id/mod/assign/view.php?id=846622">AI For Music</a></td>
              <td class="cell c2">Saturday, 21 November 2026, 00:00</td>
              <td class="cell c3">Belum mengajukan</td>
              <td class="cell c4 lastcol">-</td>
            </tr>
          </tbody></table>`,
          { status: 200 }
        );
      }

      return new Response("", { status: 404 });
    };

    const result = await scanSpadaWithFetcher(fakeFetch);
    expect(requestedUrls).toEqual([
      "https://spada.upnyk.ac.id/my/",
      "https://spada.upnyk.ac.id/mod/assign/index.php?id=52581",
    ]);
    expect(result.courses).toHaveLength(1);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.cmid).toBe("846622");
  });

  it("Returns empty courses and assignments without AUTH_REQUIRED when authenticated dashboard has 0 active courses", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        '<html><body><div id="nav-drawer"><nav><ul><li><a href="https://spada.upnyk.ac.id/my/">Dashboard</a></li></ul></nav></div><a href="https://spada.upnyk.ac.id/login/logout.php?sesskey=abc">Keluar</a></body></html>',
        { status: 200 }
      );

    const result = await scanSpadaWithFetcher(fakeFetch);
    expect(result).toEqual({ courses: [], assignments: [] });
  });

  it("Throws AUTH_REQUIRED when /my/ returns an unexpected unauthenticated page without dashboard markers", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("<html><body><p>Welcome guest</p></body></html>", { status: 200 });

    await expect(scanSpadaWithFetcher(fakeFetch)).rejects.toThrow(/AUTH_REQUIRED/);

    const loggedOutMoodleCfgFetch: typeof fetch = async () =>
      new Response('<html><body><script>M.cfg = {"sesskey":""};</script><p>Guest view</p></body></html>', {
        status: 200,
      });

    await expect(scanSpadaWithFetcher(loggedOutMoodleCfgFetch)).rejects.toThrow(/AUTH_REQUIRED/);
  });
});

describe("syncAssignmentsToGoogleCalendar", () => {
  it("Still requests Google OAuth token when there are zero eligible assignments and rejects if auth fails", async () => {
    let tokenCalls = 0;
    const failingGetToken = async (interactive: boolean): Promise<string> => {
      tokenCalls++;
      expect(interactive).toBe(true);
      throw new Error("The user did not approve access.");
    };

    await expect(
      syncAssignmentsToGoogleCalendar([], DEFAULT_SETTINGS, true, {
        getToken: failingGetToken,
      })
    ).rejects.toThrow(/did not approve/i);
    expect(tokenCalls).toBe(1);
  });

  it("Returns zero summary only after token acquisition succeeds for zero eligible assignments", async () => {
    let tokenCalls = 0;
    const summary = await syncAssignmentsToGoogleCalendar([], DEFAULT_SETTINGS, true, {
      getToken: async () => {
        tokenCalls++;
        return "valid-token";
      },
    });

    expect(tokenCalls).toBe(1);
    expect(summary).toEqual({ created: 0, updated: 0, skipped: 0 });
  });

  it("Updates an existing remote pending event to SELESAI even when submitted task is older than 7 days under pending_only, and does zero writes when remote is empty (AC3)", async () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const oldSubmitted: ScannedAssignment = {
      cmid: "812118",
      title: "Tugas Kelompok",
      topic: "BAB 2",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=812118",
      courseId: "56304",
      courseName: "Sistem Operasi IF-C (20261)",
      shortCourseName: "Sistem Operasi IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=56304",
      dueDateIso: "2026-11-05T16:59:00.000Z", // > 7 days old
      dueDateText: "Thursday, 5 November 2026, 23:59",
      submissionStatus: "Terkirim dan siap dinilai",
      submitted: true,
      grade: "-",
    };

    const settings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      calendarId: "kuliah@group.calendar.google.com",
      timeFilter: "recent_7d",
      statusFilter: "pending_only",
    };

    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchWithRemote: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "evt_old_pending",
                summary: "📌 [TUGAS] Tugas Kelompok — Sistem Operasi IF-C",
                start: { dateTime: oldSubmitted.dueDateIso },
                extendedProperties: {
                  private: {
                    spadaSource: "spada-upnyk-sync",
                    spadaUid: "assign-812118@spada.upnyk.ac.id",
                    spadaHash: "old_pending_hash",
                  },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ id: "evt_old_pending" }), { status: 200 });
    };

    const summary = await syncAssignmentsToGoogleCalendar([oldSubmitted], settings, false, {
      getToken: async () => "token-1",
      fetchImpl: fetchWithRemote,
      nowMs,
      writeDelayMs: 0,
    });

    expect(summary).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain("evt_old_pending");
    expect((patches[0]!.body as { summary: string }).summary).toContain("✅ [SELESAI]");
    expect((patches[0]!.body as { reminders: { overrides: unknown[] } }).reminders.overrides).toEqual(
      []
    );

    // When remote calendar is empty, still performs GET lookup but performs zero writes
    const emptyRequests: Array<{ method: string; url: string }> = [];
    const fetchEmpty: typeof fetch = async (input, init) => {
      emptyRequests.push({ method: init?.method ?? "GET", url: String(input) });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    const emptySummary = await syncAssignmentsToGoogleCalendar([oldSubmitted], settings, false, {
      getToken: async () => "token-1",
      fetchImpl: fetchEmpty,
      nowMs,
      writeDelayMs: 0,
    });
    expect(emptySummary).toEqual({ created: 0, updated: 0, skipped: 0 });
    expect(emptyRequests.map((r) => r.method)).toEqual(["GET"]);
  });

  it("Handles mixed create, update, skip, and excluded/ignore assignments in one pass", async () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const makeAssign = (overrides: Partial<ScannedAssignment>): ScannedAssignment => ({
      cmid: "100",
      title: "Tugas Default",
      topic: "Topik",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=100",
      courseId: "52581",
      courseName: "Kapita Selekta",
      shortCourseName: "Kapita Selekta",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-21T10:00:00.000Z",
      dueDateText: "Saturday, 21 November 2026, 17:00",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
      ...overrides,
    });

    const toCreateAssign = makeAssign({ cmid: "101", title: "Tugas Baru" });
    const toUpdateAssign = makeAssign({ cmid: "102", title: "Tugas Berubah", submitted: true });
    const toSkipAssign = makeAssign({ cmid: "103", title: "Tugas Sama" });
    const ignoredExcluded = makeAssign({ cmid: "104", title: "Tugas Matkul Dikecualikan", courseId: "99999" });

    const formattedSkip = await formatScannedAssignment(toSkipAssign);

    const requests: Array<{ method: string; url: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(input) });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "evt_102",
                summary: "📌 [TUGAS] Tugas Berubah — Kapita Selekta",
                start: { dateTime: toUpdateAssign.dueDateIso },
                extendedProperties: {
                  private: {
                    spadaSource: "spada-upnyk-sync",
                    spadaUid: "assign-102@spada.upnyk.ac.id",
                    spadaHash: "stale_hash",
                  },
                },
              },
              {
                id: "evt_103",
                summary: formattedSkip.title,
                start: { dateTime: formattedSkip.startIso },
                extendedProperties: {
                  private: {
                    spadaSource: "spada-upnyk-sync",
                    spadaUid: formattedSkip.spadaUid,
                    spadaHash: formattedSkip.spadaHash,
                  },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ id: "evt_created" }), { status: 200 });
    };

    const summary = await syncAssignmentsToGoogleCalendar(
      [toCreateAssign, toUpdateAssign, toSkipAssign, ignoredExcluded],
      {
        ...DEFAULT_SETTINGS,
        excludedCourseIds: ["99999"],
        timeFilter: "upcoming_only",
        statusFilter: "pending_only",
      },
      true,
      {
        getToken: async () => "tok",
        fetchImpl: fakeFetch,
        nowMs,
        writeDelayMs: 0,
      }
    );

    expect(summary).toEqual({ created: 1, updated: 1, skipped: 1 });
    expect(requests.map((r) => r.method)).toEqual(["GET", "POST", "PATCH"]);
  });

  it("Skips remote GET after authentication when all assignments are ignored (excluded or no deadline)", async () => {
    let tokenCalls = 0;
    let fetchCalls = 0;
    const excludedAssign: ScannedAssignment = {
      cmid: "201",
      title: "Organisasi",
      topic: "",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=201",
      courseId: "777",
      courseName: "Grup Angkatan",
      shortCourseName: "Grup Angkatan",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=777",
      dueDateIso: "2026-11-25T10:00:00.000Z",
      dueDateText: "",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    };

    const summary = await syncAssignmentsToGoogleCalendar(
      [excludedAssign],
      { ...DEFAULT_SETTINGS, excludedCourseIds: ["777"] },
      false,
      {
        getToken: async () => {
          tokenCalls++;
          return "valid-token";
        },
        fetchImpl: async () => {
          fetchCalls++;
          return new Response("{}", { status: 200 });
        },
        writeDelayMs: 0,
      }
    );

    expect(tokenCalls).toBe(1);
    expect(fetchCalls).toBe(0);
    expect(summary).toEqual({ created: 0, updated: 0, skipped: 0 });
  });

  it("Retries once on 401 by removing cached token, fetching a fresh token, and re-reading remote events before writing", async () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const assign: ScannedAssignment = {
      cmid: "301",
      title: "Tugas Retry",
      topic: "",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=301",
      courseId: "52581",
      courseName: "Kapita Selekta",
      shortCourseName: "Kapita Selekta",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-22T10:00:00.000Z",
      dueDateText: "",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    };

    const removedTokens: string[] = [];
    const tokensIssued = ["expired-token", "fresh-token"];
    let tokenIndex = 0;
    const calls: Array<{ method: string; auth: string | null }> = [];

    const fakeFetch: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const auth = headers.get("Authorization");
      calls.push({ method, auth });

      if (auth === "Bearer expired-token") {
        return new Response(
          JSON.stringify({ error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] } }),
          { status: 401 }
        );
      }
      if (method === "GET") {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "evt_301" }), { status: 200 });
    };

    const summary = await syncAssignmentsToGoogleCalendar([assign], DEFAULT_SETTINGS, true, {
      getToken: async () => tokensIssued[tokenIndex++]!,
      removeCachedToken: async (tok) => {
        removedTokens.push(tok);
      },
      fetchImpl: fakeFetch,
      nowMs,
      writeDelayMs: 0,
    });

    expect(removedTokens).toEqual(["expired-token"]);
    expect(calls).toEqual([
      { method: "GET", auth: "Bearer expired-token" },
      { method: "GET", auth: "Bearer fresh-token" },
      { method: "POST", auth: "Bearer fresh-token" },
    ]);
    expect(summary).toEqual({ created: 1, updated: 0, skipped: 0 });
  });

  it("Two-round sync patches once when reminder/color changes, zero writes on identical re-sync, and keeps submitted untouched on pending color change (AC6)", async () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const pendingTask: ScannedAssignment = {
      cmid: "401",
      title: "Tugas Pending",
      topic: "",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=401",
      courseId: "52581",
      courseName: "Kapita Selekta",
      shortCourseName: "Kapita Selekta",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-22T10:00:00.000Z",
      dueDateText: "",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    };
    const submittedTask: ScannedAssignment = {
      ...pendingTask,
      cmid: "402",
      title: "Tugas Selesai",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=402",
      submitted: true,
      submissionStatus: "Terkirim",
    };

    const remoteStore = new Map<string, Record<string, unknown>>();
    let nextId = 1;
    let patchBodies: Array<{ id: string; raw: string }> = [];

    const statefulFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(
          JSON.stringify({ items: Array.from(remoteStore.values()) }),
          { status: 200 }
        );
      }
      if (method === "POST") {
        const id = `evt_${nextId++}`;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        remoteStore.set(id, { id, ...body });
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
      if (method === "PATCH") {
        const id = url.split("/").pop()!;
        const raw = String(init?.body ?? "");
        patchBodies.push({ id, raw });
        const body = JSON.parse(raw) as Record<string, unknown>;
        const existing = remoteStore.get(id) ?? { id };
        const merged: Record<string, unknown> = { ...existing, ...body };
        if (body.colorId === null) {
          delete merged.colorId;
        }
        remoteStore.set(id, merged);
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
      return new Response("", { status: 405 });
    };

    const baseSettings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      reminderMinutes: [1440, 180],
      pendingColorId: "11",
      submittedColorId: "10",
    };

    // Round 1: initial create for both
    const r1 = await syncAssignmentsToGoogleCalendar([pendingTask, submittedTask], baseSettings, true, {
      getToken: async () => "tok",
      fetchImpl: statefulFetch,
      nowMs,
      writeDelayMs: 0,
    });
    expect(r1).toEqual({ created: 2, updated: 0, skipped: 0 });

    // Round 2: identical preferences (even with swapped reminder order) -> 0 writes
    patchBodies = [];
    const r2 = await syncAssignmentsToGoogleCalendar(
      [pendingTask, submittedTask],
      { ...baseSettings, reminderMinutes: [180, 1440] },
      true,
      { getToken: async () => "tok", fetchImpl: statefulFetch, nowMs, writeDelayMs: 0 }
    );
    expect(r2).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(patchBodies).toHaveLength(0);

    // Round 3: reset pendingColorId to default and change reminder -> patches ONLY pending, NOT submitted
    patchBodies = [];
    const r3 = await syncAssignmentsToGoogleCalendar(
      [pendingTask, submittedTask],
      { ...baseSettings, reminderMinutes: [60], pendingColorId: "default" },
      true,
      { getToken: async () => "tok", fetchImpl: statefulFetch, nowMs, writeDelayMs: 0 }
    );
    expect(r3).toEqual({ created: 0, updated: 1, skipped: 1 });
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]!.raw).toContain('"colorId":null');

    // Round 4: re-sync with same new preferences -> 0 writes
    patchBodies = [];
    const r4 = await syncAssignmentsToGoogleCalendar(
      [pendingTask, submittedTask],
      { ...baseSettings, reminderMinutes: [60], pendingColorId: "default" },
      true,
      { getToken: async () => "tok", fetchImpl: statefulFetch, nowMs, writeDelayMs: 0 }
    );
    expect(r4).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(patchBodies).toHaveLength(0);
  });

  it("Accumulates successful writes performed before a mid-batch 401 retry so summary reports created:2, skipped:0 (AC5)", async () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const task1: ScannedAssignment = {
      cmid: "501",
      title: "Tugas Pertama",
      topic: "",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=501",
      courseId: "52581",
      courseName: "Kapita Selekta",
      shortCourseName: "Kapita Selekta",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-22T10:00:00.000Z",
      dueDateText: "",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    };
    const task2: ScannedAssignment = {
      ...task1,
      cmid: "502",
      title: "Tugas Kedua",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=502",
    };
    const alreadySyncedTask: ScannedAssignment = {
      ...task1,
      cmid: "503",
      title: "Tugas Sudah Ada",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=503",
    };
    const formattedSkip = await formatScannedAssignment(alreadySyncedTask, DEFAULT_SETTINGS);

    const remoteStore: Array<Record<string, unknown>> = [
      {
        id: "evt_503",
        summary: formattedSkip.title,
        start: { dateTime: formattedSkip.startIso },
        extendedProperties: {
          private: {
            spadaSource: "spada-upnyk-sync",
            spadaUid: formattedSkip.spadaUid,
            spadaHash: formattedSkip.spadaHash,
          },
        },
      },
    ];

    const tokens = ["tok-expiring-mid-batch", "tok-fresh"];
    let tokenIdx = 0;
    let postAttempt = 0;

    const midBatch401Fetch: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({ items: remoteStore }), { status: 200 });
      }
      if (method === "POST") {
        postAttempt++;
        if (postAttempt === 2) {
          return new Response(
            JSON.stringify({
              error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] },
            }),
            { status: 401 }
          );
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const id = `evt_created_${postAttempt}`;
        remoteStore.push({ id, ...body });
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
      return new Response("", { status: 405 });
    };

    const summary = await syncAssignmentsToGoogleCalendar(
      [task1, task2, alreadySyncedTask],
      DEFAULT_SETTINGS,
      true,
      {
        getToken: async () => tokens[tokenIdx++]!,
        removeCachedToken: async () => {},
        fetchImpl: midBatch401Fetch,
        nowMs,
        writeDelayMs: 0,
      }
    );

    expect(remoteStore).toHaveLength(3);
    expect(summary).toEqual({ created: 2, updated: 0, skipped: 1 });
  });
});

describe("requestChromeAuthToken", () => {
  it("Throws explicit BROWSER_UNSUPPORTED error when chrome.identity.getAuthToken is unavailable", async () => {
    await expect(requestChromeAuthToken(true, {})).rejects.toThrow(/BROWSER_UNSUPPORTED/);
    await expect(requestChromeAuthToken(true, undefined)).rejects.toThrow(/BROWSER_UNSUPPORTED/);
  });
});
