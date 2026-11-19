import type { ScannedAssignment, SpadaCourse } from "../parsers/spada-html.js";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type CalendarColorId,
  type ExtensionSettings,
  type ReminderMinutePreset,
  type StatusFilter,
  type TimeFilter,
} from "./settings.js";

export { DEFAULT_SETTINGS, normalizeSettings };
export type { CalendarColorId, ExtensionSettings, ReminderMinutePreset, StatusFilter, TimeFilter };

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
    settings: normalizeSettings(raw?.settings),
  };
}

export interface StateMutationDecision<T> {
  patch?: Partial<StoredExtensionState> | null;
  result: T;
}

export async function mutateStoredState<T>(
  mutator: (current: StoredExtensionState) => StateMutationDecision<T>
): Promise<{ state: StoredExtensionState; result: T }> {
  const runMutation = async (): Promise<{ state: StoredExtensionState; result: T }> => {
    const current = await getStoredState();
    const { patch, result } = mutator(current);
    if (!patch) {
      return { state: current, result };
    }
    const next: StoredExtensionState = {
      ...current,
      ...patch,
      settings: normalizeSettings(
        patch.settings ? { ...current.settings, ...patch.settings } : current.settings
      ),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return { state: next, result };
  };

  const pending = storageWriteQueue.then(runMutation, runMutation);
  storageWriteQueue = pending.catch(() => {});
  return pending;
}

export async function updateStoredState(
  patch: Partial<StoredExtensionState>
): Promise<StoredExtensionState> {
  const { state } = await mutateStoredState(() => ({ patch, result: undefined }));
  return state;
}
