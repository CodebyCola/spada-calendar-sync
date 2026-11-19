import type { ListCalendarsResponse } from "../background/calendar-list-handler.js";
import type { CalendarListItemDto } from "../calendar/google-calendar-rest.js";
import type { SpadaCourse } from "../parsers/spada-html.js";
import type { ExtensionSettings, StoredExtensionState } from "../shared/storage.js";

export interface CourseExclusionItem {
  courseId: string;
  label: string;
  excluded: boolean;
  missingFromLatestScan: boolean;
}

export interface OptionsWorkerResponse {
  ok: boolean;
  error?: string;
  state?: StoredExtensionState;
}

export interface CalendarDropdownOption {
  value: string;
  label: string;
}

export type CalendarPickerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "grant_required"
  | "error";

export interface CalendarPickerViewState {
  status: CalendarPickerStatus;
  message: string;
  options: CalendarDropdownOption[];
  selectedValue: string;
  showRefresh: boolean;
  showAuthorize: boolean;
  showDestinationChangedNotice: boolean;
}

export interface CalendarPickerDomElements<TOption = { value: string; textContent: string }> {
  calendarPickerWrap: { hidden: boolean };
  calendarSelect: {
    disabled: boolean;
    value: string;
    replaceChildren: () => void;
    append: (option: TOption) => void;
  };
  createOption: (value: string, label: string) => TOption;
  btnRefreshCalendars: { hidden: boolean; disabled: boolean };
  btnAuthorizeCalendars: { hidden: boolean; disabled: boolean };
  calendarPickerStatus: {
    textContent: string | null;
    toggleErrorClass: (isError: boolean) => void;
  };
  calendarDestinationNotice: { hidden: boolean };
}

/**
 * Applies CalendarPickerViewState to DOM elements, always clearing stale <option> nodes
 * whenever the dropdown is hidden or invalidated (e.g., on disconnect/reset).
 */
export function renderCalendarPickerToDom<TOption>(
  elements: CalendarPickerDomElements<TOption>,
  picker: CalendarPickerViewState,
  formDisabled: boolean
): void {
  const showDropdown = picker.status === "ready" && picker.options.length > 0;
  elements.calendarPickerWrap.hidden = !showDropdown;

  elements.calendarSelect.replaceChildren();
  if (showDropdown) {
    for (const opt of picker.options) {
      elements.calendarSelect.append(elements.createOption(opt.value, opt.label));
    }
    elements.calendarSelect.value = picker.selectedValue;
  } else {
    elements.calendarSelect.value = "";
  }
  elements.calendarSelect.disabled = formDisabled || !showDropdown;

  elements.btnRefreshCalendars.hidden = !picker.showRefresh;
  elements.btnRefreshCalendars.disabled = formDisabled || picker.status === "loading";

  elements.btnAuthorizeCalendars.hidden = !picker.showAuthorize;
  elements.btnAuthorizeCalendars.disabled = formDisabled || picker.status === "loading";

  elements.calendarPickerStatus.textContent = picker.message;
  elements.calendarPickerStatus.toggleErrorClass(picker.status === "error");

  elements.calendarDestinationNotice.hidden = !picker.showDestinationChangedNotice;
}

export interface OptionsFormAdapter {
  setFormDisabled(disabled: boolean): void;
  setReloadVisible(visible: boolean): void;
  setStatus(message: string, isError?: boolean): void;
  renderState(state: StoredExtensionState, courseItems: CourseExclusionItem[]): void;
  readDraft(): ExtensionSettings;
  setCalendarDraft?(calendarId: string): void;
  renderCalendarPicker?(picker: CalendarPickerViewState): void;
}

export interface OptionsControllerDeps {
  sendMessage: (message: unknown) => Promise<unknown>;
  adapter: OptionsFormAdapter;
}

