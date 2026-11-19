import {
  CALENDAR_COLOR_OPTIONS,
  REMINDER_PRESET_OPTIONS,
  type CalendarColorId,
  type ReminderMinutePreset,
  type StatusFilter,
  type TimeFilter,
} from "../shared/settings.js";
import type { StoredExtensionState } from "../shared/storage.js";
import {
  createOptionsController,
  renderCalendarPickerToDom,
  type CalendarPickerDomElements,
  type CalendarPickerViewState,
  type CourseExclusionItem,
} from "./options-controller.js";

const extIdEl = document.getElementById("extension-id") as HTMLElement;
const btnOpenOnboarding = document.getElementById("btn-open-onboarding") as HTMLButtonElement;
const btnCopyId = document.getElementById("btn-copy-id") as HTMLButtonElement;
const copyStatus = document.getElementById("copy-status") as HTMLSpanElement;

const calendarPickerWrap = document.getElementById("calendar-picker-wrap") as HTMLDivElement;
const calendarSelect = document.getElementById("calendar-select") as HTMLSelectElement;
const btnRefreshCalendars = document.getElementById("btn-refresh-calendars") as HTMLButtonElement;
const btnAuthorizeCalendars = document.getElementById(
  "btn-authorize-calendars"
) as HTMLButtonElement;
const calendarPickerStatus = document.getElementById(
  "calendar-picker-status"
) as HTMLParagraphElement;
const calendarDestinationNotice = document.getElementById(
  "calendar-destination-notice"
) as HTMLParagraphElement;

const calendarIdInput = document.getElementById("calendar-id") as HTMLInputElement;
const timeFilterSelect = document.getElementById("time-filter") as HTMLSelectElement;
const statusFilterSelect = document.getElementById("status-filter") as HTMLSelectElement;
const excludedCoursesFieldset = document.getElementById(
  "excluded-courses-fieldset"
) as HTMLFieldSetElement;
const excludedCoursesList = document.getElementById("excluded-courses-list") as HTMLDivElement;

const remindersFieldset = document.getElementById("reminders-fieldset") as HTMLFieldSetElement;
const reminderPresetsList = document.getElementById("reminder-presets-list") as HTMLDivElement;
const reminderNoneInput = document.getElementById("reminder-none") as HTMLInputElement;
const pendingColorSelect = document.getElementById("pending-color-id") as HTMLSelectElement;
const pendingColorSwatch = document.getElementById("pending-color-swatch") as HTMLSpanElement;
const submittedColorSelect = document.getElementById("submitted-color-id") as HTMLSelectElement;
const submittedColorSwatch = document.getElementById("submitted-color-swatch") as HTMLSpanElement;

const autoVisitInput = document.getElementById("auto-visit") as HTMLInputElement;

const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnReload = document.getElementById("btn-reload") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const saveStatus = document.getElementById("save-status") as HTMLSpanElement;

let statusTimer: ReturnType<typeof setTimeout> | null = null;
let formDisabledState = true;
let calendarLoadingState = false;

function initStaticControls(): void {
  reminderPresetsList.replaceChildren();
  for (const preset of REMINDER_PRESET_OPTIONS) {
    const label = document.createElement("label");
    label.className = "checkbox";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.reminderMinutes = String(preset.minutes);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        reminderNoneInput.checked = false;
      } else if (readReminderMinutes().length === 0) {
        reminderNoneInput.checked = true;
      }
    });

    const text = document.createElement("span");
    text.textContent = preset.label;
    label.append(checkbox, text);
    reminderPresetsList.append(label);
  }

  reminderNoneInput.addEventListener("change", () => {
    if (reminderNoneInput.checked) {
      const boxes = reminderPresetsList.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-reminder-minutes]'
      );
      for (const box of boxes) {
        box.checked = false;
      }
    }
  });

  const populateColorSelect = (select: HTMLSelectElement, swatch: HTMLSpanElement): void => {
    select.replaceChildren();
    for (const opt of CALENDAR_COLOR_OPTIONS) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      select.append(el);
    }
    select.addEventListener("change", () => {
      updateColorSwatch(select.value as CalendarColorId, swatch);
    });
  };

  populateColorSelect(pendingColorSelect, pendingColorSwatch);
  populateColorSelect(submittedColorSelect, submittedColorSwatch);
}

