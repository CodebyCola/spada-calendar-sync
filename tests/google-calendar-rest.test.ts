import { describe, expect, it } from "vitest";
import {
  createRemoteEvent,
  GoogleCalendarApiError,
  listRemoteSpadaEvents,
  listWritableCalendars,
  patchRemoteEvent,
  toGoogleCalendarPayload,
} from "../src/calendar/google-calendar-rest.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { formatScannedAssignment } from "../src/sync/formatter-and-diff.js";

describe("toGoogleCalendarPayload", () => {
  it("Builds Google Calendar v3 event payload with popup reminders for pending assignments and none for submitted", async () => {
    const pending = await formatScannedAssignment({
      cmid: "846622",
      title: "AI For Music",
      topic: "12. AI For Music",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=846622",
      courseId: "52581",
      courseName: "Kapita Selekta IF-C (20261)",
      shortCourseName: "Kapita Selekta IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      dueDateText: "Saturday, 21 November 2026, 00:00",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    });

    const payload = toGoogleCalendarPayload(pending);
    expect(payload.summary).toBe("📌 [TUGAS] AI For Music — Kapita Selekta IF-C");
    expect(payload.start).toEqual({
      dateTime: "2026-11-20T17:00:00.000Z",
      timeZone: "Asia/Jakarta",
    });
    expect(payload.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 1440 },
        { method: "popup", minutes: 180 },
      ],
    });
    expect(payload.extendedProperties.private.spadaUid).toBe(
      "assign-846622@spada.upnyk.ac.id"
    );

    const submitted = await formatScannedAssignment({
      cmid: "814603",
      title: "Unggah Laporan Pemateri 1",
      topic: "2",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=814603",
      courseId: "52581",
      courseName: "Kapita Selekta IF-C (20261)",
      shortCourseName: "Kapita Selekta IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-09-05T17:00:00.000Z",
      dueDateText: "Sunday, 6 September 2026, 00:00",
      submissionStatus: "Terkirim dan siap dinilai",
      submitted: true,
      grade: "-",
    });

    const submittedPayload = toGoogleCalendarPayload(submitted, "1444125@spada.upnyk.ac.id");
    expect(submittedPayload.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(submittedPayload.extendedProperties.private.spadaUid).toBe(
      "1444125@spada.upnyk.ac.id"
    );
  });

  it("Omits colorId on insert for default color, serializes colorId:null on patch, and sends custom reminders/colors over transport (AC6)", async () => {
    const sample = {
      cmid: "846622",
      title: "AI For Music",
      topic: "12. AI For Music",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=846622",
      courseId: "52581",
      courseName: "Kapita Selekta IF-C (20261)",
      shortCourseName: "Kapita Selekta IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      dueDateText: "Saturday, 21 November 2026, 00:00",
      submissionStatus: "Belum mengajukan",
      submitted: false,
      grade: "-",
    };

    const defaultColored = await formatScannedAssignment(sample, {
      ...DEFAULT_SETTINGS,
      reminderMinutes: [],
      pendingColorId: "default",
    });

    const sentBodies: string[] = [];
    const captureFetch: typeof fetch = async (_input, init) => {
      sentBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: "evt_1" }), { status: 200 });
    };

    await createRemoteEvent("tok", "primary", defaultColored, captureFetch);
    await patchRemoteEvent(
      "tok",
      "primary",
      "evt_1",
      defaultColored,
      "1444125@spada.upnyk.ac.id",
      captureFetch
    );

    const insertJson = JSON.parse(sentBodies[0]!) as Record<string, unknown>;
    expect("colorId" in insertJson).toBe(false);
    expect(insertJson.reminders).toEqual({ useDefault: false, overrides: [] });

    expect(sentBodies[1]).toContain('"colorId":null');
    const patchJson = JSON.parse(sentBodies[1]!) as Record<string, unknown>;
    expect(patchJson.colorId).toBeNull();
    expect(
      (patchJson.extendedProperties as { private: { spadaUid: string } }).private.spadaUid
    ).toBe("1444125@spada.upnyk.ac.id");

    // Explicit color & custom reminders
    const customColored = await formatScannedAssignment(sample, {
      ...DEFAULT_SETTINGS,
      reminderMinutes: [60, 4320, 360],
      pendingColorId: "11",
    });
    const customInsert = toGoogleCalendarPayload(customColored, undefined, "insert");
    expect(customInsert.colorId).toBe("11");
    expect(customInsert.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 4320 },
        { method: "popup", minutes: 360 },
        { method: "popup", minutes: 60 },
      ],
    });
  });
});

