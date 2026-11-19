import {
  createRemoteEvent,
  GoogleCalendarApiError,
  listRemoteSpadaEvents,
  patchRemoteEvent,
} from "../calendar/google-calendar-rest.js";
import {
  isAuthenticatedSpadaDashboardHtml,
  isSpadaLoginHtml,
  parseAssignIndexHtml,
  parseEnrolledCoursesHtml,
  type ScannedAssignment,
  type SpadaCourse,
} from "../parsers/spada-html.js";
import type { ExtensionSettings, SyncSummary } from "../shared/storage.js";
import {
  computeExtensionSyncPlan,
  evaluateAssignmentForSync,
  formatScannedAssignment,
  type LocalSyncCandidate,
} from "../sync/formatter-and-diff.js";

const SPADA_MY_URL = "https://spada.upnyk.ac.id/my/";
const SCAN_BATCH_SIZE = 3;
const GOOGLE_WRITE_DELAY_MS = 120;

export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_EVENTS_SCOPES: readonly string[] = [CALENDAR_EVENTS_SCOPE];
export const CALENDAR_LIST_SCOPES: readonly string[] = [CALENDAR_LIST_READONLY_SCOPE];

export interface AuthTokenResult {
  token: string;
  grantedScopes?: string[];
}

export interface ScanResult {
  courses: SpadaCourse[];
  assignments: ScannedAssignment[];
}

function sortAssignments(assignments: ScannedAssignment[]): ScannedAssignment[] {
  return [...assignments].sort((a, b) => {
    if (a.submitted !== b.submitted) {
      return a.submitted ? 1 : -1;
    }
    if (a.dueDateIso && b.dueDateIso) {
      return Date.parse(a.dueDateIso) - Date.parse(b.dueDateIso);
    }
    if (a.dueDateIso) return -1;
    if (b.dueDateIso) return 1;
    return a.title.localeCompare(b.title);
  });
}

async function fetchSpadaPage(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`SPADA HTTP ${res.status} untuk ${url}`);
  }
  const html = await res.text();
  if (isSpadaLoginHtml(html) || res.url?.includes("/login/index.php")) {
    throw new Error("AUTH_REQUIRED: Silakan login ke SPADA UPNYK terlebih dahulu.");
  }
  return html;
}

/**
 * Fetches active courses (unless provided by Content Script) and scans each course's
 * `/mod/assign/index.php?id=<courseId>` table in polite batches of 3.
 */
export async function scanSpadaWithFetcher(
  fetchImpl: typeof fetch = fetch,
  seedCourses?: SpadaCourse[]
): Promise<ScanResult> {
  let courses = seedCourses && seedCourses.length > 0 ? seedCourses : [];
  let myHtml = "";

  if (courses.length === 0) {
    myHtml = await fetchSpadaPage(SPADA_MY_URL, fetchImpl);
    courses = parseEnrolledCoursesHtml(myHtml);
  }

  if (courses.length === 0) {
    if (isAuthenticatedSpadaDashboardHtml(myHtml)) {
      return { courses: [], assignments: [] };
    }
    throw new Error(
      "AUTH_REQUIRED: Tidak menemukan daftar kursus aktif. Pastikan kamu sudah login di SPADA."
    );
  }

  const allAssignments: ScannedAssignment[] = [];
  for (let i = 0; i < courses.length; i += SCAN_BATCH_SIZE) {
    const batch = courses.slice(i, i + SCAN_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (course) => {
        const indexUrl = `https://spada.upnyk.ac.id/mod/assign/index.php?id=${course.courseId}`;
        const html = await fetchSpadaPage(indexUrl, fetchImpl);
        return parseAssignIndexHtml(html, course);
      })
    );
    for (const items of batchResults) {
      allAssignments.push(...items);
    }
  }

  return {
    courses,
    assignments: sortAssignments(allAssignments),
  };
}

export function isConfiguredOAuthClientId(clientId: string): boolean {
  const trimmed = clientId.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  if (/^YOUR_.*CLIENT_ID/i.test(trimmed)) {
    return false;
  }
  return trimmed.endsWith(".apps.googleusercontent.com");
}

export function isOAuthClientConfigured(): boolean {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2?.client_id ?? "";
  return isConfiguredOAuthClientId(clientId);
}

export async function requestChromeAuthTokenDetailed(
  interactive: boolean,
  scopes: readonly string[] = CALENDAR_EVENTS_SCOPES,
  identityApi?: Partial<typeof chrome.identity>
): Promise<AuthTokenResult> {
  const api =
    arguments.length >= 3
      ? identityApi
      : typeof chrome !== "undefined"
        ? chrome.identity
        : undefined;

  if (!api || typeof api.getAuthToken !== "function") {
    throw new Error(
      "BROWSER_UNSUPPORTED: chrome.identity.getAuthToken tidak tersedia di browser ini. Gunakan Google Chrome."
    );
  }

  const result = await api.getAuthToken({
    interactive,
    scopes: [...scopes],
  });
  if (!result?.token) {
    throw new Error("Gagal mendapatkan token Google OAuth.");
  }
  return {
    token: result.token,
    grantedScopes: Array.isArray(result.grantedScopes) ? [...result.grantedScopes] : undefined,
  };
}

