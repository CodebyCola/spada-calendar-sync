import { describe, expect, it } from "vitest";
import {
  isConfiguredOAuthClientId,
  requestChromeAuthToken,
  scanSpadaWithFetcher,
  syncAssignmentsToGoogleCalendar,
} from "../src/background/scanner.js";
import { DEFAULT_SETTINGS } from "../src/shared/storage.js";

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
});

describe("requestChromeAuthToken", () => {
  it("Throws explicit BROWSER_UNSUPPORTED error when chrome.identity.getAuthToken is unavailable", async () => {
    await expect(requestChromeAuthToken(true, {})).rejects.toThrow(/BROWSER_UNSUPPORTED/);
    await expect(requestChromeAuthToken(true, undefined)).rejects.toThrow(/BROWSER_UNSUPPORTED/);
  });
});
