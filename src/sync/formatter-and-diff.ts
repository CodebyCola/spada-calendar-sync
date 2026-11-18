import type { ScannedAssignment } from "../parsers/spada-html.js";

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
  spadaHash: string;
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
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
 * Filters out assignments without due dates, old past-due tasks (>7d unless opted in),
 * and optionally submitted tasks.
 */
export function filterSyncableAssignments(
  assignments: ScannedAssignment[],
  options: { includePastAssignments: boolean; syncSubmitted: boolean; nowMs?: number }
): ScannedAssignment[] {
  const nowMs = options.nowMs ?? Date.now();
  const minDueMs = nowMs - SEVEN_DAYS_MS;

  return assignments.filter((assign) => {
    if (!assign.dueDateIso) {
      return false;
    }
    if (!options.syncSubmitted && assign.submitted) {
      return false;
    }
    if (!options.includePastAssignments) {
      const dueMs = Date.parse(assign.dueDateIso);
      if (Number.isNaN(dueMs) || dueMs < minDueMs) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Formats a scanned assignment into a Google Calendar payload with deterministic SHA-256 hash.
 */
export async function formatScannedAssignment(
  assignment: ScannedAssignment
): Promise<FormattedExtensionEvent> {
  if (!assignment.dueDateIso) {
    throw new Error(`Assignment ${assignment.cmid} has no dueDateIso.`);
  }

  const spadaUid = `assign-${assignment.cmid}@spada.upnyk.ac.id`;
  const prefix = assignment.submitted ? "✅ [SELESAI]" : "📌 [TUGAS]";
  const title = `${prefix} ${assignment.title} — ${assignment.shortCourseName}`;
  const wibTime = formatWibDateTime(new Date(assignment.dueDateIso));

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
    spadaHash,
  };
}

function normalizeMatchText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findMatchingRemoteEvent(
  local: FormattedExtensionEvent,
  remoteEvents: RemoteCalendarEvent[]
): RemoteCalendarEvent | undefined {
  const exact = remoteEvents.find((r) => r.spadaUid === local.spadaUid);
  if (exact) {
    return exact;
  }

  // Fallback: match events synced by the `.ics` backend tool to prevent duplicates
  const localTitleNorm = normalizeMatchText(local.rawTitle);
  const localCourseNorm = normalizeMatchText(local.shortCourseName);
  const localDueMs = Date.parse(local.startIso);

  return remoteEvents.find((remote) => {
    if (!remote.startIso) {
      return false;
    }
    const remoteMs = Date.parse(remote.startIso);
    if (Number.isNaN(remoteMs) || Math.abs(remoteMs - localDueMs) > TWO_MINUTES_MS) {
      return false;
    }
    const remoteSummaryNorm = normalizeMatchText(remote.summary);
    return (
      remoteSummaryNorm.includes(localTitleNorm) &&
      remoteSummaryNorm.includes(localCourseNorm)
    );
  });
}

/**
 * Computes CREATE / UPDATE / SKIP plan, deduplicating across both extension-created
 * and `.ics`-created events.
 */
export function computeExtensionSyncPlan(
  localEvents: FormattedExtensionEvent[],
  remoteEvents: RemoteCalendarEvent[]
): ExtensionSyncPlan {
  const toCreate: FormattedExtensionEvent[] = [];
  const toUpdate: ExtensionSyncUpdate[] = [];
  const toSkip: FormattedExtensionEvent[] = [];

  for (const local of localEvents) {
    const match = findMatchingRemoteEvent(local, remoteEvents);
    if (!match) {
      toCreate.push(local);
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
