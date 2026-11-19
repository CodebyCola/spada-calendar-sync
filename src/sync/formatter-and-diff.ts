import type { ScannedAssignment } from "../parsers/spada-html.js";
import {
  DEFAULT_SETTINGS,
  isCalendarColorId,
  normalizeReminderMinutes,
  type ExtensionSettings,
  type ReminderMinutePreset,
} from "../shared/settings.js";

export type SyncEvaluationMode = "ignore" | "existing_only" | "create_or_update";

export type SyncEvaluationReason =
  | "course_excluded"
  | "no_valid_deadline"
  | "outside_time"
  | "outside_status"
  | "eligible";

export interface SyncEvaluationResult {
  mode: SyncEvaluationMode;
  reason: SyncEvaluationReason;
}

export interface EffectiveEventPreferences {
  reminderMinutes: ReminderMinutePreset[];
  colorId: string | null;
}

export interface FormattedExtensionEvent {
  spadaUid: string;
  cmid: string;
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  submitted: boolean;
  shortCourseName: string;
  rawTitle: string;
  reminderMinutes: ReminderMinutePreset[];
  colorId: string | null;
  spadaHash: string;
}

export interface LocalSyncCandidate {
  event: FormattedExtensionEvent;
  allowCreate: boolean;
}

export interface RemoteCalendarEvent {
  googleEventId: string;
  summary: string;
  startIso: string;
  spadaSource: string;
  spadaUid: string;
  spadaHash: string;
}

export interface ExtensionSyncUpdate {
  googleEventId: string;
  targetSpadaUid: string;
  event: FormattedExtensionEvent;
}