export async function requestChromeAuthToken(
  interactive: boolean,
  identityApi?: Partial<typeof chrome.identity>,
  scopes: readonly string[] = CALENDAR_EVENTS_SCOPES
): Promise<string> {
  const detailed =
    arguments.length >= 2
      ? await requestChromeAuthTokenDetailed(interactive, scopes, identityApi)
      : await requestChromeAuthTokenDetailed(interactive, scopes);
  return detailed.token;
}

/**
 * Best-effort cleanup of cached Chrome Identity tokens for both events and calendar-list scopes
 * without prompting the user or persisting any token.
 */
export async function revokeAllGoogleTokens(
  identityApi?: Partial<typeof chrome.identity>,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const api =
    arguments.length >= 1
      ? identityApi
      : typeof chrome !== "undefined"
        ? chrome.identity
        : undefined;

  if (!api || typeof api.getAuthToken !== "function") {
    return;
  }

  const seenTokens = new Set<string>();
  const scopeGroups: readonly (readonly string[])[] = [
    CALENDAR_EVENTS_SCOPES,
    CALENDAR_LIST_SCOPES,
  ];

  for (const scopes of scopeGroups) {
    try {
      const tokenRes = await api.getAuthToken({
        interactive: false,
        scopes: [...scopes],
      });
      if (tokenRes?.token) {
        seenTokens.add(tokenRes.token);
      }
    } catch {
      // Best-effort: ignore if scope was never granted or token is absent
    }
  }

  for (const token of seenTokens) {
    try {
      if (typeof api.removeCachedAuthToken === "function") {
        await api.removeCachedAuthToken({ token });
      }
    } catch {
      // Ignore cache removal failure
    }
    try {
      await fetchImpl(
        `https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`
      );
    } catch {
      // Ignore network revoke failure
    }
  }
}

async function getGoogleToken(interactive: boolean): Promise<string> {
  if (!isOAuthClientConfigured()) {
    throw new Error(
      "OAUTH_NOT_CONFIGURED: Isi oauth2.client_id di manifest.json dulu (lihat panduan Setup di Options / README)."
    );
  }
  return requestChromeAuthToken(interactive);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SyncTokenDependencies {
  getToken?: (interactive: boolean) => Promise<string>;
  removeCachedToken?: (token: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  writeDelayMs?: number;
}

export async function syncAssignmentsToGoogleCalendar(
  assignments: ScannedAssignment[],
  settings: ExtensionSettings,
  interactive: boolean,
  deps?: SyncTokenDependencies
): Promise<SyncSummary> {
  const getToken = deps?.getToken ?? getGoogleToken;
  const removeCachedToken =
    deps?.removeCachedToken ??
    (async (token: string) => {
      if (typeof chrome !== "undefined" && typeof chrome.identity?.removeCachedAuthToken === "function") {
        await chrome.identity.removeCachedAuthToken({ token });
      }
    });
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const nowMs = deps?.nowMs ?? Date.now();
  const writeDelayMs = deps?.writeDelayMs ?? GOOGLE_WRITE_DELAY_MS;

  // Always establish/verify Google authorization before reporting sync completion,
  // even when there are currently 0 eligible assignments to sync.
  const token = await getToken(interactive);

  const evaluated = assignments
    .map((assignment) => ({
      assignment,
      evaluation: evaluateAssignmentForSync(assignment, settings, nowMs),
    }))
    .filter((entry) => entry.evaluation.mode !== "ignore");

  if (evaluated.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const candidates: LocalSyncCandidate[] = await Promise.all(
    evaluated.map(async ({ assignment, evaluation }) => ({
      event: await formatScannedAssignment(assignment, settings),
      allowCreate: evaluation.mode === "create_or_update",
    }))
  );

  const createdUids = new Set<string>();
  const updatedUids = new Set<string>();

  const executeWithToken = async (accessToken: string): Promise<SyncSummary> => {
    const remoteEvents = await listRemoteSpadaEvents(accessToken, settings.calendarId, fetchImpl);
    const plan = computeExtensionSyncPlan(candidates, remoteEvents);

    for (const item of plan.toCreate) {
      await createRemoteEvent(accessToken, settings.calendarId, item, fetchImpl);
      createdUids.add(item.spadaUid);
      if (writeDelayMs > 0) {
        await sleep(writeDelayMs);
      }
    }

    for (const item of plan.toUpdate) {
      await patchRemoteEvent(
        accessToken,
        settings.calendarId,
        item.googleEventId,
        item.event,
        item.targetSpadaUid,
        fetchImpl
      );
      updatedUids.add(item.event.spadaUid);
      if (writeDelayMs > 0) {
        await sleep(writeDelayMs);
      }
    }

    const skippedCount = plan.toSkip.filter(
      (item) => !createdUids.has(item.spadaUid) && !updatedUids.has(item.spadaUid)
    ).length;

    return {
      created: createdUids.size,
      updated: updatedUids.size,
      skipped: skippedCount,
    };
  };

  try {
    return await executeWithToken(token);
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && err.status === 401) {
      await removeCachedToken(token);
      const freshToken = await getToken(interactive);
      return await executeWithToken(freshToken);
    }
    throw err;
  }
}
