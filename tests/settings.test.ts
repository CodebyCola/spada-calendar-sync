import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseSaveSettingsPayload,
  type ExtensionSettings,
} from "../src/shared/settings.js";
import {
  getStoredState,
  mutateStoredState,
  updateStoredState,
  type StoredExtensionState,
} from "../src/shared/storage.js";
import { runClearLocalData, runSaveSettings } from "../src/background/install-lifecycle.js";
import {
  buildCourseExclusionItems,
  createOptionsController,
  type OptionsFormAdapter,
} from "../src/options/options-controller.js";

function installRawChromeStorage(initialRaw: unknown): {
  readRaw: () => Record<string, unknown>;
} {
  let rawRecord: Record<string, unknown> =
    initialRaw === undefined ? {} : { spadaScannerState: structuredClone(initialRaw) };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(rawRecord[key]) }),
        set: async (items: Record<string, unknown>) => {
          rawRecord = { ...rawRecord, ...structuredClone(items) };
        },
      },
    },
  };

  return {
    readRaw: () => structuredClone(rawRecord),
  };
}

describe("normalizeSettings", () => {
  it("Returns install defaults for empty, null, or non-object inputs", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("invalid")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("Maps all four legacy v1 boolean combinations to canonical enums without legacy keys", () => {
    const cases: Array<{
      input: { includePastAssignments: boolean; syncSubmitted: boolean };
      expected: Pick<ExtensionSettings, "timeFilter" | "statusFilter">;
    }> = [
      {
        input: { includePastAssignments: false, syncSubmitted: true },
        expected: { timeFilter: "recent_7d", statusFilter: "all" },
      },
      {
        input: { includePastAssignments: false, syncSubmitted: false },
        expected: { timeFilter: "recent_7d", statusFilter: "pending_only" },
      },
      {
        input: { includePastAssignments: true, syncSubmitted: true },
        expected: { timeFilter: "all", statusFilter: "all" },
      },
      {
        input: { includePastAssignments: true, syncSubmitted: false },
        expected: { timeFilter: "all", statusFilter: "pending_only" },
      },
    ];

    for (const c of cases) {
      const normalized = normalizeSettings(c.input);
      expect(normalized.timeFilter).toBe(c.expected.timeFilter);
      expect(normalized.statusFilter).toBe(c.expected.statusFilter);
      expect("includePastAssignments" in normalized).toBe(false);
      expect("syncSubmitted" in normalized).toBe(false);
      expect(normalizeSettings(normalized)).toEqual(normalized);
    }
  });

  it("Prefers valid new enums over conflicting legacy booleans", () => {
    const normalized = normalizeSettings({
      timeFilter: "upcoming_only",
      statusFilter: "submitted_only",
      includePastAssignments: true,
      syncSubmitted: false,
    });
    expect(normalized.timeFilter).toBe("upcoming_only");
    expect(normalized.statusFilter).toBe("submitted_only");
  });

  it("Falls back to valid legacy booleans when new enums are corrupt, and defaults when both are corrupt", () => {
    const fallbackLegacy = normalizeSettings({
      timeFilter: "bogus",
      statusFilter: 123,
      includePastAssignments: true,
      syncSubmitted: false,
    });
    expect(fallbackLegacy.timeFilter).toBe("all");
    expect(fallbackLegacy.statusFilter).toBe("pending_only");

    const fallbackDefault = normalizeSettings({
      timeFilter: "bogus",
      statusFilter: "nope",
      includePastAssignments: "yes",
      syncSubmitted: "no",
    });
    expect(fallbackDefault.timeFilter).toBe("recent_7d");
    expect(fallbackDefault.statusFilter).toBe("all");
  });

  it("Normalizes excludedCourseIds by trimming, deduplicating, dropping invalid entries, and keeping unseen IDs", () => {
    const normalized = normalizeSettings({
      calendarId: "  my-cal@group.calendar.google.com  ",
      autoSyncOnVisit: false,
      excludedCourseIds: [" 52581 ", "99999", "52581", "", "   ", 123, null],
    });
    expect(normalized.calendarId).toBe("my-cal@group.calendar.google.com");
    expect(normalized.autoSyncOnVisit).toBe(false);
    expect(normalized.excludedCourseIds).toEqual(["52581", "99999"]);
  });

  it("Normalizes reminderMinutes (missing vs empty vs invalid/duplicate/unsorted/>5) and color IDs independently (AC1, AC6)", () => {
    // Missing -> default [1440, 180]
    expect(normalizeSettings({}).reminderMinutes).toEqual([1440, 180]);

    // Explicitly empty -> preserved as [] (reminders intentionally disabled)
    expect(normalizeSettings({ reminderMinutes: [] }).reminderMinutes).toEqual([]);

    // Mixed valid + invalid + duplicates + unsorted -> deduplicated valid presets sorted descending
    expect(
      normalizeSettings({ reminderMinutes: [60, 999, 1440, 60, -5, 4320, "180"] }).reminderMinutes
    ).toEqual([4320, 1440, 60]);

    // More than 5 raw values with valid presets -> capped to max 5 unique sorted descending
    expect(
      normalizeSettings({ reminderMinutes: [60, 180, 360, 1440, 4320, 1440, 9999] })
        .reminderMinutes
    ).toEqual([4320, 1440, 360, 180, 60]);

    // Non-empty array where ALL entries are corrupt -> restore default [1440, 180]
    expect(normalizeSettings({ reminderMinutes: [999, "bad", null] }).reminderMinutes).toEqual([
      1440, 180,
    ]);

    // Colors normalized independently
    const colors = normalizeSettings({ pendingColorId: "11", submittedColorId: "99" });
    expect(colors.pendingColorId).toBe("11");
    expect(colors.submittedColorId).toBe("default");

    const colors2 = normalizeSettings({ pendingColorId: "0", submittedColorId: "10" });
    expect(colors2.pendingColorId).toBe("default");
    expect(colors2.submittedColorId).toBe("10");
  });
});

describe("parseSaveSettingsPayload", () => {
  it("Rejects invalid types or unknown enum values", () => {
    expect(() => parseSaveSettingsPayload(null, DEFAULT_SETTINGS)).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ timeFilter: "invalid_window" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ statusFilter: "archived" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ excludedCourseIds: "52581" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ excludedCourseIds: [123] }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ autoSyncOnVisit: "true" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ reminderMinutes: [1234] }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ reminderMinutes: "1440" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ pendingColorId: "12" }, DEFAULT_SETTINGS)
    ).toThrow();
    expect(() =>
      parseSaveSettingsPayload({ submittedColorId: "" }, DEFAULT_SETTINGS)
    ).toThrow();
  });

  it("Normalizes legacy v1 save payloads while preserving newer settings not sent by older Options pages", () => {
    const current: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      excludedCourseIds: ["52581", "77777"],
      reminderMinutes: [360, 60],
      pendingColorId: "6",
      submittedColorId: "10",
    };
    const next = parseSaveSettingsPayload(
      {
        calendarId: "kuliah@group.calendar.google.com",
        includePastAssignments: true,
        syncSubmitted: false,
        autoSyncOnVisit: false,
      },
      current
    );

    expect(next).toEqual({
      calendarId: "kuliah@group.calendar.google.com",
      timeFilter: "all",
      statusFilter: "pending_only",
      excludedCourseIds: ["52581", "77777"],
      reminderMinutes: [360, 60],
      pendingColorId: "6",
      submittedColorId: "10",
      autoSyncOnVisit: false,
    });
    expect("includePastAssignments" in next).toBe(false);
    expect("syncSubmitted" in next).toBe(false);
  });
});

