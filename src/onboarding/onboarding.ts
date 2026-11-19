import {
  diagnoseSetupError,
  evaluateSetupStatus,
  type StepState,
} from "../setup/setup-diagnostics.js";
import type { StoredExtensionState } from "../shared/storage.js";

interface WorkerResponse {
  ok: boolean;
  error?: string;
  state: StoredExtensionState;
  oauthConfigured: boolean;
}

const BUILD_TARGET: "store" | "unpacked" =
  typeof __BUILD_TARGET__ !== "undefined" ? __BUILD_TARGET__ : "store";

const progressPill = document.getElementById("progress-pill") as HTMLSpanElement;
const readyBanner = document.getElementById("ready-banner") as HTMLDivElement;
const globalError = document.getElementById("global-error") as HTMLDivElement;

const stepSpada = document.getElementById("step-spada") as HTMLLIElement;
const stepGoogle = document.getElementById("step-google") as HTMLLIElement;
const stepSync = document.getElementById("step-sync") as HTMLLIElement;

const badgeSpada = document.getElementById("badge-spada") as HTMLSpanElement;
const badgeGoogle = document.getElementById("badge-google") as HTMLSpanElement;
const badgeSync = document.getElementById("badge-sync") as HTMLSpanElement;

const detailSpada = document.getElementById("detail-spada") as HTMLParagraphElement;
const detailGoogle = document.getElementById("detail-google") as HTMLParagraphElement;
const detailSync = document.getElementById("detail-sync") as HTMLParagraphElement;

const btnCheckSpada = document.getElementById("btn-check-spada") as HTMLButtonElement;
const btnConnectGoogle = document.getElementById("btn-connect-google") as HTMLButtonElement;
const btnFirstSync = document.getElementById("btn-first-sync") as HTMLButtonElement;
const btnOpenOptions = document.getElementById("btn-open-options") as HTMLButtonElement;

let isBusy = false;
let cachedState: StoredExtensionState | null = null;
let cachedOAuthConfigured = false;

const STATE_LABELS: Record<StepState, string> = {
  done: "Selesai",
  active: "Langkah Berikutnya",
  pending: "Menunggu",
  error: "Perlu Perhatian",
  blocked: "Belum Dikonfigurasi",
};

function applyBuildTargetCopy(): void {
  const unpackedOnlyElements = document.querySelectorAll<HTMLElement>("[data-unpacked-only]");
  const hideUnpacked = BUILD_TARGET !== "unpacked";
  for (const el of unpackedOnlyElements) {
    el.hidden = hideUnpacked;
  }
}

function showGlobalError(rawError: string | null): void {
  if (!rawError) {
    globalError.hidden = true;
    globalError.textContent = "";
    return;
  }
  const diagnosis = diagnoseSetupError(rawError);
  globalError.hidden = false;
  globalError.textContent = `${diagnosis.title} — ${diagnosis.hint}`;
}

function applyStepCard(
  card: HTMLLIElement,
  badge: HTMLSpanElement,
  detailEl: HTMLParagraphElement,
  state: StepState,
  detailText: string
): void {
  card.dataset.state = state;
  badge.textContent = STATE_LABELS[state];
  detailEl.textContent = detailText;
}

function render(state: StoredExtensionState, oauthConfigured: boolean): void {
  const status = evaluateSetupStatus(state, oauthConfigured);

  progressPill.textContent = `${status.completedCount}/3 selesai`;
  readyBanner.hidden = !status.overallReady;

  applyStepCard(
    stepSpada,
    badgeSpada,
    detailSpada,
    status.steps.spada.state,
    status.steps.spada.detail
  );
  applyStepCard(
    stepGoogle,
    badgeGoogle,
    detailGoogle,
    status.steps.google.state,
    status.steps.google.detail
  );
  applyStepCard(
    stepSync,
    badgeSync,
    detailSync,
    status.steps.firstSync.state,
    status.steps.firstSync.detail
  );

  btnCheckSpada.disabled = isBusy;
  btnConnectGoogle.disabled = isBusy || !oauthConfigured;
  btnConnectGoogle.textContent =
    status.steps.google.state === "done" ? "Google Terhubung ✓" : "Hubungkan Google";

  const canRunFirstSync =
    status.steps.spada.state === "done" && status.steps.google.state === "done";
  btnFirstSync.disabled = isBusy || !canRunFirstSync;
}

async function sendAction(type: "GET_STATE" | "SCAN_NOW" | "CONNECT_GOOGLE" | "SYNC_NOW"): Promise<void> {
  isBusy = true;
  btnCheckSpada.disabled = true;
  btnConnectGoogle.disabled = true;
  btnFirstSync.disabled = true;
  showGlobalError(null);

  let pendingError: string | null = null;

  try {
    const res = (await chrome.runtime.sendMessage({ type })) as WorkerResponse | undefined;
    if (!res || !res.state) {
      pendingError = "Koneksi ke background ekstensi terputus. Coba klik tombol lagi.";
    } else {
      cachedState = res.state;
      cachedOAuthConfigured = res.oauthConfigured;
      if (!res.ok && res.error) {
        pendingError = res.error;
      }
    }
  } catch (err) {
    pendingError = err instanceof Error ? err.message : String(err);
  } finally {
    isBusy = false;
    if (cachedState) {
      render(cachedState, cachedOAuthConfigured);
    } else {
      btnCheckSpada.disabled = false;
    }
    if (pendingError) {
      showGlobalError(pendingError);
    }
  }
}

btnCheckSpada.addEventListener("click", () => {
  void sendAction("SCAN_NOW");
});

btnConnectGoogle.addEventListener("click", () => {
  void sendAction("CONNECT_GOOGLE");
});

btnFirstSync.addEventListener("click", () => {
  void sendAction("SYNC_NOW");
});

btnOpenOptions.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

applyBuildTargetCopy();
void sendAction("GET_STATE");