function updateColorSwatch(colorId: CalendarColorId, swatch: HTMLSpanElement): void {
  const match = CALENDAR_COLOR_OPTIONS.find((opt) => opt.id === colorId);
  if (!match || match.id === "default") {
    swatch.style.background = "";
    swatch.classList.add("swatch-default");
    swatch.title = "Default kalender";
  } else {
    swatch.style.background = match.hex;
    swatch.classList.remove("swatch-default");
    swatch.title = match.label;
  }
}

function renderReminderMinutes(minutes: ReminderMinutePreset[]): void {
  const selected = new Set<number>(minutes);
  const boxes = reminderPresetsList.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-reminder-minutes]'
  );
  for (const box of boxes) {
    box.checked = selected.has(Number(box.dataset.reminderMinutes));
  }
  reminderNoneInput.checked = minutes.length === 0;
}

function readReminderMinutes(): ReminderMinutePreset[] {
  if (reminderNoneInput.checked) {
    return [];
  }
  const selected: ReminderMinutePreset[] = [];
  const boxes = reminderPresetsList.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-reminder-minutes]'
  );
  for (const box of boxes) {
    if (box.checked && box.dataset.reminderMinutes) {
      selected.push(Number(box.dataset.reminderMinutes) as ReminderMinutePreset);
    }
  }
  return selected.sort((a, b) => b - a);
}

function renderExcludedCourses(items: CourseExclusionItem[]): void {
  excludedCoursesList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Belum ada mata kuliah dari hasil scan.";
    excludedCoursesList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const label = document.createElement("label");
    label.className = "checkbox course-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.courseId = item.courseId;
    checkbox.checked = item.excluded;

    const text = document.createElement("span");
    text.textContent = item.missingFromLatestScan
      ? `ID ${item.label} (tidak muncul pada scan terbaru)`
      : item.label;

    label.append(checkbox, text);
    excludedCoursesList.appendChild(label);
  }
}

function readExcludedCourseIds(): string[] {
  const checked: string[] = [];
  const inputs = excludedCoursesList.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-course-id]'
  );
  for (const input of inputs) {
    if (input.checked && input.dataset.courseId) {
      checked.push(input.dataset.courseId);
    }
  }
  return checked;
}

function bindHiddenElement(el: HTMLElement): { hidden: boolean } {
  return {
    get hidden() {
      return Boolean(el.hidden);
    },
    set hidden(value: boolean) {
      el.hidden = value;
    },
  };
}

function bindButtonElement(el: HTMLButtonElement): { hidden: boolean; disabled: boolean } {
  return {
    get hidden() {
      return Boolean(el.hidden);
    },
    set hidden(value: boolean) {
      el.hidden = value;
    },
    get disabled() {
      return el.disabled;
    },
    set disabled(value: boolean) {
      el.disabled = value;
    },
  };
}

const calendarPickerDomElements: CalendarPickerDomElements<HTMLOptionElement> = {
  calendarPickerWrap: bindHiddenElement(calendarPickerWrap),
  calendarSelect,
  createOption: (value, label) => {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = label;
    return el;
  },
  btnRefreshCalendars: bindButtonElement(btnRefreshCalendars),
  btnAuthorizeCalendars: bindButtonElement(btnAuthorizeCalendars),
  calendarPickerStatus: {
    get textContent() {
      return calendarPickerStatus.textContent;
    },
    set textContent(value: string | null) {
      calendarPickerStatus.textContent = value ?? "";
    },
    toggleErrorClass: (isError: boolean) => {
      calendarPickerStatus.classList.toggle("status-error", isError);
    },
  },
  calendarDestinationNotice: bindHiddenElement(calendarDestinationNotice),
};

function renderCalendarPickerUi(picker: CalendarPickerViewState): void {
  calendarLoadingState = picker.status === "loading";
  renderCalendarPickerToDom(calendarPickerDomElements, picker, formDisabledState);
}

initStaticControls();

