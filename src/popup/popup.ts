import { diagnoseSetupError, evaluateSetupStatus } from "../setup/setup-diagnostics.js";
import type { StoredExtensionState } from "../shared/storage.js";
import { formatWibDateTime } from "../sync/formatter-and-diff.js";
import {
  buildPopupViewModel,
  DEFAULT_POPUP_VIEW_FILTERS,
  type PopupAssignmentCardModel,
  type PopupStatusViewFilter,
  type PopupTimeViewFilter,
  type PopupViewFilters,
} from "./assignment-view.js";

interface WorkerResponse {
  ok: boolean;
  error?: string;
  state: StoredExtensionState;
  oauthConfigured: boolean;
}

let viewFilters: PopupViewFilters = { ...DEFAULT_POPUP_VIEW_FILTERS };
let cachedState: StoredExtensionState | null = null;
let cachedOAuthConfigured = false;

const metaLine = document.getElementById("meta-line") as HTMLParagraphElement;
const setupBanner = document.getElementById("setup-banner") as HTMLElement;
const setupBannerText = document.getElementById("setup-banner-text") as HTMLSpanElement;
const btnSetupGuide = document.getElementById("btn-setup-guide") as HTMLButtonElement;
const alertBox = document.getElementById("alert-box") as HTMLElement;
const btnOptions = document.getElementById("btn-options") as HTMLButtonElement;
const btnScan = document.getElementById("btn-scan") as HTMLButtonElement;
const btnSync = document.getElementById("btn-sync") as HTMLButtonElement;
const syncPreviewHint = document.getElementById("sync-preview-hint") as HTMLParagraphElement;
const filterCourseSelect = document.getElementById("filter-course") as HTMLSelectElement;
const filterTimeSelect = document.getElementById("filter-time") as HTMLSelectElement;
const tabPending = document.getElementById("tab-pending") as HTMLButtonElement;
const tabSubmitted = document.getElementById("tab-submitted") as HTMLButtonElement;
const tabAll = document.getElementById("tab-all") as HTMLButtonElement;
const countPending = document.getElementById("count-pending") as HTMLSpanElement;
const countSubmitted = document.getElementById("count-submitted") as HTMLSpanElement;
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

function setActiveStatusTab(status: PopupStatusViewFilter): void {
  const map: Array<[HTMLButtonElement, PopupStatusViewFilter]> = [
    [tabPending, "pending"],
    [tabSubmitted, "submitted"],
    [tabAll, "all"],
  ];
  for (const [btn, value] of map) {
    const active = value === status;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  }
}

function createAssignmentCard(cardModel: PopupAssignmentCardModel): HTMLElement {
  const { assignment: item, evaluation, syncReasonText, deadline } = cardModel;

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

  const dueRow = document.createElement("div");
  dueRow.className = "card-due-row";

  const urgencyBadge = document.createElement("span");
  urgencyBadge.className = `urgency-pill urgency-${deadline.urgency}`;
  urgencyBadge.textContent = deadline.relativeLabel;
  dueRow.append(urgencyBadge);

  if (deadline.valid) {
    const absDue = document.createElement("span");
    absDue.className = item.submitted ? "card-due done" : "card-due";
    absDue.textContent = deadline.absoluteLabel;
    dueRow.append(absDue);
  }

  const syncNote = document.createElement("div");
  syncNote.className = `card-sync-note sync-${evaluation.mode}`;
  syncNote.textContent = syncReasonText;

  card.append(top, course, dueRow, syncNote);
  return card;
}

function syncCourseSelectOptions(
  options: Array<{ value: string; label: string }>,
  selectedValue: string
): void {
  filterCourseSelect.replaceChildren();
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    filterCourseSelect.append(el);
  }
  filterCourseSelect.value = selectedValue;
}

