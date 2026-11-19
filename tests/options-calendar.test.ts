import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalendarListItemDto } from "../src/calendar/google-calendar-rest.js";
import type { ListCalendarsResponse } from "../src/background/calendar-list-handler.js";
import {
  buildCalendarDropdownOptions,
  createOptionsController,
  renderCalendarPickerToDom,
  type CalendarPickerDomElements,
  type CalendarPickerViewState,
  type OptionsFormAdapter,
  type OptionsWorkerResponse,
} from "../src/options/options-controller.js";
import { DEFAULT_SETTINGS, type ExtensionSettings, type StoredExtensionState } from "../src/shared/storage.js";

function makeState(overrides: Partial<StoredExtensionState> = {}): StoredExtensionState {
  return {
    courses: [],
    assignments: [],
    lastScanAt: "2026-11-19T00:00:00.000Z",
    lastScanError: null,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastSyncError: null,
    googleConnected: true,
    googleAuthVerified: true,
    googleSessionGeneration: 1,
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeTestHarness() {
  let formDisabled = true;
  let reloadVisible = false;
  let status = "";
  let statusIsError = false;
  let draft: ExtensionSettings = { ...DEFAULT_SETTINGS };
  let pickerState: CalendarPickerViewState = {
    status: "idle",
    message: "",
    options: [],
    selectedValue: "primary",
    showRefresh: false,
    showAuthorize: false,
    showDestinationChangedNotice: false,
  };

  const adapter: OptionsFormAdapter = {
    setFormDisabled(disabled) {
      formDisabled = disabled;
    },
    setReloadVisible(visible) {
      reloadVisible = visible;
    },
    setStatus(msg, isError = false) {
      status = msg;
      statusIsError = isError;
    },
    renderState(state) {
      draft = {
        ...state.settings,
        excludedCourseIds: [...state.settings.excludedCourseIds],
        reminderMinutes: [...state.settings.reminderMinutes],
      };
    },
    readDraft() {
      return {
        ...draft,
        excludedCourseIds: [...draft.excludedCourseIds],
        reminderMinutes: [...draft.reminderMinutes],
      };
    },
    setCalendarDraft(calendarId) {
      draft = { ...draft, calendarId };
    },
    renderCalendarPicker(next) {
      pickerState = next;
    },
  };

  return {
    adapter,
    setDraftCalendarId(value: string) {
      draft = { ...draft, calendarId: value };
    },
    get: () => ({ formDisabled, reloadVisible, status, statusIsError, draft, pickerState }),
  };
}

describe("buildCalendarDropdownOptions (AC7)", () => {
  it("Marks primary with (Utama) using alias primary, preserves explicit missing saved ID, and keeps HTML characters as plain text labels", () => {
    const calendars: CalendarListItemDto[] = [
      { id: "alice@gmail.com", label: "Alice Main", primary: true },
      { id: "cal-html", label: '<img src=x onerror="alert(1)"> Kuliah', primary: false },
    ];

    const optsDefault = buildCalendarDropdownOptions(calendars, "primary");
    expect(optsDefault).toEqual([
      { value: "primary", label: "Alice Main (Utama)" },
      { value: "cal-html", label: '<img src=x onerror="alert(1)"> Kuliah' },
    ]);

    const optsMissingSaved = buildCalendarDropdownOptions(calendars, "old-missing@group.calendar.google.com");
    expect(optsMissingSaved[0]).toEqual({
      value: "old-missing@group.calendar.google.com",
      label: "old-missing@group.calendar.google.com (ID manual / tidak ada di daftar)",
    });
  });
});

describe("Options calendar picker controller (AC7-AC9)", () => {
  it("Allows saving manual Calendar ID while silent LIST_CALENDARS is still pending and never overwrites typed draft when list arrives", async () => {
    const sentMessages: unknown[] = [];
    const listDeferred = createDeferred<ListCalendarsResponse>();
    const initialState = makeState({
      settings: { ...DEFAULT_SETTINGS, calendarId: "primary" },
    });

    const harness = makeTestHarness();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        const m = msg as { type: string; settings?: ExtensionSettings };
        if (m.type === "GET_STATE") {
          return { ok: true, state: initialState } satisfies OptionsWorkerResponse;
        }
        if (m.type === "LIST_CALENDARS") {
          return listDeferred.promise;
        }
        if (m.type === "SAVE_SETTINGS") {
          return {
            ok: true,
            state: makeState({ settings: m.settings! }),
          } satisfies OptionsWorkerResponse;
        }
        return undefined;
      },
      adapter: harness.adapter,
    });

    // Load resolves GET_STATE immediately; silent list stays in flight
    await controller.load();
    expect(harness.get().formDisabled).toBe(false);
    expect(harness.get().pickerState.status).toBe("loading");

    // User types a manual calendar ID before list finishes and saves
    harness.setDraftCalendarId("manual-cal@group.calendar.google.com");
    controller.onManualCalendarInput("manual-cal@group.calendar.google.com");
    const saved = await controller.save();
    expect(saved).toBe(true);
    expect(
      sentMessages.filter((m) => (m as { type: string }).type === "SAVE_SETTINGS")
    ).toHaveLength(1);

    // Now the slow list resolves: it must NOT clobber the saved manual ID
    listDeferred.resolve({
      ok: true,
      calendars: [
        { id: "alice@gmail.com", label: "Alice", primary: true },
        { id: "kuliah@group.calendar.google.com", label: "Kuliah", primary: false },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.get().draft.calendarId).toBe("manual-cal@group.calendar.google.com");
    expect(harness.get().pickerState.selectedValue).toBe("manual-cal@group.calendar.google.com");
  });

  it("Ignores out-of-order refresh responses so an older slower refresh never replaces a newer refresh (AC9)", async () => {
    const firstList = createDeferred<ListCalendarsResponse>();
    const secondList = createDeferred<ListCalendarsResponse>();
    let listCallCount = 0;

    const harness = makeTestHarness();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        const m = msg as { type: string };
        if (m.type === "GET_STATE") {
          return { ok: true, state: makeState() };
        }
        if (m.type === "LIST_CALENDARS") {
          listCallCount++;
          return listCallCount === 1 ? firstList.promise : secondList.promise;
        }
        return undefined;
      },
      adapter: harness.adapter,
    });

    await controller.load(); // starts list #1
    const refresh2Promise = controller.refreshCalendars(false); // starts list #2

    // List #2 resolves first with newer data
    secondList.resolve({
      ok: true,
      calendars: [{ id: "cal-new", label: "Kalender Baru", primary: false }],
    });
    await refresh2Promise;
    expect(harness.get().pickerState.options.some((o) => o.value === "cal-new")).toBe(true);

    // List #1 resolves late with stale data -> must be ignored
    firstList.resolve({
      ok: true,
      calendars: [{ id: "cal-stale", label: "Kalender Lama", primary: false }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.get().pickerState.options.some((o) => o.value === "cal-new")).toBe(true);
    expect(harness.get().pickerState.options.some((o) => o.value === "cal-stale")).toBe(false);
  });

  it("Handles GRANT_REQUIRED and user cancellation gracefully without sending SAVE_SETTINGS, and saves primary alias only on explicit Save (AC7, AC8)", async () => {
    const sentMessages: Array<{ type: string; interactive?: boolean; settings?: ExtensionSettings }> = [];
    let interactiveAttempt = 0;
    const savedState = makeState({
      settings: { ...DEFAULT_SETTINGS, calendarId: "old-cal@group.calendar.google.com" },
    });

    const harness = makeTestHarness();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        const m = msg as { type: string; interactive?: boolean; settings?: ExtensionSettings };
        sentMessages.push(m);
        if (m.type === "GET_STATE") {
          return { ok: true, state: savedState };
        }
        if (m.type === "LIST_CALENDARS") {
          if (!m.interactive) {
            return {
              ok: false,
              code: "GRANT_REQUIRED",
              message: "Izin daftar kalender belum diberikan.",
            } satisfies ListCalendarsResponse;
          }
          interactiveAttempt++;
          if (interactiveAttempt === 1) {
            return {
              ok: false,
              code: "USER_CANCELLED",
              message: "Dibatalkan oleh pengguna.",
            } satisfies ListCalendarsResponse;
          }
          return {
            ok: true,
            calendars: [
              { id: "user@gmail.com", label: "Kalender Pribadi", primary: true },
              { id: "kuliah@group.calendar.google.com", label: "Jadwal Kuliah", primary: false },
            ],
          } satisfies ListCalendarsResponse;
        }
        if (m.type === "SAVE_SETTINGS") {
          return { ok: true, state: makeState({ settings: m.settings! }) };
        }
        return undefined;
      },
      adapter: harness.adapter,
    });

    await controller.load();
    await Promise.resolve();
    expect(harness.get().pickerState.status).toBe("grant_required");
    expect(harness.get().pickerState.showAuthorize).toBe(true);

    // First interactive click cancelled -> stays interactive-authorizable, zero SAVE_SETTINGS
    await controller.refreshCalendars(true);
    expect(harness.get().pickerState.showAuthorize).toBe(true);
    expect(sentMessages.filter((m) => m.type === "SAVE_SETTINGS")).toHaveLength(0);

    // Second interactive click granted -> dropdown ready, user selects primary alias
    await controller.refreshCalendars(true);
    expect(harness.get().pickerState.status).toBe("ready");
    controller.onDropdownCalendarSelect("primary");
    expect(harness.get().draft.calendarId).toBe("primary");
    expect(harness.get().pickerState.showDestinationChangedNotice).toBe(true);
    // Selection alone does NOT save
    expect(sentMessages.filter((m) => m.type === "SAVE_SETTINGS")).toHaveLength(0);

    // Explicit Save persists "primary"
    await controller.save();
    const saveCalls = sentMessages.filter((m) => m.type === "SAVE_SETTINGS");
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]!.settings?.calendarId).toBe("primary");
  });

  it("Clears loaded calendars and drops pending responses when session disconnects externally (AC9)", async () => {
    const pendingList = createDeferred<ListCalendarsResponse>();
    const harness = makeTestHarness();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        const m = msg as { type: string };
        if (m.type === "GET_STATE") {
          return { ok: true, state: makeState({ googleSessionGeneration: 2 }) };
        }
        if (m.type === "LIST_CALENDARS") {
          return pendingList.promise;
        }
        return undefined;
      },
      adapter: harness.adapter,
    });

    await controller.load();
    expect(harness.get().pickerState.status).toBe("loading");

    // External disconnect arrives via storage change
    controller.onExternalStateChange(
      makeState({
        googleConnected: false,
        googleAuthVerified: false,
        googleSessionGeneration: 3,
      })
    );
    expect(harness.get().pickerState.status).toBe("idle");
    expect(harness.get().pickerState.options).toEqual([]);

    // Old in-flight list resolves after disconnect -> must NOT populate options
    pendingList.resolve({
      ok: true,
      calendars: [{ id: "leaked@gmail.com", label: "Old Account", primary: true }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.get().pickerState.status).toBe("idle");
    expect(harness.get().pickerState.options).toEqual([]);
  });

  it("Keeps form blocked and does not call LIST_CALENDARS when GET_STATE fails", async () => {
    const sentTypes: string[] = [];
    const harness = makeTestHarness();
    const controller = createOptionsController({
      sendMessage: async (msg) => {
        const type = (msg as { type: string }).type;
        sentTypes.push(type);
        throw new Error("GET_STATE failed");
      },
      adapter: harness.adapter,
    });

    await controller.load();
    expect(harness.get().formDisabled).toBe(true);
    expect(harness.get().reloadVisible).toBe(true);
    expect(sentTypes).toEqual(["GET_STATE"]);
  });

  it("Clears rendered DOM <option> nodes and hides picker wrapper with CSS [hidden] rule on ready -> disconnect (AC9)", async () => {
    interface FakeOption {
      value: string;
      textContent: string;
    }

    const renderedOptions: FakeOption[] = [];
    const statusClasses = new Set<string>();
    const domElements: CalendarPickerDomElements = {
      calendarPickerWrap: { hidden: true },
      calendarSelect: {
        disabled: true,
        value: "",
        replaceChildren: () => {
          renderedOptions.length = 0;
        },
        append: (opt) => {
          renderedOptions.push(opt);
        },
      },
      createOption: (value, label) => ({ value, textContent: label }),
      btnRefreshCalendars: { hidden: true, disabled: true },
      btnAuthorizeCalendars: { hidden: true, disabled: true },
      calendarPickerStatus: {
        textContent: "",
        toggleErrorClass: (isError) => {
          if (isError) statusClasses.add("status-error");
          else statusClasses.delete("status-error");
        },
      },
      calendarDestinationNotice: { hidden: true },
    };

    const controller = createOptionsController({
      sendMessage: async (msg) => {
        const m = msg as { type: string };
        if (m.type === "GET_STATE") {
          return { ok: true, state: makeState({ googleSessionGeneration: 1 }) };
        }
        if (m.type === "LIST_CALENDARS") {
          return {
            ok: true,
            calendars: [
              { id: "alice@gmail.com", label: "Alice Main", primary: true },
              { id: "kuliah@group.calendar.google.com", label: "Kuliah", primary: false },
            ],
          } satisfies ListCalendarsResponse;
        }
        return undefined;
      },
      adapter: {
        setFormDisabled() {},
        setReloadVisible() {},
        setStatus() {},
        renderState() {},
        readDraft: () => ({ ...DEFAULT_SETTINGS }),
        renderCalendarPicker(picker) {
          renderCalendarPickerToDom(domElements, picker, false);
        },
      },
    });

    await controller.load();
    await Promise.resolve();
    await Promise.resolve();

    // Ready state: dropdown visible and populated
    expect(domElements.calendarPickerWrap.hidden).toBe(false);
    expect(renderedOptions).toHaveLength(2);
    expect(domElements.calendarSelect.disabled).toBe(false);

    // Disconnect: DOM options MUST be emptied and wrapper hidden
    controller.onExternalStateChange(
      makeState({
        googleConnected: false,
        googleAuthVerified: false,
        googleSessionGeneration: 2,
      })
    );
    expect(domElements.calendarPickerWrap.hidden).toBe(true);
    expect(renderedOptions).toHaveLength(0);
    expect(domElements.calendarSelect.value).toBe("");
    expect(domElements.calendarSelect.disabled).toBe(true);

    // CSS must not override [hidden] with display: flex
    const optionsCss = readFileSync(resolve(process.cwd(), "src/options/options.css"), "utf8");
    expect(optionsCss).toMatch(/\.calendar-picker-wrap\[hidden\]\s*\{[^}]*display:\s*none/i);
  });
});
