export type TimeFilter = "upcoming_only" | "recent_7d" | "all";
export type StatusFilter = "pending_only" | "submitted_only" | "all";
export type ReminderMinutePreset = 4320 | 1440 | 360 | 180 | 60;
export type CalendarColorId =
  | "default"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11";

export interface ExtensionSettings {
  calendarId: string;
  timeFilter: TimeFilter;
  statusFilter: StatusFilter;
  excludedCourseIds: string[];
  reminderMinutes: ReminderMinutePreset[];
  pendingColorId: CalendarColorId;
  submittedColorId: CalendarColorId;
  autoSyncOnVisit: boolean;
}

export const VALID_TIME_FILTERS: readonly TimeFilter[] = ["upcoming_only", "recent_7d", "all"];
export const VALID_STATUS_FILTERS: readonly StatusFilter[] = [
  "pending_only",
  "submitted_only",
  "all",
];
export const VALID_REMINDER_MINUTES: readonly ReminderMinutePreset[] = [4320, 1440, 360, 180, 60];
export const MAX_REMINDER_OVERRIDES = 5;

export const VALID_CALENDAR_COLOR_IDS: readonly CalendarColorId[] = [
  "default",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
];

export const REMINDER_PRESET_OPTIONS: ReadonlyArray<{
  minutes: ReminderMinutePreset;
  label: string;
}> = [
  { minutes: 4320, label: "3 hari sebelumnya (H-3 hari)" },
  { minutes: 1440, label: "1 hari sebelumnya (H-1 hari)" },
  { minutes: 360, label: "6 jam sebelumnya (H-6 jam)" },
  { minutes: 180, label: "3 jam sebelumnya (H-3 jam)" },
  { minutes: 60, label: "1 jam sebelumnya (H-1 jam)" },
];

export const CALENDAR_COLOR_OPTIONS: ReadonlyArray<{
  id: CalendarColorId;
  label: string;
  hex: string;
}> = [
  { id: "default", label: "Default kalender", hex: "transparent" },
  { id: "1", label: "Lavender", hex: "#7986cb" },
  { id: "2", label: "Sage (Hijau muda)", hex: "#33b679" },
  { id: "3", label: "Grape (Ungu)", hex: "#8e24aa" },
  { id: "4", label: "Flamingo (Merah muda)", hex: "#e67c73" },
  { id: "5", label: "Banana (Kuning)", hex: "#f6bf26" },
  { id: "6", label: "Tangerine (Oranye)", hex: "#f4511e" },
  { id: "7", label: "Peacock (Biru terang)", hex: "#039be5" },
  { id: "8", label: "Graphite (Abu-abu)", hex: "#616161" },
  { id: "9", label: "Blueberry (Biru tua)", hex: "#3f51b5" },
  { id: "10", label: "Basil (Hijau tua)", hex: "#0b8043" },
  { id: "11", label: "Tomato (Merah)", hex: "#d50000" },
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  calendarId: "primary",
  timeFilter: "recent_7d",
  statusFilter: "all",
  excludedCourseIds: [],
  reminderMinutes: [1440, 180],
  pendingColorId: "default",
  submittedColorId: "default",
  autoSyncOnVisit: true,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTimeFilter(value: unknown): value is TimeFilter {
  return typeof value === "string" && (VALID_TIME_FILTERS as readonly string[]).includes(value);
}

export function isStatusFilter(value: unknown): value is StatusFilter {
  return typeof value === "string" && (VALID_STATUS_FILTERS as readonly string[]).includes(value);
}

export function isReminderMinutePreset(value: unknown): value is ReminderMinutePreset {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (VALID_REMINDER_MINUTES as readonly number[]).includes(value)
  );
}

export function isCalendarColorId(value: unknown): value is CalendarColorId {
  return (
    typeof value === "string" && (VALID_CALENDAR_COLOR_IDS as readonly string[]).includes(value)
  );
}

export function normalizeReminderMinutes(raw: unknown): ReminderMinutePreset[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_SETTINGS.reminderMinutes];
  }
  if (raw.length === 0) {
    return [];
  }
  const seen = new Set<ReminderMinutePreset>();
  for (const item of raw) {
    if (isReminderMinutePreset(item)) {
      seen.add(item);
    }
  }
  if (seen.size === 0) {
    // Non-empty array where every element was corrupt -> restore install defaults
    return [...DEFAULT_SETTINGS.reminderMinutes];
  }
  return Array.from(seen)
    .sort((a, b) => b - a)
    .slice(0, MAX_REMINDER_OVERRIDES);
}

function normalizeExcludedCourseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Normalizes any raw stored settings (including v1.0.0 boolean format or partially corrupt objects)
 * into a canonical ExtensionSettings object without legacy keys.
 */
