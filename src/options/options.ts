import type { StoredExtensionState } from "../shared/storage.js";

interface WorkerResponse {
  ok: boolean;
  error?: string;
  state: StoredExtensionState;
}

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

function renderSettings(state: StoredExtensionState): void {
  calendarIdInput.value = state.settings.calendarId;
  syncSubmittedInput.checked = state.settings.syncSubmitted;
  includePastInput.checked = state.settings.includePastAssignments;
  autoVisitInput.checked = state.settings.autoSyncOnVisit;
}

async function init(): Promise<void> {
  extIdEl.textContent = chrome.runtime.id;
  try {
    const res = (await chrome.runtime.sendMessage({ type: "GET_STATE" })) as
      | WorkerResponse
      | undefined;
    if (res?.state) {
      renderSettings(res.state);
    }
  } catch {
    saveStatus.textContent = "Gagal memuat pengaturan. Muat ulang halaman ini.";
  }
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
  btnSave.disabled = true;
  btnClear.disabled = true;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        calendarId: calendarIdInput.value.trim() || "primary",
        syncSubmitted: syncSubmittedInput.checked,
        includePastAssignments: includePastInput.checked,
        autoSyncOnVisit: autoVisitInput.checked,
      },
    })) as WorkerResponse | undefined;

    if (!res?.ok || !res.state) {
      saveStatus.textContent = res?.error || "Gagal menyimpan pengaturan.";
      return;
    }
    renderSettings(res.state);
    saveStatus.textContent = "Tersimpan!";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2000);
  } catch {
    saveStatus.textContent = "Gagal menyimpan pengaturan. Coba lagi.";
  } finally {
    btnSave.disabled = false;
    btnClear.disabled = false;
  }
});

btnClear.addEventListener("click", async () => {
  btnSave.disabled = true;
  btnClear.disabled = true;
  try {
    const res = (await chrome.runtime.sendMessage({ type: "CLEAR_DATA" })) as
      | WorkerResponse
      | undefined;
    if (!res?.ok || !res.state) {
      saveStatus.textContent = res?.error || "Gagal menghapus data lokal.";
      return;
    }
    renderSettings(res.state);
    saveStatus.textContent = "Semua data scan & pengaturan lokal dihapus!";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2500);
  } catch {
    saveStatus.textContent = "Gagal menghapus data lokal. Coba lagi.";
  } finally {
    btnSave.disabled = false;
    btnClear.disabled = false;
  }
});

void init();