describe("Storage migration & SAVE_SETTINGS integration (AC1)", () => {
  it("Reads legacy v1 state, saves canonical settings via runSaveSettings, and preserves history and generation", async () => {
    const storage = installRawChromeStorage({
      courses: [
        {
          courseId: "52581",
          courseName: "Kapita Selekta",
          shortCourseName: "Kapita Selekta",
          courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
        },
      ],
      assignments: [],
      lastScanAt: "2026-11-18T10:00:00.000Z",
      lastScanError: null,
      lastSyncAt: "2026-11-18T10:05:00.000Z",
      lastSyncSummary: { created: 2, updated: 1, skipped: 0 },
      lastSyncError: null,
      googleConnected: true,
      googleAuthVerified: true,
      googleSessionGeneration: 4,
      settings: {
        calendarId: "kuliah@group.calendar.google.com",
        syncSubmitted: false,
        includePastAssignments: true,
        autoSyncOnVisit: false,
      },
    });

    const migrated = await getStoredState();
    expect(migrated.settings).toEqual({
      calendarId: "kuliah@group.calendar.google.com",
      timeFilter: "all",
      statusFilter: "pending_only",
      excludedCourseIds: [],
      reminderMinutes: [1440, 180],
      pendingColorId: "default",
      submittedColorId: "default",
      autoSyncOnVisit: false,
    });
    expect(migrated.lastSyncAt).toBe("2026-11-18T10:05:00.000Z");
    expect(migrated.lastSyncSummary).toEqual({ created: 2, updated: 1, skipped: 0 });
    expect(migrated.googleSessionGeneration).toBe(4);

    const saved = await runSaveSettings(
      {
        calendarId: "kuliah@group.calendar.google.com",
        timeFilter: "upcoming_only",
        statusFilter: "pending_only",
        excludedCourseIds: ["52581", "99999", "52581"],
        reminderMinutes: [60, 1440],
        pendingColorId: "11",
        submittedColorId: "10",
        autoSyncOnVisit: false,
      },
      {
        getState: getStoredState,
        updateState: updateStoredState,
        mutateState: mutateStoredState,
      }
    );

    expect(saved.settings).toEqual({
      calendarId: "kuliah@group.calendar.google.com",
      timeFilter: "upcoming_only",
      statusFilter: "pending_only",
      excludedCourseIds: ["52581", "99999"],
      reminderMinutes: [1440, 60],
      pendingColorId: "11",
      submittedColorId: "10",
      autoSyncOnVisit: false,
    });
    expect(saved.lastScanAt).toBe("2026-11-18T10:00:00.000Z");
    expect(saved.lastSyncAt).toBe("2026-11-18T10:05:00.000Z");
    expect(saved.googleSessionGeneration).toBe(4);

    const persistedRaw = storage.readRaw().spadaScannerState as Record<string, unknown>;
    const persistedSettings = persistedRaw.settings as Record<string, unknown>;
    expect("includePastAssignments" in persistedSettings).toBe(false);
    expect("syncSubmitted" in persistedSettings).toBe(false);

    const reRead = await getStoredState();
    expect(reRead.settings).toEqual(saved.settings);

    // Invalid save keeps persisted preferences intact
    await expect(
      runSaveSettings(
        { timeFilter: "bad_value" } as unknown as ExtensionSettings,
        {
          getState: getStoredState,
          updateState: updateStoredState,
          mutateState: mutateStoredState,
        }
      )
    ).rejects.toThrow();

    const afterInvalid = await getStoredState();
    expect(afterInvalid.settings).toEqual(saved.settings);

    // Reset restores install defaults
    const cleared = await runClearLocalData({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      updateBadge: async () => {},
    });
    expect(cleared.settings).toEqual(DEFAULT_SETTINGS);
    expect(cleared.googleSessionGeneration).toBe(5);
  });
});