function render(): void {
  if (!cachedState) return;

  const nowMs = Date.now();
  const vm = buildPopupViewModel({
    assignments: cachedState.assignments,
    courses: cachedState.courses,
    settings: cachedState.settings,
    viewFilters,
    lastScanAt: cachedState.lastScanAt,
    nowMs,
  });

  viewFilters.courseId = vm.effectiveCourseId;
  syncCourseSelectOptions(vm.courseOptions, vm.effectiveCourseId);
  filterTimeSelect.value = viewFilters.time;
  setActiveStatusTab(viewFilters.status);

  countPending.textContent = String(vm.pendingTotalCount);
  countSubmitted.textContent = String(vm.submittedTotalCount);
  countAll.textContent = String(vm.allTotalCount);

  btnSync.textContent = vm.syncButtonLabel;
  syncPreviewHint.textContent = vm.syncPreviewHint;

  if (cachedState.lastScanAt && Number.isFinite(Date.parse(cachedState.lastScanAt))) {
    metaLine.textContent = `${cachedState.courses.length} mata kuliah • Scan: ${formatWibDateTime(
      new Date(cachedState.lastScanAt)
    )}`;
  } else {
    metaLine.textContent = "Klik 'Scan SPADA' setelah login di SPADA";
  }

  const setupStatus = evaluateSetupStatus(cachedState, cachedOAuthConfigured);
  const isGoogleConnected = cachedState.googleConnected && cachedState.googleAuthVerified;

  if (!setupStatus.hasCompletedInitialSetup) {
    setupBanner.classList.remove("hidden");
    setupBannerText.textContent = `Setup awal: ${setupStatus.completedCount}/3 langkah selesai`;
  } else {
    setupBanner.classList.add("hidden");
  }

  if (cachedState.lastScanError) {
    const diag = diagnoseSetupError(cachedState.lastScanError);
    showAlert(`${diag.title} — ${diag.hint}`, true);
  } else if (cachedState.lastSyncError) {
    const diag = diagnoseSetupError(cachedState.lastSyncError);
    showAlert(`${diag.title} — ${diag.hint}`, true);
  } else if (!cachedOAuthConfigured) {
    showAlert(
      "Mode Scan SPADA siap dipakai! Untuk mengaktifkan sync ke Google Calendar, konfigurasikan OAuth Google terlebih dahulu (lihat Panduan Setup).",
      false
    );
  } else {
    showAlert(null);
  }

  if (!cachedOAuthConfigured) {
    syncStatusEl.textContent = "Google OAuth belum dikonfigurasi";
    btnConnect.textContent = "Panduan Setup";
  } else if (isGoogleConnected) {
    const summary = cachedState.lastSyncSummary;
    syncStatusEl.textContent = summary
      ? `Terhubung • +${summary.created} baru, ~${summary.updated} update, ${summary.skipped} skip`
      : "Google Calendar: Terhubung";
    btnConnect.textContent = "Putuskan";
  } else {
    syncStatusEl.textContent = "Google Calendar: Belum terhubung";
    btnConnect.textContent = "Hubungkan Google";
  }

  listEl.replaceChildren();

  if (vm.visibleCards.length === 0) {
    const wrap = document.createElement("div");
    wrap.className = "empty";

    const msg = document.createElement("p");
    msg.textContent = vm.emptyStateMessage ?? "Tidak ada tugas.";
    wrap.append(msg);

    if (vm.canResetFilters) {
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn-secondary reset-filter-btn";
      resetBtn.textContent = "Tampilkan semua tugas";
      resetBtn.addEventListener("click", () => {
        viewFilters = { courseId: "all", status: "all", time: "all" };
        render();
      });
      wrap.append(resetBtn);
    }

    listEl.append(wrap);
    return;
  }

  for (const cardModel of vm.visibleCards) {
    listEl.append(createAssignmentCard(cardModel));
  }
}

async function sendAction(type: string): Promise<void> {
  btnScan.disabled = true;
  btnSync.disabled = true;
  btnConnect.disabled = true;
  try {
    const res = (await chrome.runtime.sendMessage({ type })) as WorkerResponse | undefined;
    if (!res || !res.state) {
      showAlert(
        "Koneksi ke background ekstensi terputus — tutup lalu buka kembali popup dan coba lagi.",
        true
      );
      return;
    }
    cachedState = res.state;
    cachedOAuthConfigured = res.oauthConfigured;
    render();
    if (!res.ok && res.error) {
      const diag = diagnoseSetupError(res.error);
      showAlert(`${diag.title} — ${diag.hint}`, true);
    }
  } catch (err) {
    const diag = diagnoseSetupError(err instanceof Error ? err.message : String(err));
    showAlert(`${diag.title} — ${diag.hint}`, true);
  } finally {
    btnScan.disabled = false;
    btnSync.disabled = false;
    btnConnect.disabled = false;
  }
}

function openOnboardingPage(): void {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("onboarding/onboarding.html"),
  });
}

btnOptions.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

btnSetupGuide.addEventListener("click", () => {
  openOnboardingPage();
});

btnScan.addEventListener("click", () => {
  void sendAction("SCAN_NOW");
});

btnSync.addEventListener("click", () => {
  void sendAction("SYNC_NOW");
});

btnConnect.addEventListener("click", () => {
  if (!cachedOAuthConfigured) {
    openOnboardingPage();
    return;
  }
  const isGoogleConnected = Boolean(
    cachedState?.googleConnected && cachedState?.googleAuthVerified
  );
  const action = isGoogleConnected ? "DISCONNECT_GOOGLE" : "CONNECT_GOOGLE";
  void sendAction(action);
});

filterCourseSelect.addEventListener("change", () => {
  viewFilters.courseId = filterCourseSelect.value;
  render();
});

filterTimeSelect.addEventListener("change", () => {
  viewFilters.time = filterTimeSelect.value as PopupTimeViewFilter;
  render();
});

tabPending.addEventListener("click", () => {
  viewFilters.status = "pending";
  render();
});

tabSubmitted.addEventListener("click", () => {
  viewFilters.status = "submitted";
  render();
});

tabAll.addEventListener("click", () => {
  viewFilters.status = "all";
  render();
});

// Keep relative countdown labels fresh while popup remains open
setInterval(() => {
  if (cachedState) {
    render();
  }
}, 60_000);

window.addEventListener("focus", () => {
  if (cachedState) {
    render();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cachedState) {
    render();
  }
});

void sendAction("GET_STATE");