describe("listRemoteSpadaEvents", () => {
  it("Paginates Google Calendar REST API results and extracts spada metadata", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      calls++;
      const url = String(input);
      if (!url.includes("pageToken=next2")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "ev1",
                summary: "Task 1",
                start: { dateTime: "2026-11-20T17:00:00Z" },
                extendedProperties: {
                  private: {
                    spadaSource: "spada-upnyk-sync",
                    spadaUid: "assign-1@spada.upnyk.ac.id",
                    spadaHash: "hash1",
                  },
                },
              },
            ],
            nextPageToken: "next2",
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          items: [
            {
              id: "ev2",
              summary: "Task 2",
              start: { dateTime: "2026-11-21T17:00:00Z" },
              extendedProperties: {
                private: {
                  spadaSource: "spada-upnyk-sync",
                  spadaUid: "assign-2@spada.upnyk.ac.id",
                  spadaHash: "hash2",
                },
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const events = await listRemoteSpadaEvents("fake_token", "primary", fakeFetch);
    expect(calls).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[1]!.spadaUid).toBe("assign-2@spada.upnyk.ac.id");
  });

  it("Preserves service, HTTP status, and Google error reason in GoogleCalendarApiError message", async () => {
    const rateLimitFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "Rate Limit Exceeded",
            errors: [{ domain: "usageLimits", reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }],
          },
        }),
        { status: 403, statusText: "Forbidden" }
      );

    let caught: unknown;
    try {
      await listRemoteSpadaEvents("fake_token", "primary", rateLimitFetch);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GoogleCalendarApiError);
    const apiErr = caught as GoogleCalendarApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.reason).toBe("rateLimitExceeded");
    expect(apiErr.message).toBe("GCAL HTTP 403 [rateLimitExceeded]: Rate Limit Exceeded");
  });

  it("Falls back cleanly without JSON SyntaxError for plain-text error responses", async () => {
    const gatewayFetch: typeof fetch = async () =>
      new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" });

    let caught: unknown;
    try {
      await listRemoteSpadaEvents("fake_token", "primary", gatewayFetch);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GoogleCalendarApiError);
    const apiErr = caught as GoogleCalendarApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.reason).toBeUndefined();
    expect(apiErr.message).toBe("GCAL HTTP 502: Bad Gateway");
  });
});

describe("listWritableCalendars (AC7, AC9)", () => {
  it("Paginates across multiple pages including empty intermediate page, filters owner/writer only, deduplicates IDs, preserves identical names, prioritizes primary, and uses summaryOverride -> summary -> id", async () => {
    const requestedUrls: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer list-tok");

      if (!url.includes("pageToken=")) {
        return new Response(
          JSON.stringify({
            items: [
              { id: "cal-z", summary: "Tugas Kuliah", accessRole: "writer" },
              { id: "cal-reader", summary: "Hari Libur Indonesia", accessRole: "reader" },
              { id: "cal-freebusy", summary: "Teman", accessRole: "freeBusyReader" },
              { id: "   ", summary: "ID Kosong", accessRole: "owner" },
              { id: "cal-a", summary: "Tugas Kuliah", accessRole: "owner" },
            ],
            nextPageToken: "page-empty",
          }),
          { status: 200 }
        );
      }

      if (url.includes("pageToken=page-empty")) {
        return new Response(
          JSON.stringify({
            items: [],
            nextPageToken: "page-3",
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          items: [
            { id: "cal-a", summary: "Duplikat Harus Dibuang", accessRole: "owner" },
            {
              id: "user@gmail.com",
              summary: "Kalender Asli",
              summaryOverride: "Kalender Utama Saya",
              accessRole: "owner",
              primary: true,
            },
            { id: "cal-no-label@group.calendar.google.com", summary: "   ", accessRole: "writer" },
          ],
        }),
        { status: 200 }
      );
    };

    const calendars = await listWritableCalendars("list-tok", fakeFetch);

    expect(requestedUrls).toHaveLength(3);
    expect(requestedUrls[0]).toContain("minAccessRole=writer");
    expect(calendars).toEqual([
      { id: "user@gmail.com", label: "Kalender Utama Saya", primary: true },
      {
        id: "cal-no-label@group.calendar.google.com",
        label: "cal-no-label@group.calendar.google.com",
        primary: false,
      },
      { id: "cal-a", label: "Tugas Kuliah", primary: false },
      { id: "cal-z", label: "Tugas Kuliah", primary: false },
    ]);
  });

  it("Throws GoogleCalendarApiError when page 2 fails instead of returning a partial list", async () => {
    let page = 0;
    const failingPage2Fetch: typeof fetch = async () => {
      page++;
      if (page === 1) {
        return new Response(
          JSON.stringify({
            items: [{ id: "cal-1", summary: "Page 1", accessRole: "owner" }],
            nextPageToken: "p2",
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          error: {
            message: "Rate Limit Exceeded",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        }),
        { status: 403 }
      );
    };

    await expect(listWritableCalendars("tok", failingPage2Fetch)).rejects.toMatchObject({
      name: "GoogleCalendarApiError",
      status: 403,
      reason: "rateLimitExceeded",
    });
  });
});
