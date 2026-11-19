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
  filterSyncableAssignments,
  formatScannedAssignment,
} from "../sync/formatter-and-diff.js";

const SPADA_MY_URL = "https://spada.upnyk.ac.id/my/";
const SCAN_BATCH_SIZE = 3;
const GOOGLE_WRITE_DELAY_MS = 120;

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

async function getGoogleToken(interactive: boolean): Promise<string> {
  if (!isOAuthClientConfigured()) {
    throw new Error(
      "OAUTH_NOT_CONFIGURED: Isi oauth2.client_id di manifest.json dulu (lihat panduan Setup di Options / README)."
    );
  }
  const result = await chrome.identity.getAuthToken({ interactive });
  if (!result.token) {
    throw new Error("Gagal mendapatkan token Google OAuth.");
  }
  return result.token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SyncTokenDependencies {
  getToken?: (interactive: boolean) => Promise<string>;
  removeCachedToken?: (token: string) => Promise<void>;
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
      await chrome.identity.removeCachedAuthToken({ token });
    });

  // Always establish/verify Google authorization before reporting sync completion,
  // even when there are currently 0 eligible assignments to sync.
  const token = await getToken(interactive);

  const syncable = filterSyncableAssignments(assignments, {
    includePastAssignments: settings.includePastAssignments,
    syncSubmitted: settings.syncSubmitted,
  });

  if (syncable.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const formattedEvents = await Promise.all(syncable.map(formatScannedAssignment));

  const executeWithToken = async (accessToken: string): Promise<SyncSummary> => {
    const remoteEvents = await listRemoteSpadaEvents(accessToken, settings.calendarId);
    const plan = computeExtensionSyncPlan(formattedEvents, remoteEvents);

    for (const item of plan.toCreate) {
      await createRemoteEvent(accessToken, settings.calendarId, item);
      await sleep(GOOGLE_WRITE_DELAY_MS);
    }

    for (const item of plan.toUpdate) {
      await patchRemoteEvent(
        accessToken,
        settings.calendarId,
        item.googleEventId,
        item.event,
        item.targetSpadaUid
      );
      await sleep(GOOGLE_WRITE_DELAY_MS);
    }

    return {
      created: plan.toCreate.length,
      updated: plan.toUpdate.length,
      skipped: plan.toSkip.length,
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
