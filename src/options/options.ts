import { getStoredState, updateStoredState } from "../shared/storage.js";

const extIdEl = document.getElementById("extension-id") as HTMLElement;
const btnOpenOnboarding = document.getElementById("btn-open-onboarding") as HTMLButtonElement;
const btnCopyId = document.getElementById("btn-copy-id") as HTMLButtonElement;
const copyStatus = document.getElementById("copy-status") as HTMLSpanElement;
const calendarIdInput = document.getElementById("calendar-id") as HTMLInputElement;
const syncSubmittedInput = document.getElementById("sync-submitted") as HTMLInputElement;
const includePastInput = document.getElementById("include-past") as HTMLInputElement;
const autoVisitInput = document.getElementById("auto-visit") as HTMLInputElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const saveStatus = document.getElementById("save-status") as HTMLSpanElement;

async function init(): Promise<void> {
  extIdEl.textContent = chrome.runtime.id;
  const state = await getStoredState();
  calendarIdInput.value = state.settings.calendarId;
  syncSubmittedInput.checked = state.settings.syncSubmitted;
  includePastInput.checked = state.settings.includePastAssignments;
  autoVisitInput.checked = state.settings.autoSyncOnVisit;
}

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
    copyStatus.textContent = "Gagal menyalin otomatis — silakan blok & salin manual dari kotak ID.";
  }
  setTimeout(() => {
    copyStatus.textContent = "";
  }, 2500);
});

btnSave.addEventListener("click", async () => {
  await updateStoredState({
    settings: {
      calendarId: calendarIdInput.value.trim() || "primary",
      syncSubmitted: syncSubmittedInput.checked,
      includePastAssignments: includePastInput.checked,
      autoSyncOnVisit: autoVisitInput.checked,
    },
  });
  saveStatus.textContent = "Tersimpan!";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 2000);
});

btnClear.addEventListener("click", async () => {
  await chrome.storage.local.clear();
  await chrome.action.setBadgeText({ text: "" });
  await init();
  saveStatus.textContent = "Semua data scan & pengaturan lokal dihapus!";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 2500);
});

void init();
