import type { ScannedAssignment, SpadaCourse } from "../parsers/spada-html.js";
import type { ExtensionSettings } from "../shared/settings.js";
import {
  evaluateAssignmentForSync,
  formatWibDateTime,
  type SyncEvaluationReason,
  type SyncEvaluationResult,
} from "../sync/formatter-and-diff.js";

export type PopupStatusViewFilter = "pending" | "submitted" | "all";
export type PopupTimeViewFilter = "all" | "upcoming" | "overdue";

export interface PopupViewFilters {
  courseId: string;
  status: PopupStatusViewFilter;
  time: PopupTimeViewFilter;
}

export const DEFAULT_POPUP_VIEW_FILTERS: PopupViewFilters = {
  courseId: "all",
  status: "pending",
  time: "all",
};

export type DeadlineUrgency = "overdue" | "urgent" | "soon" | "normal" | "done" | "none";

export interface FormattedDeadlineView {
  relativeLabel: string;
  absoluteLabel: string;
  urgency: DeadlineUrgency;
  valid: boolean;
}

export interface PopupCourseOption {
  value: string;
  label: string;
}

export interface PopupAssignmentCardModel {
  assignment: ScannedAssignment;
  evaluation: SyncEvaluationResult;
  syncReasonText: string;
  deadline: FormattedDeadlineView;
}

export interface PopupViewModel {
  createCandidateCount: number;
  existingOnlyCount: number;
  pendingTotalCount: number;
  submittedTotalCount: number;
  allTotalCount: number;
  syncButtonLabel: string;
  syncPreviewHint: string;
  courseOptions: PopupCourseOption[];
  effectiveCourseId: string;
  visibleCards: PopupAssignmentCardModel[];
  emptyStateMessage: string | null;
  canResetFilters: boolean;
}

const wibDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getWibDayIndex(ms: number): number {
  const parts = wibDatePartsFormatter.formatToParts(new Date(ms));
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function formatDurationCompact(absMs: number): string {
  const MINUTE_MS = 60_000;
  const HOUR_MS = 3_600_000;
  const DAY_MS = 86_400_000;

  if (absMs < MINUTE_MS) {
    return "kurang dari 1 menit";
  }
  if (absMs < HOUR_MS) {
    const mins = Math.floor(absMs / MINUTE_MS);
    return `${mins} menit`;
  }
  if (absMs < DAY_MS) {
    const hours = Math.floor(absMs / HOUR_MS);
    return `${hours} jam`;
  }
  const days = Math.floor(absMs / DAY_MS);
  return `${days} hari`;
}

export function formatRelativeDeadlineWib(
  dueDateIso: string | null,
  nowMs: number,
  submitted: boolean
): FormattedDeadlineView {
  if (!dueDateIso) {
    return {
      relativeLabel: "Tanpa deadline",
      absoluteLabel: "Tanpa deadline",
      urgency: "none",
      valid: false,
    };
  }

  const dueMs = Date.parse(dueDateIso);
  if (!Number.isFinite(dueMs)) {
    return {
      relativeLabel: "Tanpa deadline",
      absoluteLabel: "Tanpa deadline",
      urgency: "none",
      valid: false,
    };
  }

  const absoluteLabel = formatWibDateTime(new Date(dueMs));
  const diffMs = dueMs - nowMs;

  if (diffMs === 0) {
    return {
      relativeLabel: "Jatuh tempo sekarang",
      absoluteLabel,
      urgency: submitted ? "done" : "urgent",
      valid: true,
    };
  }

  const dayDiff = getWibDayIndex(dueMs) - getWibDayIndex(nowMs);
  const duration = formatDurationCompact(Math.abs(diffMs));

  if (diffMs > 0) {
    if (dayDiff === 0) {
      return {
        relativeLabel: `Hari ini • ${duration} lagi`,
        absoluteLabel,
        urgency: submitted ? "done" : "urgent",
        valid: true,
      };
    }
    if (dayDiff === 1) {
      return {
        relativeLabel: `Besok • ${duration} lagi`,
        absoluteLabel,
        urgency: submitted ? "done" : "soon",
        valid: true,
      };
    }
    return {
      relativeLabel: `${dayDiff} hari lagi`,
      absoluteLabel,
      urgency: submitted ? "done" : "normal",
      valid: true,
    };
  }

  // Overdue (diffMs < 0)
  if (dayDiff === 0) {
    return {
      relativeLabel: `Hari ini • Lewat ${duration}`,
      absoluteLabel,
      urgency: submitted ? "done" : "overdue",
      valid: true,
    };
  }
  if (dayDiff === -1) {
    return {
      relativeLabel: `Kemarin • Lewat ${duration}`,
      absoluteLabel,
      urgency: submitted ? "done" : "overdue",
      valid: true,
    };
  }
  return {
    relativeLabel: `Lewat ${Math.abs(dayDiff)} hari`,
    absoluteLabel,
    urgency: submitted ? "done" : "overdue",
    valid: true,
  };
}

export function getSyncEvaluationReasonText(reason: SyncEvaluationReason): string {
  switch (reason) {
    case "eligible":
      return "Cocok untuk event baru / diperbarui saat sync";
    case "course_excluded":
      return "Mata kuliah dikecualikan dari sync";
    case "no_valid_deadline":
      return "Tidak disinkronkan (tanpa tenggat valid)";
    case "outside_time":
    case "outside_status":
      return "Hanya memperbarui jika event sudah ada";
  }
}

function buildCourseOptions(courses: SpadaCourse[]): PopupCourseOption[] {
  const uniqueCourses: SpadaCourse[] = [];
  const seenIds = new Set<string>();
  const nameCounts = new Map<string, number>();

  for (const course of courses) {
    const id = course.courseId.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    uniqueCourses.push(course);
    const nameKey = course.courseName.trim() || id;
    nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
  }

  const options: PopupCourseOption[] = [{ value: "all", label: "Semua mata kuliah" }];
  for (const course of uniqueCourses) {
    const id = course.courseId.trim();
    const baseName = course.courseName.trim() || id;
    const isDuplicateName = (nameCounts.get(baseName) ?? 0) > 1;
    options.push({
      value: id,
      label: isDuplicateName ? `${baseName} (ID ${id})` : baseName,
    });
  }

  return options;
}

export interface BuildPopupViewModelInput {
  assignments: ScannedAssignment[];
  courses: SpadaCourse[];
  settings: ExtensionSettings;
  viewFilters: PopupViewFilters;
  lastScanAt: string | null;
  nowMs?: number;
}

export function buildPopupViewModel(input: BuildPopupViewModelInput): PopupViewModel {
  const nowMs = input.nowMs ?? Date.now();
  const { assignments, courses, settings, viewFilters, lastScanAt } = input;

  const courseOptions = buildCourseOptions(courses);
  const validCourseValues = new Set(courseOptions.map((c) => c.value));
  const effectiveCourseId = validCourseValues.has(viewFilters.courseId)
    ? viewFilters.courseId
    : "all";

  let createCandidateCount = 0;
  let existingOnlyCount = 0;
  let pendingTotalCount = 0;
  let submittedTotalCount = 0;

  const visibleCards: PopupAssignmentCardModel[] = [];

  for (const assignment of assignments) {
    if (assignment.submitted) {
      submittedTotalCount++;
    } else {
      pendingTotalCount++;
    }

    const evaluation = evaluateAssignmentForSync(assignment, settings, nowMs);
    if (evaluation.mode === "create_or_update") {
      createCandidateCount++;
    } else if (evaluation.mode === "existing_only") {
      existingOnlyCount++;
    }

    // Apply local view filters (never alters global createCandidateCount)
    if (effectiveCourseId !== "all" && assignment.courseId !== effectiveCourseId) {
      continue;
    }
    if (viewFilters.status === "pending" && assignment.submitted) {
      continue;
    }
    if (viewFilters.status === "submitted" && !assignment.submitted) {
      continue;
    }

    const dueMs = assignment.dueDateIso ? Date.parse(assignment.dueDateIso) : Number.NaN;
    const hasValidDue = Number.isFinite(dueMs);

    if (viewFilters.time === "upcoming" && (!hasValidDue || dueMs < nowMs)) {
      continue;
    }
    if (viewFilters.time === "overdue" && (!hasValidDue || dueMs >= nowMs)) {
      continue;
    }

    visibleCards.push({
      assignment,
      evaluation,
      syncReasonText: getSyncEvaluationReasonText(evaluation.reason),
      deadline: formatRelativeDeadlineWib(assignment.dueDateIso, nowMs, assignment.submitted),
    });
  }

  const hasScanned = Boolean(lastScanAt);
  const syncButtonLabel = hasScanned
    ? `📅 Sync ke Calendar (${createCandidateCount} kandidat)`
    : "📅 Sync ke Calendar";
  const syncPreviewHint = hasScanned
    ? "Cocok untuk event baru pada scan terakhir; event lama juga diperiksa."
    : "Belum ada hasil scan";

  const hasActiveLocalFilter =
    effectiveCourseId !== "all" || viewFilters.status !== "all" || viewFilters.time !== "all";

  let emptyStateMessage: string | null = null;
  let canResetFilters = false;

  if (visibleCards.length === 0) {
    if (!hasScanned && assignments.length === 0) {
      emptyStateMessage =
        "Belum ada data tugas. Pastikan tab SPADA sudah login, lalu klik 'Scan SPADA'.";
    } else if (assignments.length === 0) {
      emptyStateMessage = "Tidak ada tugas ditemukan pada hasil scan terakhir.";
    } else if (
      viewFilters.status === "pending" &&
      effectiveCourseId === "all" &&
      viewFilters.time === "all"
    ) {
      emptyStateMessage = "Semua tugas di mata kuliah aktif sudah dikumpulkan!";
      canResetFilters = true;
    } else {
      emptyStateMessage = "Tidak ada tugas yang cocok dengan filter tampilan saat ini.";
      canResetFilters = hasActiveLocalFilter;
    }
  }

  return {
    createCandidateCount,
    existingOnlyCount,
    pendingTotalCount,
    submittedTotalCount,
    allTotalCount: assignments.length,
    syncButtonLabel,
    syncPreviewHint,
    courseOptions,
    effectiveCourseId,
    visibleCards,
    emptyStateMessage,
    canResetFilters,
  };
}