export interface ExtensionSyncPlan {
  toCreate: FormattedExtensionEvent[];
  toUpdate: ExtensionSyncUpdate[];
  toSkip: FormattedExtensionEvent[];
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_MINUTES_MS = 2 * 60 * 1000;

const wibDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hourCycle: "h23",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatWibDateTime(date: Date): string {
  const parts = wibDateFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} WIB`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Single authoritative evaluator shared by Service Worker sync and Popup preview.
 * Priority: course_excluded > no_valid_deadline > outside_time > outside_status > eligible.
 */
export function evaluateAssignmentForSync(
  assignment: Pick<ScannedAssignment, "courseId" | "dueDateIso" | "submitted">,
  settings: Pick<ExtensionSettings, "excludedCourseIds" | "timeFilter" | "statusFilter">,
  nowMs: number = Date.now()
): SyncEvaluationResult {
  if (settings.excludedCourseIds.includes(assignment.courseId)) {
    return { mode: "ignore", reason: "course_excluded" };
  }

  if (!assignment.dueDateIso) {
    return { mode: "ignore", reason: "no_valid_deadline" };
  }
  const dueMs = Date.parse(assignment.dueDateIso);
  if (!Number.isFinite(dueMs)) {
    return { mode: "ignore", reason: "no_valid_deadline" };
  }

  if (settings.timeFilter === "upcoming_only" && dueMs < nowMs) {
    return { mode: "existing_only", reason: "outside_time" };
  }
  if (settings.timeFilter === "recent_7d" && dueMs < nowMs - SEVEN_DAYS_MS) {
    return { mode: "existing_only", reason: "outside_time" };
  }

  if (settings.statusFilter === "pending_only" && assignment.submitted) {
    return { mode: "existing_only", reason: "outside_status" };
  }
  if (settings.statusFilter === "submitted_only" && !assignment.submitted) {
    return { mode: "existing_only", reason: "outside_status" };
  }

  return { mode: "create_or_update", reason: "eligible" };
}

/**
 * Computes canonical per-event reminder & color preferences based on submission status.
 * Submitted events always have zero reminders and only depend on submittedColorId.
 */
export function computeEffectiveEventPreferences(
  submitted: boolean,
  settings?: Partial<Pick<ExtensionSettings, "reminderMinutes" | "pendingColorId" | "submittedColorId">>
): EffectiveEventPreferences {
  const rawColor = submitted
    ? (settings?.submittedColorId ?? DEFAULT_SETTINGS.submittedColorId)
    : (settings?.pendingColorId ?? DEFAULT_SETTINGS.pendingColorId);
  const validColor = isCalendarColorId(rawColor) ? rawColor : "default";
  const colorId = validColor === "default" ? null : validColor;

  if (submitted) {
    return {
      reminderMinutes: [],
      colorId,
    };
  }

  return {
    reminderMinutes:
      settings && "reminderMinutes" in settings
        ? normalizeReminderMinutes(settings.reminderMinutes)
        : [...DEFAULT_SETTINGS.reminderMinutes],
    colorId,
  };
}

/**
 * Formats a scanned assignment into a Google Calendar payload with deterministic SHA-256 hash.
 */
export async function formatScannedAssignment(
  assignment: ScannedAssignment,
  settings?: Partial<Pick<ExtensionSettings, "reminderMinutes" | "pendingColorId" | "submittedColorId">>
): Promise<FormattedExtensionEvent> {
  if (!assignment.dueDateIso || !Number.isFinite(Date.parse(assignment.dueDateIso))) {
    throw new Error(`Assignment ${assignment.cmid} has no valid dueDateIso.`);
  }

  const spadaUid = `assign-${assignment.cmid}@spada.upnyk.ac.id`;
  const prefix = assignment.submitted ? "✅ [SELESAI]" : "📌 [TUGAS]";
  const title = `${prefix} ${assignment.title} — ${assignment.shortCourseName}`;
  const wibTime = formatWibDateTime(new Date(assignment.dueDateIso));
  const effectivePrefs = computeEffectiveEventPreferences(assignment.submitted, settings);

  const description = [
    `Mata Kuliah: ${assignment.courseName}`,
    assignment.topic ? `Topik: ${assignment.topic}` : "",
    `Batas Waktu (WIB): ${wibTime}`,
    `Status Pengajuan: ${assignment.submissionStatus || (assignment.submitted ? "Terkirim" : "Belum mengajukan")}`,
    "",
    `Link Tugas SPADA: ${assignment.assignUrl}`,
    `Link Kursus: ${assignment.courseUrl}`,
    `UID SPADA: ${spadaUid}`,
  ]
    .filter((line, idx, arr) => line !== "" || (arr[idx - 1] !== "" && idx > 0))
    .join("\n");

  const spadaHash = await sha256Hex(
    JSON.stringify({
      uid: spadaUid,
      title,
      description,
      startIso: assignment.dueDateIso,
      endIso: assignment.dueDateIso,
      submitted: assignment.submitted,
      reminderMinutes: effectivePrefs.reminderMinutes,
      colorId: effectivePrefs.colorId,
    })
  );

  return {
    spadaUid,
    cmid: assignment.cmid,
    title,
    description,
    startIso: assignment.dueDateIso,
    endIso: assignment.dueDateIso,
    submitted: assignment.submitted,
    shortCourseName: assignment.shortCourseName,
    rawTitle: assignment.title,
    reminderMinutes: effectivePrefs.reminderMinutes,
    colorId: effectivePrefs.colorId,
    spadaHash,
  };
}

const LEGACY_ICS_SPADA_UID_PATTERN = /^\d+@spada\.upnyk\.ac\.id$/i;
const LEGACY_SUMMARY_JOINERS = [" — ", "—", " – ", "–", " - "] as const;

function normalizeLegacySummaryText(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isLegacyIcsSpadaUid(spadaUid: string): boolean {
  return LEGACY_ICS_SPADA_UID_PATTERN.test(spadaUid.trim());
}

function stripStatusPrefix(summary: string): string {
  return summary.replace(/^\s*(?:(?:📌|✅)\s*)?(?:\[(?:TUGAS|SELESAI)\]\s*)*/iu, "").trim();
}

function matchesLegacyIcsSummary(
  remoteSummary: string,
  localTitleNorm: string,
  localCourseNorm: string
): boolean {
  if (!localTitleNorm || !localCourseNorm) {
    return false;
  }
  const remoteNorm = normalizeLegacySummaryText(stripStatusPrefix(remoteSummary));
  if (!remoteNorm) {
    return false;
  }
  return LEGACY_SUMMARY_JOINERS.some(
    (joiner) => remoteNorm === `${localTitleNorm}${joiner}${localCourseNorm}`
  );
}

function findLegacyIcsCandidates(
  local: FormattedExtensionEvent,
  remoteEvents: RemoteCalendarEvent[],
  claimedRemoteIds: ReadonlySet<string>
): RemoteCalendarEvent[] {
  const localTitleNorm = normalizeLegacySummaryText(local.rawTitle);
  const localCourseNorm = normalizeLegacySummaryText(local.shortCourseName);
  const localDueMs = Date.parse(local.startIso);
  if (!localTitleNorm || !localCourseNorm || !Number.isFinite(localDueMs)) {
    return [];
  }

  return remoteEvents.filter((remote) => {
    if (claimedRemoteIds.has(remote.googleEventId)) {
      return false;
    }
    if (!isLegacyIcsSpadaUid(remote.spadaUid)) {
      return false;
    }
    if (!remote.startIso) {
      return false;
    }
    const remoteMs = Date.parse(remote.startIso);
    if (!Number.isFinite(remoteMs) || Math.abs(remoteMs - localDueMs) > TWO_MINUTES_MS) {
      return false;
    }
    return matchesLegacyIcsSummary(remote.summary, localTitleNorm, localCourseNorm);
  });
}

/**
 * Computes CREATE / UPDATE / SKIP plan, deduplicating across both extension-created
 * and `.ics`-created events. Existing-only candidates only update matched remote events
 * and are omitted from both toCreate and toSkip when unmatched.
 * Fallback matching is strictly restricted to unambiguous legacy `.ics` events and never
 * matches another extension assignment UID.
 */
export function computeExtensionSyncPlan(
  candidates: LocalSyncCandidate[],
  remoteEvents: RemoteCalendarEvent[]
): ExtensionSyncPlan {
  const toCreate: FormattedExtensionEvent[] = [];
  const toUpdate: ExtensionSyncUpdate[] = [];
  const toSkip: FormattedExtensionEvent[] = [];

  // Pass 1: exact UID matching
  const resolvedMatches = new Map<number, RemoteCalendarEvent>();
  const claimedRemoteIds = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const local = candidates[i]!.event;
    const exact = remoteEvents.find((r) => r.spadaUid === local.spadaUid);
    if (exact) {
      resolvedMatches.set(i, exact);
      claimedRemoteIds.add(exact.googleEventId);
    }
  }

  // Pass 2: strict 1-to-1 legacy `.ics` fallback matching (degree(local) === 1 AND degree(remote) === 1)
  const fallbackMatchesByLocalIndex = new Map<number, RemoteCalendarEvent[]>();
  const remoteFallbackDegree = new Map<string, number>();

  for (let i = 0; i < candidates.length; i++) {
    if (resolvedMatches.has(i)) {
      continue;
    }
    const matches = findLegacyIcsCandidates(
      candidates[i]!.event,
      remoteEvents,
      claimedRemoteIds
    );
    if (matches.length === 0) {
      continue;
    }
    fallbackMatchesByLocalIndex.set(i, matches);
    for (const remote of matches) {
      remoteFallbackDegree.set(
        remote.googleEventId,
        (remoteFallbackDegree.get(remote.googleEventId) ?? 0) + 1
      );
    }
  }

  for (const [idx, matches] of fallbackMatchesByLocalIndex.entries()) {
    if (matches.length !== 1) {
      continue;
    }
    const only = matches[0]!;
    if ((remoteFallbackDegree.get(only.googleEventId) ?? 0) === 1) {
      resolvedMatches.set(idx, only);
    }
  }

  // Pass 3: classify CREATE / UPDATE / SKIP
  for (let i = 0; i < candidates.length; i++) {
    const { event: local, allowCreate } = candidates[i]!;
    const match = resolvedMatches.get(i);
    if (!match) {
      if (allowCreate) {
        toCreate.push(local);
      }
    } else if (match.spadaHash !== local.spadaHash) {
      toUpdate.push({
        googleEventId: match.googleEventId,
        targetSpadaUid: match.spadaUid,
        event: local,
      });
    } else {
      toSkip.push(local);
    }
  }

  return { toCreate, toUpdate, toSkip };
}
