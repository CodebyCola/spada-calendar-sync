import type { StoredExtensionState, SyncSummary } from "../shared/storage.js";

export type DisconnectedStatePatch = Pick<
  StoredExtensionState,
  | "googleConnected"
  | "googleAuthVerified"
  | "googleSessionGeneration"
  | "lastSyncAt"
  | "lastSyncSummary"
  | "lastSyncError"
>;

export function buildDisconnectedStatePatch(currentGeneration = 0): DisconnectedStatePatch {
  return {
    googleConnected: false,
    googleAuthVerified: false,
    googleSessionGeneration: currentGeneration + 1,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastSyncError: null,
  };
}

export function buildConnectedStatePatch(
  currentState: StoredExtensionState
): Partial<StoredExtensionState> {
  const wasVerifiedConnected = currentState.googleConnected && currentState.googleAuthVerified;
  return {
    googleConnected: true,
    googleAuthVerified: true,
    lastSyncError: null,
    ...(wasVerifiedConnected ? {} : { lastSyncAt: null, lastSyncSummary: null }),
  };
}

export interface RevalidateLegacyAuthDeps {
  oauthConfigured: boolean;
  getSilentToken: () => Promise<string | null>;
  getState?: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
}

const TRANSIENT_NETWORK_ERROR_PATTERN =
  /failed to fetch|network|offline|timeout|timed out|internet|err_connection|err_name_not_resolved|err_network|service unavailable|connection failed/i;

const AUTH_INVALIDATED_ERROR_PATTERN =
  /oauth2 not granted|oauth2.*revoked|not granted|revoked|not signed in|no token|did not approve|canceled|cancelled|access_denied|org_internal|interaction required|browser sign-?in|invalid_client|bad client id/i;

/**
 * Revalidates legacy stored states where `googleConnected` was set true before
 * `googleAuthVerified` existed (such as the old unauthenticated 0-assignment sync path).
 */
export async function revalidateLegacyGoogleAuth(
  state: StoredExtensionState,
  deps: RevalidateLegacyAuthDeps
): Promise<StoredExtensionState> {
  if (!state.googleConnected || state.googleAuthVerified || !deps.oauthConfigured) {
    return state;
  }

  const startGeneration = state.googleSessionGeneration;
  const isStillCurrentGeneration = async (): Promise<StoredExtensionState | null> => {
    if (!deps.getState) {
      return state;
    }
    const latest = await deps.getState();
    return latest.googleSessionGeneration === startGeneration ? latest : null;
  };

  try {
    const token = await deps.getSilentToken();
    const current = await isStillCurrentGeneration();
    if (!current) {
      return (await deps.getState?.()) ?? state;
    }
    if (token && token.trim().length > 0) {
      return await deps.updateState({ googleAuthVerified: true });
    }
    return await deps.updateState(buildDisconnectedStatePatch(current.googleSessionGeneration));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (TRANSIENT_NETWORK_ERROR_PATTERN.test(message)) {
      return state;
    }
    if (AUTH_INVALIDATED_ERROR_PATTERN.test(message)) {
      const current = await isStillCurrentGeneration();
      if (!current) {
        return (await deps.getState?.()) ?? state;
      }
      return await deps.updateState(buildDisconnectedStatePatch(current.googleSessionGeneration));
    }
    return state;
  }
}

export interface SessionGuardedSyncDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  runSync: (state: StoredExtensionState) => Promise<SyncSummary>;
  expectedGeneration?: number;
  nowIso?: () => string;
}

/**
 * Runs a calendar sync guarded by `googleSessionGeneration` so an in-flight sync
 * cannot overwrite or resurrect a session that was disconnected before completion.
 */
export async function runSessionGuardedSync(
  deps: SessionGuardedSyncDeps
): Promise<{ stale: boolean; summary: SyncSummary | null }> {
  const initialState = await deps.getState();
  if (
    deps.expectedGeneration !== undefined &&
    initialState.googleSessionGeneration !== deps.expectedGeneration
  ) {
    return { stale: true, summary: null };
  }
  const startGeneration = initialState.googleSessionGeneration;

  try {
    const summary = await deps.runSync(initialState);
    const latest = await deps.getState();
    if (latest.googleSessionGeneration !== startGeneration) {
      return { stale: true, summary: null };
    }
    await deps.updateState({
      googleConnected: true,
      googleAuthVerified: true,
      lastSyncAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
      lastSyncSummary: summary,
      lastSyncError: null,
    });
    return { stale: false, summary };
  } catch (err) {
    const latest = await deps.getState();
    if (latest.googleSessionGeneration !== startGeneration) {
      return { stale: true, summary: null };
    }
    const message = err instanceof Error ? err.message : String(err);
    await deps.updateState({ lastSyncError: message });
    throw err;
  }
}

export interface SessionGuardedConnectDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  requestToken: () => Promise<string>;
}

/**
 * Runs Google account connection guarded by `googleSessionGeneration`, clearing any stale
 * legacy `lastSyncAt`/`lastSyncSummary` when transitioning from a disconnected state.
 */
export async function runSessionGuardedConnect(
  deps: SessionGuardedConnectDeps
): Promise<{ stale: boolean; state: StoredExtensionState }> {
  const initialState = await deps.getState();
  const startGeneration = initialState.googleSessionGeneration;

  try {
    await deps.requestToken();
    const latest = await deps.getState();
    if (latest.googleSessionGeneration !== startGeneration) {
      return { stale: true, state: latest };
    }
    const updated = await deps.updateState(buildConnectedStatePatch(latest));
    return { stale: false, state: updated };
  } catch (err) {
    const latest = await deps.getState();
    if (latest.googleSessionGeneration === startGeneration) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.updateState({ lastSyncError: message });
    }
    throw err;
  }
}

export interface DisconnectGoogleDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  revokeCachedToken: () => Promise<void>;
}

/**
 * Immediately increments `googleSessionGeneration` and clears connected/sync state BEFORE
 * performing best-effort token revocation so concurrent in-flight syncs cannot resurrect auth.
 */
export async function runDisconnectGoogle(
  deps: DisconnectGoogleDeps
): Promise<StoredExtensionState> {
  const current = await deps.getState();
  const disconnected = await deps.updateState(
    buildDisconnectedStatePatch(current.googleSessionGeneration)
  );
  try {
    await deps.revokeCachedToken();
  } catch {
    // Ignore if no token is cached or network revoke fails
  }
  return disconnected;
}

export function countPendingAssignments(
  assignments: Array<{ submitted: boolean; dueDateIso: string | null }>
): number {
  const nowMinusOneDay = Date.now() - 24 * 60 * 60 * 1000;
  return assignments.filter((a) => {
    if (a.submitted) return false;
    if (!a.dueDateIso) return true;
    return Date.parse(a.dueDateIso) >= nowMinusOneDay;
  }).length;
}

export interface InstallLifecycleDeps {
  scheduleAutoScan: () => Promise<void>;
  getState: () => Promise<StoredExtensionState>;
  updateBadge: (pendingCount: number) => Promise<void>;
  openOnboardingTab: () => Promise<void>;
  revalidateAuth: (state: StoredExtensionState) => Promise<StoredExtensionState>;
}

export async function handleExtensionInstalled(
  reason: string,
  deps: InstallLifecycleDeps
): Promise<void> {
  await deps.scheduleAutoScan();

  let state = await deps.getState();
  if (reason === "update") {
    state = await deps.revalidateAuth(state);
  }

  await deps.updateBadge(countPendingAssignments(state.assignments));

  if (reason === "install") {
    await deps.openOnboardingTab();
  }
}