export function normalizeSettings(raw: unknown): ExtensionSettings {
  if (!isPlainObject(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      excludedCourseIds: [...DEFAULT_SETTINGS.excludedCourseIds],
      reminderMinutes: [...DEFAULT_SETTINGS.reminderMinutes],
    };
  }

  let timeFilter: TimeFilter = DEFAULT_SETTINGS.timeFilter;
  if (isTimeFilter(raw.timeFilter)) {
    timeFilter = raw.timeFilter;
  } else if (typeof raw.includePastAssignments === "boolean") {
    timeFilter = raw.includePastAssignments ? "all" : "recent_7d";
  }

  let statusFilter: StatusFilter = DEFAULT_SETTINGS.statusFilter;
  if (isStatusFilter(raw.statusFilter)) {
    statusFilter = raw.statusFilter;
  } else if (typeof raw.syncSubmitted === "boolean") {
    statusFilter = raw.syncSubmitted ? "all" : "pending_only";
  }

  const calendarId =
    typeof raw.calendarId === "string" && raw.calendarId.trim().length > 0
      ? raw.calendarId.trim()
      : DEFAULT_SETTINGS.calendarId;

  const autoSyncOnVisit =
    typeof raw.autoSyncOnVisit === "boolean"
      ? raw.autoSyncOnVisit
      : DEFAULT_SETTINGS.autoSyncOnVisit;

  const excludedCourseIds = normalizeExcludedCourseIds(raw.excludedCourseIds);
  const reminderMinutes = normalizeReminderMinutes(raw.reminderMinutes);
  const pendingColorId = isCalendarColorId(raw.pendingColorId)
    ? raw.pendingColorId
    : DEFAULT_SETTINGS.pendingColorId;
  const submittedColorId = isCalendarColorId(raw.submittedColorId)
    ? raw.submittedColorId
    : DEFAULT_SETTINGS.submittedColorId;

  return {
    calendarId,
    timeFilter,
    statusFilter,
    excludedCourseIds,
    reminderMinutes,
    pendingColorId,
    submittedColorId,
    autoSyncOnVisit,
  };
}

/**
 * Validates and builds a canonical ExtensionSettings payload for SAVE_SETTINGS.
 * Rejects invalid types/values before mutating storage, while allowing legacy v1 Options forms
 * (sending includePastAssignments/syncSubmitted) to save without wiping newer preferences.
 */
export function parseSaveSettingsPayload(
  raw: unknown,
  current: ExtensionSettings
): ExtensionSettings {
  if (!isPlainObject(raw)) {
    throw new Error("Format pengaturan tidak valid.");
  }

  const base = normalizeSettings(current);

  let calendarId = base.calendarId;
  if ("calendarId" in raw && raw.calendarId !== undefined) {
    if (typeof raw.calendarId !== "string") {
      throw new Error("Google Calendar ID harus berupa teks.");
    }
    calendarId = raw.calendarId.trim() || "primary";
  }

  let autoSyncOnVisit = base.autoSyncOnVisit;
  if ("autoSyncOnVisit" in raw && raw.autoSyncOnVisit !== undefined) {
    if (typeof raw.autoSyncOnVisit !== "boolean") {
      throw new Error("Nilai pindai otomatis tidak valid.");
    }
    autoSyncOnVisit = raw.autoSyncOnVisit;
  }

  let timeFilter = base.timeFilter;
  if ("timeFilter" in raw && raw.timeFilter !== undefined) {
    if (!isTimeFilter(raw.timeFilter)) {
      throw new Error("Pilihan filter waktu tidak valid.");
    }
    timeFilter = raw.timeFilter;
  } else if ("includePastAssignments" in raw && raw.includePastAssignments !== undefined) {
    if (typeof raw.includePastAssignments !== "boolean") {
      throw new Error("Nilai filter tugas lampau tidak valid.");
    }
    timeFilter = raw.includePastAssignments ? "all" : "recent_7d";
  }

  let statusFilter = base.statusFilter;
  if ("statusFilter" in raw && raw.statusFilter !== undefined) {
    if (!isStatusFilter(raw.statusFilter)) {
      throw new Error("Pilihan filter status tidak valid.");
    }
    statusFilter = raw.statusFilter;
  } else if ("syncSubmitted" in raw && raw.syncSubmitted !== undefined) {
    if (typeof raw.syncSubmitted !== "boolean") {
      throw new Error("Nilai filter status pengumpulan tidak valid.");
    }
    statusFilter = raw.syncSubmitted ? "all" : "pending_only";
  }

  let excludedCourseIds = [...base.excludedCourseIds];
  if ("excludedCourseIds" in raw && raw.excludedCourseIds !== undefined) {
    if (!Array.isArray(raw.excludedCourseIds)) {
      throw new Error("Daftar pengecualian mata kuliah tidak valid.");
    }
    for (const item of raw.excludedCourseIds) {
      if (typeof item !== "string") {
        throw new Error("ID mata kuliah yang dikecualikan harus berupa teks.");
      }
    }
    excludedCourseIds = normalizeExcludedCourseIds(raw.excludedCourseIds);
  }

  let reminderMinutes = [...base.reminderMinutes];
  if ("reminderMinutes" in raw && raw.reminderMinutes !== undefined) {
    if (!Array.isArray(raw.reminderMinutes)) {
      throw new Error("Pilihan pengingat tidak valid.");
    }
    const seen = new Set<ReminderMinutePreset>();
    for (const item of raw.reminderMinutes) {
      if (!isReminderMinutePreset(item)) {
        throw new Error("Preset waktu pengingat tidak valid.");
      }
      seen.add(item);
    }
    if (seen.size > MAX_REMINDER_OVERRIDES) {
      throw new Error("Maksimal 5 pengingat per event.");
    }
    reminderMinutes = Array.from(seen).sort((a, b) => b - a);
  }

  let pendingColorId = base.pendingColorId;
  if ("pendingColorId" in raw && raw.pendingColorId !== undefined) {
    if (!isCalendarColorId(raw.pendingColorId)) {
      throw new Error("Warna event tugas belum dikumpulkan tidak valid.");
    }
    pendingColorId = raw.pendingColorId;
  }

  let submittedColorId = base.submittedColorId;
  if ("submittedColorId" in raw && raw.submittedColorId !== undefined) {
    if (!isCalendarColorId(raw.submittedColorId)) {
      throw new Error("Warna event tugas sudah dikumpulkan tidak valid.");
    }
    submittedColorId = raw.submittedColorId;
  }

  return {
    calendarId,
    timeFilter,
    statusFilter,
    excludedCourseIds,
    reminderMinutes,
    pendingColorId,
    submittedColorId,
    autoSyncOnVisit,
  };
}