describe("Options form readiness & course exclusion controller", () => {
  function makeMemoryAdapter(): {
    adapter: OptionsFormAdapter;
    snapshot: () => {
      disabled: boolean;
      reloadVisible: boolean;
      status: string;
      statusIsError: boolean;
      draft: ExtensionSettings;
      courseItems: ReturnType<typeof buildCourseExclusionItems>;
    };
  } {
    let disabled = true;
    let reloadVisible = false;
    let status = "";
    let statusIsError = false;
    let draft: ExtensionSettings = { ...DEFAULT_SETTINGS, excludedCourseIds: [] };
    let courseItems: ReturnType<typeof buildCourseExclusionItems> = [];

    const adapter: OptionsFormAdapter = {
      setFormDisabled(value) {
        disabled = value;
      },
      setReloadVisible(value) {
        reloadVisible = value;
      },
      setStatus(message, isError = false) {
        status = message;
        statusIsError = isError;
      },
      renderState(state, items) {
        draft = {
          ...state.settings,
          excludedCourseIds: [...state.settings.excludedCourseIds],
        };
        courseItems = items;
      },
      readDraft() {
        return {
          ...draft,
          excludedCourseIds: [...draft.excludedCourseIds],
        };
      },
    };

    return {
      adapter,
      snapshot: () => ({ disabled, reloadVisible, status, statusIsError, draft, courseItems }),
    };
  }

  it("Builds union of visible courses and previously excluded course IDs using ID as fallback label", () => {
    const items = buildCourseExclusionItems(
      [
        {
          courseId: "52581",
          courseName: "Kapita Selekta IF-C",
          shortCourseName: "Kapita Selekta",
          courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
        },
        {
          courseId: "52582",
          courseName: "Pemrograman Web",
          shortCourseName: "Pemrograman Web",
          courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52582",
        },
      ],
      ["52582", "99123"]
    );

    expect(items).toEqual([
      { courseId: "52581", label: "Kapita Selekta IF-C", excluded: false, missingFromLatestScan: false },
      { courseId: "52582", label: "Pemrograman Web", excluded: true, missingFromLatestScan: false },
      { courseId: "99123", label: "99123", excluded: true, missingFromLatestScan: true },
    ]);
  });

  it("Keeps form disabled and blocks SAVE_SETTINGS when GET_STATE fails, then unlocks on reload", async () => {
    const sentMessages: unknown[] = [];
    let shouldFailGetState = true;

    const loadedState: StoredExtensionState = {
      courses: [
        {
          courseId: "52581",
          courseName: "Kapita Selekta",
          shortCourseName: "Kapita Selekta",
          courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
        },
      ],
      assignments: [],
      lastScanAt: "2026-11-19T00:00:00.000Z",
      lastScanError: null,
      lastSyncAt: null,
      lastSyncSummary: null,
      lastSyncError: null,
      googleConnected: false,
      googleAuthVerified: false,
      googleSessionGeneration: 0,
      settings: {
        ...DEFAULT_SETTINGS,
        calendarId: "kuliah@group.calendar.google.com",
        timeFilter: "upcoming_only",
        statusFilter: "pending_only",
        excludedCourseIds: ["99123"],
        autoSyncOnVisit: false,
      },
    };

    const { adapter, snapshot } = makeMemoryAdapter();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        if ((msg as { type: string }).type === "GET_STATE") {
          if (shouldFailGetState) {
            throw new Error("Worker unavailable");
          }
          return { ok: true, state: loadedState };
        }
        return { ok: true, state: loadedState };
      },
      adapter,
    });

    await controller.load();
    expect(snapshot().disabled).toBe(true);
    expect(snapshot().reloadVisible).toBe(true);
    expect(snapshot().statusIsError).toBe(true);

    // Attempt to save while unloaded must NOT send SAVE_SETTINGS
    await controller.save();
    expect(sentMessages.filter((m) => (m as { type: string }).type === "SAVE_SETTINGS")).toHaveLength(
      0
    );

    // Reload succeeds and unlocks form with loaded settings
    shouldFailGetState = false;
    await controller.load();
    expect(snapshot().disabled).toBe(false);
    expect(snapshot().reloadVisible).toBe(false);
    expect(snapshot().draft).toEqual(loadedState.settings);
    expect(snapshot().courseItems).toHaveLength(2);

    // Now save sends SAVE_SETTINGS
    await controller.save();
    const saveCalls = sentMessages.filter((m) => (m as { type: string }).type === "SAVE_SETTINGS");
    expect(saveCalls).toHaveLength(1);
  });
});
