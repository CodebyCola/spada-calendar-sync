import { describe, expect, it } from "vitest";
import { GoogleCalendarApiError } from "../src/calendar/google-calendar-rest.js";
import { diagnoseSetupError, evaluateSetupStatus } from "../src/setup/setup-diagnostics.js";
import { DEFAULT_SETTINGS, type StoredExtensionState } from "../src/shared/storage.js";

function makeState(overrides: Partial<StoredExtensionState> = {}): StoredExtensionState {
  return {
    courses: [],
    assignments: [],
    lastScanAt: null,
    lastScanError: null,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastSyncError: null,
    googleConnected: false,
    googleAuthVerified: false,
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

describe("diagnoseSetupError", () => {
  it("Classifies SPADA HTTP 403 as SPADA_ACCESS_DENIED instead of Google OAuth consent", () => {
    const result = diagnoseSetupError(
      "SPADA HTTP 403 untuk https://spada.upnyk.ac.id/mod/assign/index.php?id=52581"
    );
    expect(result.code).toBe("SPADA_ACCESS_DENIED");
    expect(result.hint).toMatch(/SPADA/i);
    expect(result.hint).not.toMatch(/OAuth|Advanced/i);
  });

  it("Classifies SPADA HTTP 401 and AUTH_REQUIRED as SPADA_AUTH_REQUIRED", () => {
    expect(diagnoseSetupError("SPADA HTTP 401 untuk https://spada.upnyk.ac.id/my/").code).toBe(
      "SPADA_AUTH_REQUIRED"
    );
    expect(
      diagnoseSetupError("AUTH_REQUIRED: Silakan login ke SPADA UPNYK terlebih dahulu.").code
    ).toBe("SPADA_AUTH_REQUIRED");
  });

  it("Matches specific OAuth access_denied before generic OAuth2 request failed", () => {
    expect(diagnoseSetupError("OAuth2 request failed: access_denied").code).toBe(
      "OAUTH_ACCESS_DENIED"
    );
    expect(diagnoseSetupError("OAuth2 request failed: bad client id").code).toBe(
      "OAUTH_CLIENT_MISMATCH"
    );
    expect(diagnoseSetupError("The user did not approve access.").code).toBe("OAUTH_CANCELLED");
    expect(diagnoseSetupError("OAuth2 not granted or revoked.").code).toBe("OAUTH_CANCELLED");
  });

  it("Classifies Google Calendar 403/429 rate limits as GCAL_RATE_LIMITED from real GoogleCalendarApiError messages", () => {
    const rateLimitErr = new GoogleCalendarApiError(403, "Rate Limit Exceeded", "rateLimitExceeded");
    const diagnosis = diagnoseSetupError(rateLimitErr.message);
    expect(diagnosis.code).toBe("GCAL_RATE_LIMITED");
    expect(diagnosis.hint).toMatch(/tunggu|coba/i);
    expect(diagnosis.hint).not.toMatch(/Advanced|OAuth/i);

    const tooManyErr = new GoogleCalendarApiError(429, "Too Many Requests", "userRateLimitExceeded");
    expect(diagnoseSetupError(tooManyErr.message).code).toBe("GCAL_RATE_LIMITED");

    expect(diagnoseSetupError("Rate Limit Exceeded").code).toBe("GCAL_RATE_LIMITED");
  });

  it("Classifies non-rate-limit Google Calendar HTTP 403, 404, 401, and 502 accurately", () => {
    expect(
      diagnoseSetupError(
        new GoogleCalendarApiError(403, "Insufficient Permission", "insufficientPermissions").message
      ).code
    ).toBe("OAUTH_ACCESS_DENIED");

    expect(
      diagnoseSetupError(new GoogleCalendarApiError(404, "Not Found", "notFound").message).code
    ).toBe("GCAL_CALENDAR_NOT_FOUND");

    expect(
      diagnoseSetupError(new GoogleCalendarApiError(401, "Invalid Credentials").message).code
    ).toBe("OAUTH_CANCELLED");

    expect(diagnoseSetupError(new GoogleCalendarApiError(502, "Bad Gateway").message).code).toBe(
      "NETWORK_OR_SERVER"
    );
  });

  it("Classifies OAUTH_NOT_CONFIGURED, browser sign-in unsupported, network errors, and fallback UNKNOWN", () => {
    expect(diagnoseSetupError("OAUTH_NOT_CONFIGURED: Isi oauth2.client_id").code).toBe(
      "OAUTH_NOT_CONFIGURED"
    );
    expect(diagnoseSetupError("The user is not signed in.").code).toBe("BROWSER_UNSUPPORTED");
    expect(diagnoseSetupError("The user turned off browser signin").code).toBe("BROWSER_UNSUPPORTED");
    expect(diagnoseSetupError("OAuth2 request failed: Service unavailable.").code).toBe(
      "NETWORK_OR_SERVER"
    );
    expect(diagnoseSetupError("OAuth2 request failed: Connection failed (-106).").code).toBe(
      "NETWORK_OR_SERVER"
    );
    expect(diagnoseSetupError("Failed to fetch").code).toBe("NETWORK_OR_SERVER");
    expect(diagnoseSetupError("Unexpected widget explosion").code).toBe("UNKNOWN");
  });
});

describe("evaluateSetupStatus", () => {
  it("Starts at step 1 (spada active) on a fresh install", () => {
    const status = evaluateSetupStatus(makeState(), true);

    expect(status.steps.spada.state).toBe("active");
    expect(status.steps.google.state).toBe("pending");
    expect(status.steps.firstSync.state).toBe("pending");
    expect(status.completedCount).toBe(0);
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(false);
    expect(status.nextStep).toBe("spada");
  });

  it("Marks step 1 done with informative detail when authenticated SPADA dashboard has 0 active courses", () => {
    const status = evaluateSetupStatus(
      makeState({
        lastScanAt: "2026-11-19T00:00:00.000Z",
        courses: [],
        lastScanError: null,
      }),
      true
    );

    expect(status.steps.spada.state).toBe("done");
    expect(status.steps.spada.detail).toMatch(/belum ada mata kuliah/i);
    expect(status.steps.google.state).toBe("active");
    expect(status.steps.firstSync.state).toBe("pending");
    expect(status.nextStep).toBe("google");
  });

  it("Marks Google and firstSync blocked when oauthConfigured is false", () => {
    const status = evaluateSetupStatus(
      makeState({
        lastScanAt: "2026-11-19T00:00:00.000Z",
        courses: [
          {
            courseId: "1",
            courseName: "Algoritma",
            shortCourseName: "Algoritma",
            courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=1",
          },
        ],
      }),
      false
    );

    expect(status.steps.spada.state).toBe("done");
    expect(status.steps.google.state).toBe("blocked");
    expect(status.steps.firstSync.state).toBe("blocked");
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(false);
  });

  it("Requires firstSync for newly connected account B after disconnecting account A", () => {
    // Account A was synced, then disconnected (which clears lastSyncAt), then Account B connected
    const reconnectedB = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      googleConnected: true,
      googleAuthVerified: true,
      lastSyncAt: null,
      lastSyncSummary: null,
    });

    const status = evaluateSetupStatus(reconnectedB, true);
    expect(status.steps.spada.state).toBe("done");
    expect(status.steps.google.state).toBe("done");
    expect(status.steps.firstSync.state).toBe("active");
    expect(status.completedCount).toBe(2);
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(false);
    expect(status.nextStep).toBe("firstSync");
  });

  it("Does not treat legacy unverified googleConnected state as connected or ready", () => {
    const legacyState = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      googleConnected: true,
      googleAuthVerified: false,
      lastSyncAt: "2026-11-19T00:05:00.000Z",
    });

    const status = evaluateSetupStatus(legacyState, true);
    expect(status.steps.google.state).toBe("active");
    expect(status.steps.firstSync.state).toBe("pending");
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(false);
    expect(status.nextStep).toBe("google");
  });

  it("Keeps hasCompletedInitialSetup true on post-setup transient error while flagging step error", () => {
    const transientErrorState = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      lastScanError: "Failed to fetch",
      googleConnected: true,
      googleAuthVerified: true,
      lastSyncAt: "2026-11-19T00:05:00.000Z",
      lastSyncSummary: { created: 3, updated: 0, skipped: 1 },
    });

    const status = evaluateSetupStatus(transientErrorState, true);
    expect(status.steps.spada.state).toBe("error");
    expect(status.steps.google.state).toBe("done");
    expect(status.steps.firstSync.state).toBe("done");
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(true);
  });
});