export function buildCourseExclusionItems(
  courses: SpadaCourse[],
  excludedCourseIds: string[]
): CourseExclusionItem[] {
  const excludedSet = new Set(excludedCourseIds);
  const seenIds = new Set<string>();
  const items: CourseExclusionItem[] = [];

  for (const course of courses) {
    const id = course.courseId.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    items.push({
      courseId: id,
      label: course.courseName.trim() || id,
      excluded: excludedSet.has(id),
      missingFromLatestScan: false,
    });
  }

  for (const rawId of excludedCourseIds) {
    const id = rawId.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    items.push({
      courseId: id,
      label: id,
      excluded: true,
      missingFromLatestScan: true,
    });
  }

  return items;
}

/**
 * Builds dropdown options from writable calendars.
 * Primary calendar uses alias value "primary" and "(Utama)" label; any saved/draft ID not
 * matched by the list (including an explicit email ID or missing calendar) is preserved as a
 * selectable fallback entry without mutating the draft.
 */
export function buildCalendarDropdownOptions(
  calendars: CalendarListItemDto[],
  currentDraftId: string
): CalendarDropdownOption[] {
  const normalizedDraft = currentDraftId.trim() || "primary";
  const options: CalendarDropdownOption[] = [];
  const labelCounts = new Map<string, number>();

  for (const cal of calendars) {
    if (!cal.primary) {
      labelCounts.set(cal.label, (labelCounts.get(cal.label) ?? 0) + 1);
    }
  }

  let hasPrimaryOption = false;
  for (const cal of calendars) {
    if (cal.primary && !hasPrimaryOption) {
      hasPrimaryOption = true;
      options.push({
        value: "primary",
        label: `${cal.label} (Utama)`,
      });
    } else {
      const duplicate = (labelCounts.get(cal.label) ?? 0) > 1;
      options.push({
        value: cal.id,
        label: duplicate ? `${cal.label} (${cal.id})` : cal.label,
      });
    }
  }

  const matched = options.some((opt) => opt.value === normalizedDraft);
  if (!matched) {
    options.unshift({
      value: normalizedDraft,
      label: `${normalizedDraft} (ID manual / tidak ada di daftar)`,
    });
  }

  return options;
}

