import type { ScannedAssignment } from "../parsers/spada-html.js";
import type { StoredExtensionState } from "../shared/storage.js";
import { formatWibDateTime } from "../sync/formatter-and-diff.js";

interface WorkerResponse {
  ok: boolean;
  error?: string;
  state: StoredExtensionState;
  oauthConfigured: boolean;
}

let currentFilter: "pending" | "all" = "pending";
let cachedState: StoredExtensionState | null = null;
let cachedOAuthConfigured = false;

const metaLine = document.getElementById("meta-line") as HTMLParagraphElement;
const alertBox = document.getElementById("alert-box") as HTMLElement;
const btnOptions = document.getElementById("btn-options") as HTMLButtonElement;
const btnScan = document.getElementById("btn-scan") as HTMLButtonElement;
const btnSync = document.getElementById("btn-sync") as HTMLButtonElement;
const tabPending = document.getElementById("tab-pending") as HTMLButtonElement;
const tabAll = document.getElementById("tab-all") as HTMLButtonElement;
const countPending = document.getElementById("count-pending") as HTMLSpanElement;
const countAll = document.getElementById("count-all") as HTMLSpanElement;
const listEl = document.getElementById("assignment-list") as HTMLElement;
const syncStatusEl = document.getElementById("sync-status") as HTMLSpanElement;
const btnConnect = document.getElementById("btn-connect") as HTMLButtonElement;

function showAlert(message: string | null, isError = false): void {
  if (!message) {
    alertBox.className = "alert hidden";
    alertBox.textContent = "";
    return;
  }
  alertBox.className = isError ? "alert error" : "alert";
  alertBox.textContent = message;
}

function createAssignmentCard(item: ScannedAssignment): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";

  const top = document.createElement("div");
  top.className = "card-top";

  const link = document.createElement("a");
  link.className = "card-title";
  link.href = item.assignUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.title;

  const badge = document.createElement("span");
  badge.className = item.submitted ? "badge done" : "badge pending";
  badge.textContent = item.submitted ? "✅ Terkirim" : "⏳ Belum";

  top.append(link, badge);

  const course = document.createElement("div");
  course.className = "card-course";
  course.textContent = item.courseName;

  const due = document.createElement("div");
  due.className = item.submitted ? "card-due done" : "card-due";
  due.textContent = item.dueDateIso
    ? `Deadline: ${formatWibDateTime(new Date(item.dueDateIso))}`
    : "Deadline: Tidak diatur (-)";

  card.append(top, course, due);
  return card;
}

function render(): void {
  if (!cachedState) return;

  const pendingItems = cachedState.assignments.filter((a) => !a.submitted);
  const allItems = cachedState.assignments;

  countPending.textContent = String(pendingItems.length);
  countAll.textContent = String(allItems.length);

  if (cachedState.lastScanAt) {
    metaLine.textContent = `${cachedState.courses.length} mata kuliah • Scan: ${formatWibDateTime(
      new Date(cachedState.lastScanAt)
    )}`;
  } else {
    metaLine.textContent = "Klik 'Scan SPADA' setelah login di SPADA";
  }

  if (cachedState.lastScanError) {
    showAlert(cachedState.lastScanError, true);
  } else if (cachedState.lastSyncError) {
    showAlert(cachedState.lastSyncError, true);
  } else if (!cachedOAuthConfigured) {
    showAlert(
      "Mode Scan SPADA siap dipakai! Untuk mengaktifkan sync ke Google Calendar, isi oauth2.client_id di manifest.json (lihat Pengaturan ⚙️).",
      false
    );
  } else {
    showAlert(null);
  }

  if (!cachedOAuthConfigured) {
    syncStatusEl.textContent = "Google OAuth belum dikonfigurasi";
    btnConnect.textContent = "Panduan Setup";
  } else if (cachedState.googleConnected) {
    const summary = cachedState.lastSyncSummary;
    syncStatusEl.textContent = summary
      ? `Terhubung • +${summary.created} baru, ~${summary.updated} update, ${summary.skipped} skip`
      : "Google Calendar: Terhubung";
    btnConnect.textContent = "Putuskan";
  } else {
    syncStatusEl.textContent = "Google Calendar: Belum terhubung";
    btnConnect.textContent = "Hubungkan Google";
  }

  const visible = currentFilter === "pending" ? pendingItems : allItems;
  listEl.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      allItems.length === 0
        ? "Belum ada data tugas. Pastikan tab SPADA sudah login, lalu klik 'Scan SPADA'."
        : "Semua tugas di mata kuliah aktif sudah dikumpulkan!";
    listEl.append(empty);
    return;
  }

  for (const item of visible) {
    listEl.append(createAssignmentCard(item));
  }
}

async function sendAction(type: string): Promise<void> {
  btnScan.disabled = true;
  btnSync.disabled = true;
  btnConnect.disabled = true;
  try {
    const res = (await chrome.runtime.sendMessage({ type })) as WorkerResponse;
    cachedState = res.state;
    cachedOAuthConfigured = res.oauthConfigured;
    if (!res.ok && res.error) {
      showAlert(res.error, true);
    }
    render();
  } finally {
    btnScan.disabled = false;
    btnSync.disabled = false;
    btnConnect.disabled = false;
  }
}

btnOptions.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

btnScan.addEventListener("click", () => {
  void sendAction("SCAN_NOW");
});

btnSync.addEventListener("click", () => {
  void sendAction("SYNC_NOW");
});

btnConnect.addEventListener("click", () => {
  if (!cachedOAuthConfigured) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  const action = cachedState?.googleConnected ? "DISCONNECT_GOOGLE" : "CONNECT_GOOGLE";
  void sendAction(action);
});

tabPending.addEventListener("click", () => {
  currentFilter = "pending";
  tabPending.classList.add("active");
  tabAll.classList.remove("active");
  render();
});

tabAll.addEventListener("click", () => {
  currentFilter = "all";
  tabAll.classList.add("active");
  tabPending.classList.remove("active");
  render();
});

void sendAction("GET_STATE");