const controller = createOptionsController({
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  adapter: {
    setFormDisabled(disabled) {
      formDisabledState = disabled;
      calendarIdInput.disabled = disabled;
      calendarSelect.disabled = disabled || Boolean(calendarPickerWrap.hidden);
      btnRefreshCalendars.disabled = disabled || calendarLoadingState;
      btnAuthorizeCalendars.disabled = disabled || calendarLoadingState;
      timeFilterSelect.disabled = disabled;
      statusFilterSelect.disabled = disabled;
      excludedCoursesFieldset.disabled = disabled;
      remindersFieldset.disabled = disabled;
      pendingColorSelect.disabled = disabled;
      submittedColorSelect.disabled = disabled;
      autoVisitInput.disabled = disabled;
      btnSave.disabled = disabled;
      btnClear.disabled = disabled;
    },
    setReloadVisible(visible) {
      btnReload.hidden = !visible;
    },
    setStatus(message, isError = false) {
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
      saveStatus.textContent = message;
      saveStatus.classList.toggle("status-error", isError);
      if (message && !isError && message !== "Memuat pengaturan...") {
        statusTimer = setTimeout(() => {
          saveStatus.textContent = "";
        }, 2500);
      }
    },
    renderState(state: StoredExtensionState, courseItems: CourseExclusionItem[]) {
      calendarIdInput.value = state.settings.calendarId;
      timeFilterSelect.value = state.settings.timeFilter;
      statusFilterSelect.value = state.settings.statusFilter;
      autoVisitInput.checked = state.settings.autoSyncOnVisit;
      renderExcludedCourses(courseItems);
      renderReminderMinutes(state.settings.reminderMinutes);
      pendingColorSelect.value = state.settings.pendingColorId;
      submittedColorSelect.value = state.settings.submittedColorId;
      updateColorSwatch(state.settings.pendingColorId, pendingColorSwatch);
      updateColorSwatch(state.settings.submittedColorId, submittedColorSwatch);
    },
    setCalendarDraft(calendarId: string) {
      calendarIdInput.value = calendarId;
    },
    renderCalendarPicker(picker: CalendarPickerViewState) {
      renderCalendarPickerUi(picker);
    },
    readDraft() {
      return {
        calendarId: calendarIdInput.value.trim() || "primary",
        timeFilter: timeFilterSelect.value as TimeFilter,
        statusFilter: statusFilterSelect.value as StatusFilter,
        excludedCourseIds: readExcludedCourseIds(),
        reminderMinutes: readReminderMinutes(),
        pendingColorId: pendingColorSelect.value as CalendarColorId,
        submittedColorId: submittedColorSelect.value as CalendarColorId,
        autoSyncOnVisit: autoVisitInput.checked,
      };
    },
  },
});

btnOpenOnboarding.addEventListener("click", () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("onboarding/onboarding.html"),
  });
});

btnCopyId.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(chrome.runtime.id);
    copyStatus.textContent = "Extension ID tersalin!";
  } catch {
    copyStatus.textContent =
      "Gagal menyalin otomatis — silakan blok & salin manual dari kotak ID.";
  }
  setTimeout(() => {
    copyStatus.textContent = "";
  }, 2500);
});

calendarSelect.addEventListener("change", () => {
  controller.onDropdownCalendarSelect(calendarSelect.value);
});

calendarIdInput.addEventListener("input", () => {
  controller.onManualCalendarInput(calendarIdInput.value);
});

btnRefreshCalendars.addEventListener("click", () => {
  void controller.refreshCalendars(false);
});

btnAuthorizeCalendars.addEventListener("click", () => {
  void controller.refreshCalendars(true);
});

btnSave.addEventListener("click", () => {
  void controller.save();
});

btnReload.addEventListener("click", () => {
  void controller.load();
});

btnClear.addEventListener("click", () => {
  void controller.clearData();
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.spadaScannerState?.newValue) {
      return;
    }
    const nextState = changes.spadaScannerState.newValue as StoredExtensionState;
    controller.onExternalStateChange(nextState);
  });
}

extIdEl.textContent = chrome.runtime.id;
void controller.load();