export function createOptionsController(deps: OptionsControllerDeps) {
  let stateLoaded = false;
  let busy = false;
  let currentState: StoredExtensionState | null = null;
  let currentCalendarDraft = "primary";

  let calendarRequestSeq = 0;
  let loadedCalendars: CalendarListItemDto[] = [];
  let pickerStatus: CalendarPickerStatus = "idle";
  let pickerMessage = "";
  let pickerShowAuthorize = false;

  const isConnected = (state: StoredExtensionState | null): boolean =>
    Boolean(state && state.googleConnected && state.googleAuthVerified);

  const syncDisabled = (): void => {
    deps.adapter.setFormDisabled(!stateLoaded || busy);
  };

  const emitCalendarPicker = (): void => {
    if (!deps.adapter.renderCalendarPicker) {
      return;
    }
    const savedId = currentState?.settings.calendarId ?? "primary";
    const normalizedDraft = currentCalendarDraft.trim() || "primary";
    const connected = isConnected(currentState);
    const options =
      pickerStatus === "ready"
        ? buildCalendarDropdownOptions(loadedCalendars, normalizedDraft)
        : [];

    deps.adapter.renderCalendarPicker({
      status: pickerStatus,
      message: pickerMessage,
      options,
      selectedValue: normalizedDraft,
      showRefresh: stateLoaded && connected,
      showAuthorize: stateLoaded && connected && pickerShowAuthorize,
      showDestinationChangedNotice: stateLoaded && normalizedDraft !== savedId,
    });
  };

  const resetCalendarPickerToIdle = (message: string): void => {
    calendarRequestSeq++;
    loadedCalendars = [];
    pickerStatus = "idle";
    pickerMessage = message;
    pickerShowAuthorize = false;
    emitCalendarPicker();
  };

  async function refreshCalendars(interactive: boolean): Promise<void> {
    if (!stateLoaded || !currentState || !isConnected(currentState)) {
      resetCalendarPickerToIdle(
        "Hubungkan Google Calendar terlebih dahulu untuk memilih dari daftar kalender, atau isi ID manual di bawah."
      );
      return;
    }

    const reqSeq = ++calendarRequestSeq;
    const reqGeneration = currentState.googleSessionGeneration;
    pickerStatus = "loading";
    pickerMessage = "Memuat daftar kalender Google...";
    pickerShowAuthorize = false;
    emitCalendarPicker();

    try {
      const res = (await deps.sendMessage({
        type: "LIST_CALENDARS",
        interactive,
      })) as ListCalendarsResponse | undefined;

      if (
        reqSeq !== calendarRequestSeq ||
        !currentState ||
        !isConnected(currentState) ||
        currentState.googleSessionGeneration !== reqGeneration
      ) {
        return;
      }

      if (!res) {
        pickerStatus = "error";
        pickerMessage = "Tidak ada respons dari background ekstensi. Gunakan ID manual atau klik Muat ulang.";
        pickerShowAuthorize = false;
        emitCalendarPicker();
        return;
      }

      if (res.ok) {
        loadedCalendars = res.calendars;
        if (res.calendars.length === 0) {
          pickerStatus = "empty";
          pickerMessage =
            "Tidak ada kalender yang dapat ditulisi ditemukan. Anda tetap bisa mengisi ID kalender manual.";
        } else {
          pickerStatus = "ready";
          pickerMessage = "";
        }
        pickerShowAuthorize = false;
        emitCalendarPicker();
        return;
      }

      if (res.code === "STALE_SESSION") {
        return;
      }

      if (res.code === "NOT_CONNECTED") {
        resetCalendarPickerToIdle(res.message);
        return;
      }

      if (res.code === "GRANT_REQUIRED" || res.code === "USER_CANCELLED") {
        loadedCalendars = [];
        pickerStatus = "grant_required";
        pickerMessage = res.message;
        pickerShowAuthorize = true;
        emitCalendarPicker();
        return;
      }

      loadedCalendars = [];
      pickerStatus = "error";
      pickerMessage = res.message;
      pickerShowAuthorize = false;
      emitCalendarPicker();
    } catch {
      if (
        reqSeq !== calendarRequestSeq ||
        !currentState ||
        !isConnected(currentState) ||
        currentState.googleSessionGeneration !== reqGeneration
      ) {
        return;
      }
      loadedCalendars = [];
      pickerStatus = "error";
      pickerMessage = "Gagal memuat daftar kalender. Gunakan ID manual atau klik Muat ulang.";
      pickerShowAuthorize = false;
      emitCalendarPicker();
    }
  }

  async function load(): Promise<boolean> {
    busy = true;
    stateLoaded = false;
    syncDisabled();
    deps.adapter.setReloadVisible(false);
    deps.adapter.setStatus("Memuat pengaturan...", false);

    try {
      const res = (await deps.sendMessage({ type: "GET_STATE" })) as
        | OptionsWorkerResponse
        | undefined;
      if (!res?.ok || !res.state) {
        deps.adapter.setReloadVisible(true);
        deps.adapter.setStatus(
          res?.error || "Gagal memuat pengaturan. Klik Muat Ulang untuk mencoba lagi.",
          true
        );
        return false;
      }
      currentState = res.state;
      currentCalendarDraft = res.state.settings.calendarId;
      stateLoaded = true;
      const courseItems = buildCourseExclusionItems(
        res.state.courses,
        res.state.settings.excludedCourseIds
      );
      deps.adapter.renderState(res.state, courseItems);
      deps.adapter.setReloadVisible(false);
      deps.adapter.setStatus("", false);
    } catch {
      deps.adapter.setReloadVisible(true);
      deps.adapter.setStatus(
        "Gagal memuat pengaturan. Klik Muat Ulang untuk mencoba lagi.",
        true
      );
      return false;
    } finally {
      busy = false;
      syncDisabled();
    }

    if (isConnected(currentState)) {
      // Load calendar list asynchronously without blocking GET_STATE readiness or Save
      void refreshCalendars(false);
    } else {
      resetCalendarPickerToIdle(
        "Hubungkan Google Calendar terlebih dahulu untuk memilih dari daftar kalender, atau isi ID manual di bawah."
      );
    }

    return true;
  }

  function onDropdownCalendarSelect(selectedValue: string): void {
    if (!stateLoaded) return;
    currentCalendarDraft = selectedValue.trim() || "primary";
    deps.adapter.setCalendarDraft?.(currentCalendarDraft);
    emitCalendarPicker();
  }

  function onManualCalendarInput(value: string): void {
    if (!stateLoaded) return;
    currentCalendarDraft = value;
    emitCalendarPicker();
  }

  function onExternalStateChange(nextState: StoredExtensionState): void {
    const prevGeneration = currentState?.googleSessionGeneration;
    const wasConnected = isConnected(currentState);
    const nowConnected = isConnected(nextState);

    if (currentState) {
      currentState = {
        ...currentState,
        googleConnected: nextState.googleConnected,
        googleAuthVerified: nextState.googleAuthVerified,
        googleSessionGeneration: nextState.googleSessionGeneration,
      };
    }

    if (!nowConnected || (prevGeneration !== undefined && prevGeneration !== nextState.googleSessionGeneration)) {
      resetCalendarPickerToIdle(
        "Hubungkan Google Calendar terlebih dahulu untuk memilih dari daftar kalender, atau isi ID manual di bawah."
      );
      if (stateLoaded && nowConnected) {
        void refreshCalendars(false);
      }
      return;
    }

    if (stateLoaded && !wasConnected && nowConnected) {
      void refreshCalendars(false);
    }
  }

  async function save(): Promise<boolean> {
    if (!stateLoaded || busy) {
      return false;
    }
    busy = true;
    syncDisabled();
    try {
      const draft = deps.adapter.readDraft();
      const res = (await deps.sendMessage({
        type: "SAVE_SETTINGS",
        settings: draft,
      })) as OptionsWorkerResponse | undefined;
      if (!res?.ok || !res.state) {
        deps.adapter.setStatus(res?.error || "Gagal menyimpan pengaturan.", true);
        return false;
      }
      currentState = res.state;
      currentCalendarDraft = res.state.settings.calendarId;
      const courseItems = buildCourseExclusionItems(
        res.state.courses,
        res.state.settings.excludedCourseIds
      );
      deps.adapter.renderState(res.state, courseItems);
      deps.adapter.setStatus("Tersimpan!", false);
      emitCalendarPicker();
      return true;
    } catch {
      deps.adapter.setStatus("Gagal menyimpan pengaturan. Coba lagi.", true);
      return false;
    } finally {
      busy = false;
      syncDisabled();
    }
  }

  async function clearData(): Promise<boolean> {
    if (!stateLoaded || busy) {
      return false;
    }
    busy = true;
    syncDisabled();
    try {
      const res = (await deps.sendMessage({ type: "CLEAR_DATA" })) as
        | OptionsWorkerResponse
        | undefined;
      if (!res?.ok || !res.state) {
        deps.adapter.setStatus(res?.error || "Gagal menghapus data lokal.", true);
        return false;
      }
      currentState = res.state;
      currentCalendarDraft = res.state.settings.calendarId;
      const courseItems = buildCourseExclusionItems(
        res.state.courses,
        res.state.settings.excludedCourseIds
      );
      deps.adapter.renderState(res.state, courseItems);
      deps.adapter.setStatus("Semua data scan & pengaturan lokal dihapus!", false);
      resetCalendarPickerToIdle(
        "Hubungkan Google Calendar terlebih dahulu untuk memilih dari daftar kalender, atau isi ID manual di bawah."
      );
      return true;
    } catch {
      deps.adapter.setStatus("Gagal menghapus data lokal. Coba lagi.", true);
      return false;
    } finally {
      busy = false;
      syncDisabled();
    }
  }

  return {
    load,
    save,
    clearData,
    refreshCalendars,
    onDropdownCalendarSelect,
    onManualCalendarInput,
    onExternalStateChange,
    isLoaded: () => stateLoaded,
    getCurrentState: () => currentState,
  };
}
