import type {
  StateMutationDecision,
  StoredExtensionState,
  SyncSummary,
} from "../shared/storage.js";

export type AtomicStateMutator = <T>(
  mutator: (current: StoredExtensionState) => StateMutationDecision<T>
) => Promise<{ state: StoredExtensionState; result: T }>;

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

function resolveMutator(deps: {
  mutateState?: AtomicStateMutator;
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
}): AtomicStateMutator {
  if (deps.mutateState) {
    return deps.mutateState;
  }
  return async <T>(mutator: (current: StoredExtensionState) => StateMutationDecision<T>) => {
    const current = await deps.getState();
    const { patch, result } = mutator(current);
    if (!patch) {
      return { state: current, result };
    }
    const next = await deps.updateState(patch);
    return { state: next, result };
  };
}

export interface RevalidateLegacyAuthDeps {
  oauthConfigured: boolean;
  getSilentToken: () => Promise<string | null>;
  getState?: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  mutateState?: AtomicStateMutator;
}

const TRANSIENT_NETWORK_ERROR_PATTERN =
  /failed to fetch|network|offline|timeout|timed out|internet|err_connection|err_name_not_resolved|err_network|service unavailable|connection failed/i;

const AUTH_INVALIDATED_ERROR_PATTERN =
  /oauth2 not granted|oauth2.*revoked|not granted|revoked|not signed in|no token|did not approve|canceled|cancelled|access_denied|org_internal|interaction required|browser sign-?in|invalid_client|bad client id/i;

/**
 * Revalidates legacy stored states where `googleConnected` was set true before
 * `googleAuthVerified` existed (such as the old unauthenticated 0-assignment sync path).
 * Performs generation checks atomically inside `mutateState` so concurrent disconnects win.
 */
export async function revalidateLegacyGoogleAuth(
  state: StoredExtensionState,
  deps: RevalidateLegacyAuthDeps
): Promise<StoredExtensionState> {
  if (!state.googleConnected || state.googleAuthVerified || !deps.oauthConfigured) {
    return state;
  }

  const startGeneration = state.googleSessionGeneration;
  const mutate = resolveMutator({
    mutateState: deps.mutateState,
    getState: deps.getState ?? (async () => state),
    updateState: deps.updateState,
  });

  try {
    const token = await deps.getSilentToken();
    const { state: updated } = await mutate((current) => {
      if (
        current.googleSessionGeneration !== startGeneration ||
        !current.googleConnected ||
        current.googleAuthVerified
      ) {
        return { patch: null, result: undefined };
      }
      if (token && token.trim().length > 0) {
        return { patch: { googleAuthVerified: true }, result: undefined };
      }
      return {
        patch: buildDisconnectedStatePatch(current.googleSessionGeneration),
        result: undefined,
      };
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (TRANSIENT_NETWORK_ERROR_PATTERN.test(message)) {
      return state;
    }
    if (AUTH_INVALIDATED_ERROR_PATTERN.test(message)) {
      const { state: updated } = await mutate((current) => {
        if (
          current.googleSessionGeneration !== startGeneration ||
          !current.googleConnected ||
          current.googleAuthVerified
        ) {
          return { patch: null, result: undefined };
        }
        return {
          patch: buildDisconnectedStatePatch(current.googleSessionGeneration),
          result: undefined,
        };
      });
      return updated;
    }
    return state;
  }
}

export interface SessionGuardedSyncDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  mutateState?: AtomicStateMutator;
  runSync: (state: StoredExtensionState) => Promise<SyncSummary>;
  expectedGeneration?: number;
  requireConnected?: boolean;
  nowIso?: () => string;
}

/**
 * Runs a calendar sync guarded atomically by `googleSessionGeneration` inside `mutateState`
 * so an in-flight sync cannot resurrect a session whose disconnect is pending or completed.
 */
export async function runSessionGuardedSync(
  deps: SessionGuardedSyncDeps
): Promise<{ stale: boolean; summary: SyncSummary | null }> {
  const mutate = resolveMutator(deps);
  const initialState = await deps.getState();

  if (
    deps.expectedGeneration !== undefined &&
    initialState.googleSessionGeneration !== deps.expectedGeneration
  ) {
    return { stale: true, summary: null };
  }
  if (
    deps.requireConnected &&
    (!initialState.googleConnected || !initialState.googleAuthVerified)
  ) {
    return { stale: true, summary: null };
  }

  const startGeneration = initialState.googleSessionGeneration;

  try {
    const summary = await deps.runSync(initialState);
    const { result: isStale } = await mutate((current) => {
      if (current.googleSessionGeneration !== startGeneration) {
        return { patch: null, result: true };
      }
      return {
        patch: {
          googleConnected: true,
          googleAuthVerified: true,
          lastSyncAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
          lastSyncSummary: summary,
          lastSyncError: null,
        },
        result: false,
      };
    });
    return isStale ? { stale: true, summary: null } : { stale: false, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { result: isStale } = await mutate((current) => {
      if (current.googleSessionGeneration !== startGeneration) {
        return { patch: null, result: true };
      }
      return { patch: { lastSyncError: message }, result: false };
    });
    if (isStale) {
      return { stale: true, summary: null };
    }
    throw err;
  }
}

export interface SessionGuardedConnectDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  mutateState?: AtomicStateMutator;
  requestToken: () => Promise<string>;
}

/**
 * Runs Google account connection guarded atomically by `googleSessionGeneration`,
 * clearing any stale legacy `lastSyncAt`/`lastSyncSummary` when connecting from disconnected state.
 */
export async function runSessionGuardedConnect(
  deps: SessionGuardedConnectDeps
): Promise<{ stale: boolean; state: StoredExtensionState }> {
  const mutate = resolveMutator(deps);
  const initialState = await deps.getState();
  const startGeneration = initialState.googleSessionGeneration;

  try {
    await deps.requestToken();
    const { state: updated, result: isStale } = await mutate((current) => {
      if (current.googleSessionGeneration !== startGeneration) {
        return { patch: null, result: true };
      }
      return { patch: buildConnectedStatePatch(current), result: false };
    });
    return { stale: isStale, state: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mutate((current) => {
      if (current.googleSessionGeneration !== startGeneration) {
        return { patch: null, result: undefined };
      }
      return { patch: { lastSyncError: message }, result: undefined };
    });
    throw err;
  }
}

export interface DisconnectGoogleDeps {
  getState: () => Promise<StoredExtensionState>;
  updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState>;
  mutateState?: AtomicStateMutator;
  revokeCachedToken: () => Promise<void>;
}

/**
 * Atomically increments `googleSessionGeneration` and clears connected/sync state inside
 * the serialized storage queue BEFORE performing best-effort token revocation.
 */
export async function runDisconnectGoogle(
  deps: DisconnectGoogleDeps
): Promise<StoredExtensionState> {
  const mutate = resolveMutator(deps);
  const { state: disconnected } = await mutate((current) => ({
    patch: buildDisconnectedStatePatch(current.googleSessionGeneration),
    result: undefined,
  }));

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
