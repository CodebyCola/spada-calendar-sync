import type { ScannedAssignment, SpadaCourse } from "../parsers/spada-html.js";

export interface ExtensionSettings {
  calendarId: string;
  syncSubmitted: boolean;
  includePastAssignments: boolean;
  autoSyncOnVisit: boolean;
}

export interface SyncSummary {
  created: number;
  updated: number;
  skipped: number;
}

export interface StoredExtensionState {
  courses: SpadaCourse[];
  assignments: ScannedAssignment[];
  lastScanAt: string | null;
  lastScanError: string | null;
  lastSyncAt: string | null;
  lastSyncSummary: SyncSummary | null;
  lastSyncError: string | null;
  googleConnected: boolean;
  googleAuthVerified: boolean;
  googleSessionGeneration: number;
  settings: ExtensionSettings;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  calendarId: "primary",
  syncSubmitted: true,
  includePastAssignments: false,
  autoSyncOnVisit: true,
};

const STORAGE_KEY = "spadaScannerState";
let storageWriteQueue: Promise<unknown> = Promise.resolve();

export async function getStoredState(): Promise<StoredExtensionState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as Partial<StoredExtensionState> | undefined;
  const googleConnected = raw?.googleConnected ?? false;
  return {
    courses: raw?.courses ?? [],
    assignments: raw?.assignments ?? [],
    lastScanAt: raw?.lastScanAt ?? null,
    lastScanError: raw?.lastScanError ?? null,
    lastSyncAt: googleConnected ? (raw?.lastSyncAt ?? null) : null,
    lastSyncSummary: googleConnected ? (raw?.lastSyncSummary ?? null) : null,
    lastSyncError: raw?.lastSyncError ?? null,
    googleConnected,
    googleAuthVerified: raw?.googleAuthVerified ?? false,
    googleSessionGeneration: raw?.googleSessionGeneration ?? 0,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw?.settings ?? {}),
    },
  };
}

export async function updateStoredState(
  patch: Partial<StoredExtensionState>
): Promise<StoredExtensionState> {
  const runWrite = async (): Promise<StoredExtensionState> => {
    const current = await getStoredState();
    const next: StoredExtensionState = {
      ...current,
      ...patch,
      settings: {
        ...current.settings,
        ...(patch.settings ?? {}),
      },
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  };

  const pending = storageWriteQueue.then(runWrite, runWrite);
  storageWriteQueue = pending.catch(() => {});
  return pending;
}
