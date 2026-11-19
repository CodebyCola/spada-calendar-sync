import {
  GoogleCalendarApiError,
  listWritableCalendars,
  type CalendarListItemDto,
} from "../calendar/google-calendar-rest.js";
import type { StoredExtensionState } from "../shared/storage.js";
import {
  CALENDAR_LIST_READONLY_SCOPE,
  CALENDAR_LIST_SCOPES,
  type AuthTokenResult,
} from "./scanner.js";

export type CalendarListErrorCode =
  | "NOT_CONNECTED"
  | "OAUTH_NOT_CONFIGURED"
  | "BROWSER_UNSUPPORTED"
  | "GRANT_REQUIRED"
  | "USER_CANCELLED"
  | "OFFLINE"
  | "RATE_LIMITED"
  | "STALE_SESSION"
  | "LIST_FAILED";

export type ListCalendarsResponse =
  | { ok: true; calendars: CalendarListItemDto[] }
  | { ok: false; code: CalendarListErrorCode; message: string };

export interface ListCalendarsDeps {
  oauthConfigured: boolean;
  getState: () => Promise<StoredExtensionState>;
  getTokenDetailed: (
    interactive: boolean,
    scopes: readonly string[]
  ) => Promise<AuthTokenResult>;
  removeCachedToken: (token: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const NETWORK_ERROR_PATTERN =
  /failed to fetch|network|offline|timeout|timed out|internet|err_connection|err_name_not_resolved|err_network|err_internet|enotfound|service unavailable|connection failed/i;

const USER_CANCEL_PATTERN =
  /did not approve|canceled|cancelled|access_denied|user closed|closed the/i;

const GRANT_REQUIRED_PATTERN =
  /oauth2 not granted|not granted|interaction required|revoked|insufficient.*scope|insufficientPermissions|no token|not approved/i;

const RATE_LIMIT_PATTERN =
  /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|calendarUsageLimitsExceeded|rate limit exceeded|too many requests|quota exceeded/i;

function classifyTokenError(
  err: unknown,
  interactive: boolean
): { ok: false; code: CalendarListErrorCode; message: string } {
  const raw = err instanceof Error ? err.message : String(err);

  if (/BROWSER_UNSUPPORTED|getauthtoken is not a function|identity.*not available/i.test(raw)) {
    return {
      ok: false,
      code: "BROWSER_UNSUPPORTED",
      message: "Browser ini tidak mendukung Chrome Identity API. Gunakan ID kalender manual.",
    };
  }
  if (NETWORK_ERROR_PATTERN.test(raw)) {
    return {
      ok: false,
      code: "OFFLINE",
      message: "Tidak dapat terhubung ke Google. Periksa koneksi internet lalu coba Muat ulang.",
    };
  }
  if (interactive && USER_CANCEL_PATTERN.test(raw)) {
    return {
      ok: false,
      code: "USER_CANCELLED",
      message:
        "Izin daftar kalender dibatalkan. Sinkronisasi event tetap berjalan menggunakan ID kalender manual.",
    };
  }
  if (GRANT_REQUIRED_PATTERN.test(raw) || (!interactive && USER_CANCEL_PATTERN.test(raw))) {
    return {
      ok: false,
      code: "GRANT_REQUIRED",
      message:
        "Izin membaca daftar kalender belum diberikan. Klik 'Izinkan akses daftar kalender' atau isi ID manual.",
    };
  }
  return {
    ok: false,
    code: "LIST_FAILED",
    message: "Gagal mendapatkan izin daftar kalender. Coba lagi atau gunakan ID kalender manual.",
  };
}

function classifyApiError(
  err: unknown
): { ok: false; code: CalendarListErrorCode; message: string } {
  if (err instanceof GoogleCalendarApiError) {
    if (
      err.status === 403 &&
      (err.reason === "insufficientPermissions" ||
        /insufficient.*permission|insufficient.*scope/i.test(err.message))
    ) {
      return {
        ok: false,
        code: "GRANT_REQUIRED",
        message:
          "Izin membaca daftar kalender diperlukan. Klik 'Izinkan akses daftar kalender' atau isi ID manual.",
      };
    }
    if (
      err.status === 429 ||
      (err.status === 403 &&
        (RATE_LIMIT_PATTERN.test(err.reason ?? "") || RATE_LIMIT_PATTERN.test(err.message)))
    ) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Batas permintaan Google Calendar API tercapai. Tunggu sebentar lalu coba Muat ulang.",
      };
    }
    if (err.status === 401) {
      return {
        ok: false,
        code: "LIST_FAILED",
        message:
          "Sesi izin daftar kalender tidak valid. Coba Muat ulang atau gunakan ID kalender manual.",
      };
    }
    return {
      ok: false,
      code: "LIST_FAILED",
      message: `Gagal memuat daftar kalender (HTTP ${err.status}). Coba Muat ulang atau gunakan ID manual.`,
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  if (NETWORK_ERROR_PATTERN.test(raw)) {
    return {
      ok: false,
      code: "OFFLINE",
      message: "Tidak dapat terhubung ke Google. Periksa koneksi internet lalu coba Muat ulang.",
    };
  }
  return {
    ok: false,
    code: "LIST_FAILED",
    message: "Gagal memuat daftar kalender. Coba Muat ulang atau gunakan ID kalender manual.",
  };
}

async function isSessionStillValid(
  getState: () => Promise<StoredExtensionState>,
  startGeneration: number
): Promise<boolean> {
  const current = await getState();
  return (
    current.googleSessionGeneration === startGeneration &&
    current.googleConnected &&
    current.googleAuthVerified
  );
}

/**
 * Fetches writable calendars for Options without touching sync state, lastSyncError,
 * or leaking OAuth tokens. Enforces generation checks and single 401 retry.
 */
export async function runListWritableCalendars(
  interactive: boolean,
  deps: ListCalendarsDeps
): Promise<ListCalendarsResponse> {
  if (!deps.oauthConfigured) {
    return {
      ok: false,
      code: "OAUTH_NOT_CONFIGURED",
      message: "Google OAuth belum dikonfigurasi. Gunakan ID kalender manual.",
    };
  }

  const initialState = await deps.getState();
  if (!initialState.googleConnected || !initialState.googleAuthVerified) {
    return {
      ok: false,
      code: "NOT_CONNECTED",
      message: "Hubungkan Google Calendar terlebih dahulu untuk memilih dari daftar kalender.",
    };
  }

  const startGeneration = initialState.googleSessionGeneration;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const acquireListToken = async (): Promise<
    { ok: true; token: string } | { ok: false; response: ListCalendarsResponse }
  > => {
    let tokenResult: AuthTokenResult;
    try {
      tokenResult = await deps.getTokenDetailed(interactive, CALENDAR_LIST_SCOPES);
    } catch (err) {
      if (!(await isSessionStillValid(deps.getState, startGeneration))) {
        return {
          ok: false,
          response: {
            ok: false,
            code: "STALE_SESSION",
            message: "Sesi Google berubah. Daftar kalender diabaikan.",
          },
        };
      }
      return { ok: false, response: classifyTokenError(err, interactive) };
    }

    if (!(await isSessionStillValid(deps.getState, startGeneration))) {
      return {
        ok: false,
        response: {
          ok: false,
          code: "STALE_SESSION",
          message: "Sesi Google berubah. Daftar kalender diabaikan.",
        },
      };
    }

    if (
      tokenResult.grantedScopes &&
      !tokenResult.grantedScopes.includes(CALENDAR_LIST_READONLY_SCOPE)
    ) {
      return {
        ok: false,
        response: {
          ok: false,
          code: "GRANT_REQUIRED",
          message: interactive
            ? "Izin membaca daftar kalender belum disetujui. Gunakan ID kalender manual atau coba lagi."
            : "Izin membaca daftar kalender belum diberikan. Klik 'Izinkan akses daftar kalender' atau isi ID manual.",
        },
      };
    }

    return { ok: true, token: tokenResult.token };
  };

  const firstToken = await acquireListToken();
  if (!firstToken.ok) {
    return firstToken.response;
  }

  try {
    const calendars = await listWritableCalendars(firstToken.token, fetchImpl);
    if (!(await isSessionStillValid(deps.getState, startGeneration))) {
      return {
        ok: false,
        code: "STALE_SESSION",
        message: "Sesi Google berubah. Daftar kalender diabaikan.",
      };
    }
    return { ok: true, calendars };
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && err.status === 401) {
      try {
        await deps.removeCachedToken(firstToken.token);
      } catch {
        // Ignore cache cleanup failure
      }

      if (!(await isSessionStillValid(deps.getState, startGeneration))) {
        return {
          ok: false,
          code: "STALE_SESSION",
          message: "Sesi Google berubah. Daftar kalender diabaikan.",
        };
      }

      const retryToken = await acquireListToken();
      if (!retryToken.ok) {
        return retryToken.response;
      }

      try {
        const calendars = await listWritableCalendars(retryToken.token, fetchImpl);
        if (!(await isSessionStillValid(deps.getState, startGeneration))) {
          return {
            ok: false,
            code: "STALE_SESSION",
            message: "Sesi Google berubah. Daftar kalender diabaikan.",
          };
        }
        return { ok: true, calendars };
      } catch (retryErr) {
        if (!(await isSessionStillValid(deps.getState, startGeneration))) {
          return {
            ok: false,
            code: "STALE_SESSION",
            message: "Sesi Google berubah. Daftar kalender diabaikan.",
          };
        }
        return classifyApiError(retryErr);
      }
    }

    if (!(await isSessionStillValid(deps.getState, startGeneration))) {
      return {
        ok: false,
        code: "STALE_SESSION",
        message: "Sesi Google berubah. Daftar kalender diabaikan.",
      };
    }
    return classifyApiError(err);
  }
}
