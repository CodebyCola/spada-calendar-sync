import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENTS_SCOPES,
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_LIST_SCOPES,
  requestChromeAuthToken,
  revokeAllGoogleTokens,
} from "../src/background/scanner.js";
import { runListWritableCalendars } from "../src/background/calendar-list-handler.js";
import { DEFAULT_SETTINGS, type StoredExtensionState } from "../src/shared/storage.js";

function makeConnectedState(overrides: Partial<StoredExtensionState> = {}): StoredExtensionState {
  return {
    courses: [],
    assignments: [],
    lastScanAt: "2026-11-19T00:00:00.000Z",
    lastScanError: null,
    lastSyncAt: "2026-11-19T00:05:00.000Z",
    lastSyncSummary: { created: 1, updated: 0, skipped: 0 },
    lastSyncError: null,
    googleConnected: true,
    googleAuthVerified: true,
    googleSessionGeneration: 3,
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

describe("Per-operation OAuth scopes and LIST_CALENDARS handler (AC7-AC9)", () => {
  it("Passes explicit calendar.events scope on default requestChromeAuthToken", async () => {
    const capturedCalls: Array<chrome.identity.TokenDetails> = [];
    const token = await requestChromeAuthToken(true, {
      getAuthToken: async (details: chrome.identity.TokenDetails) => {
        capturedCalls.push(details);
        return { token: "events-only-token" };
      },
    } as Partial<typeof chrome.identity>);

    expect(token).toBe("events-only-token");
    expect(capturedCalls).toEqual([
      {
        interactive: true,
        scopes: [...CALENDAR_EVENTS_SCOPES],
      },
    ]);
  });

  it("Silent LIST_CALENDARS requests non-interactive list scope and returns GRANT_REQUIRED when scope is missing without touching lastSyncError", async () => {
    const state = makeConnectedState({ lastSyncError: null });
    const requestedCalls: Array<{ interactive: boolean; scopes: readonly string[] }> = [];

    const res = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async (interactive, scopes) => {
        requestedCalls.push({ interactive, scopes });
        return {
          token: "secret-events-token",
          grantedScopes: [...CALENDAR_EVENTS_SCOPES],
        };
      },
      removeCachedToken: async () => {},
      fetchImpl: async () => {
        throw new Error("Should not call Google API when grantedScopes lacks list scope");
      },
    });

    expect(requestedCalls).toEqual([{ interactive: false, scopes: [...CALENDAR_LIST_SCOPES] }]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("GRANT_REQUIRED");
      expect(JSON.stringify(res)).not.toContain("secret-events-token");
    }
    expect(state.lastSyncError).toBeNull();
  });

  it("Interactive LIST_CALENDARS passes interactive:true and returns strictly {id,label,primary} DTOs without leaking token", async () => {
    const state = makeConnectedState();
    const requestedInteractive: boolean[] = [];

    const res = await runListWritableCalendars(true, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async (interactive, scopes) => {
        requestedInteractive.push(interactive);
        expect(scopes).toEqual([...CALENDAR_LIST_SCOPES]);
        return {
          token: "super-secret-list-token",
          grantedScopes: [...CALENDAR_LIST_SCOPES],
        };
      },
      removeCachedToken: async () => {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "primary-user@gmail.com",
                summary: "Main",
                accessRole: "owner",
                primary: true,
                description: "Extra field must not leak",
              },
            ],
          }),
          { status: 200 }
        ),
    });

    expect(requestedInteractive).toEqual([true]);
    expect(res).toEqual({
      ok: true,
      calendars: [{ id: "primary-user@gmail.com", label: "Main", primary: true }],
    });
    expect(JSON.stringify(res)).not.toContain("super-secret-list-token");
    expect(JSON.stringify(res)).not.toContain("Extra field");
  });

  it("Distinguishes 403 insufficientPermissions from 403 rateLimitExceeded and 429 without writing lastSyncError", async () => {
    const state = makeConnectedState();

    const insufficient = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => ({ token: "tok" }),
      removeCachedToken: async () => {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Insufficient Permission",
              errors: [{ reason: "insufficientPermissions" }],
            },
          }),
          { status: 403 }
        ),
    });
    expect(insufficient.ok).toBe(false);
    if (!insufficient.ok) {
      expect(insufficient.code).toBe("GRANT_REQUIRED");
    }

    const rateLimited = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => ({ token: "tok" }),
      removeCachedToken: async () => {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Rate Limit Exceeded",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          }),
          { status: 403 }
        ),
    });
    expect(rateLimited.ok).toBe(false);
    if (!rateLimited.ok) {
      expect(rateLimited.code).toBe("RATE_LIMITED");
    }

    const tooMany = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => ({ token: "tok" }),
      removeCachedToken: async () => {},
      fetchImpl: async () => new Response("Too Many Requests", { status: 429 }),
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.code).toBe("RATE_LIMITED");
    }

    const plainTextRateLimit = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => ({ token: "tok" }),
      removeCachedToken: async () => {},
      fetchImpl: async () => new Response("Rate Limit Exceeded", { status: 403 }),
    });
    expect(plainTextRateLimit.ok).toBe(false);
    if (!plainTextRateLimit.ok) {
      expect(plainTextRateLimit.code).toBe("RATE_LIMITED");
    }

    const calendarUsageLimit = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => ({ token: "tok" }),
      removeCachedToken: async () => {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Calendar usage limits exceeded.",
              errors: [{ reason: "calendarUsageLimitsExceeded" }],
            },
          }),
          { status: 403 }
        ),
    });
    expect(calendarUsageLimit.ok).toBe(false);
    if (!calendarUsageLimit.ok) {
      expect(calendarUsageLimit.code).toBe("RATE_LIMITED");
    }
    expect(state.lastSyncError).toBeNull();
  });

  it("Retries once on 401 with same interactive mode and stops after second 401 (AC9)", async () => {
    const state = makeConnectedState();
    const removed: string[] = [];
    const tokens = ["tok-1", "tok-2", "tok-3"];
    let idx = 0;
    let fetchCalls = 0;

    const res = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async (interactive) => {
        expect(interactive).toBe(false);
        return { token: tokens[idx++]! };
      },
      removeCachedToken: async (tok) => {
        removed.push(tok);
      },
      fetchImpl: async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({
            error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] },
          }),
          { status: 401 }
        );
      },
    });

    expect(removed).toEqual(["tok-1"]);
    expect(fetchCalls).toBe(2);
    expect(idx).toBe(2);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("LIST_FAILED");
    }
  });

  it("Discards stale calendar list results if account disconnects mid-request (AC9)", async () => {
    let currentState = makeConnectedState({ googleSessionGeneration: 3 });

    const res = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => currentState,
      getTokenDetailed: async () => ({ token: "tok-old" }),
      removeCachedToken: async () => {},
      fetchImpl: async () => {
        // Disconnect happens while fetch is in flight
        currentState = makeConnectedState({
          googleConnected: false,
          googleAuthVerified: false,
          googleSessionGeneration: 4,
        });
        return new Response(
          JSON.stringify({
            items: [{ id: "old-account@gmail.com", summary: "Old", accessRole: "owner", primary: true }],
          }),
          { status: 200 }
        );
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("STALE_SESSION");
    }
  });

  it("Revokes cached tokens for both events and calendarlist scopes best-effort without prompting on disconnect", async () => {
    const requestedScopes: Array<{ interactive: boolean; scopes?: string[] }> = [];
    const removedTokens: string[] = [];
    const revokedUrls: string[] = [];

    await revokeAllGoogleTokens(
      {
        getAuthToken: async (details: chrome.identity.TokenDetails) => {
          requestedScopes.push({ interactive: Boolean(details.interactive), scopes: details.scopes });
          if (details.scopes?.includes(CALENDAR_LIST_READONLY_SCOPE)) {
            return { token: "tok-list" };
          }
          return { token: "tok-events" };
        },
        removeCachedAuthToken: async ({ token }: { token: string }) => {
          removedTokens.push(token);
        },
      } as Partial<typeof chrome.identity>,
      async (input) => {
        revokedUrls.push(String(input));
        return new Response("", { status: 200 });
      }
    );

    expect(requestedScopes).toEqual([
      { interactive: false, scopes: [...CALENDAR_EVENTS_SCOPES] },
      { interactive: false, scopes: [...CALENDAR_LIST_SCOPES] },
    ]);
    expect(removedTokens).toEqual(["tok-events", "tok-list"]);
    expect(revokedUrls).toHaveLength(2);
  });

  it("Classifies Chromium offline OAuth errors as OFFLINE and silent non-grant errors as LIST_FAILED instead of GRANT_REQUIRED (AC9)", async () => {
    const state = makeConnectedState();

    for (const errMsg of [
      "OAuth2 request failed: Service unavailable.",
      "OAuth2 request failed: Connection failed (-106).",
    ]) {
      for (const interactive of [false, true]) {
        const res = await runListWritableCalendars(interactive, {
          oauthConfigured: true,
          getState: async () => state,
          getTokenDetailed: async () => {
            throw new Error(errMsg);
          },
          removeCachedToken: async () => {},
        });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe("OFFLINE");
        }
      }
    }

    for (const nonGrantErr of [
      "Bad client id: 123.apps.googleusercontent.com",
      "The user is not signed in.",
    ]) {
      const res = await runListWritableCalendars(false, {
        oauthConfigured: true,
        getState: async () => state,
        getTokenDetailed: async () => {
          throw new Error(nonGrantErr);
        },
        removeCachedToken: async () => {},
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("LIST_FAILED");
      }
    }

    // Genuine silent missing-grant error still returns GRANT_REQUIRED
    const genuineGrant = await runListWritableCalendars(false, {
      oauthConfigured: true,
      getState: async () => state,
      getTokenDetailed: async () => {
        throw new Error("OAuth2 not granted or revoked.");
      },
      removeCachedToken: async () => {},
    });
    expect(genuineGrant.ok).toBe(false);
    if (!genuineGrant.ok) {
      expect(genuineGrant.code).toBe("GRANT_REQUIRED");
    }
  });
});
