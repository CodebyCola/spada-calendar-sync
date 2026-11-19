import type { StoredExtensionState } from "../shared/storage.js";

export type DisconnectedStatePatch = Pick<
  StoredExtensionState,
  "googleConnected" | "googleAuthVerified" | "lastSyncAt" | "lastSyncSummary" | "lastSyncError"
>;

export function buildDisconnectedStatePatch(): DisconnectedStatePatch {
  return {
    googleConnected: false,
    googleAuthVerified: false,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastSyncError: null,
  };
}

export interface RevalidateLegacyAuthDeps {
  oauthConfigured: boolean;
  getSilentToken: () => Promise<string | null>;
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

  try {
    const token = await deps.getSilentToken();
    if (token && token.trim().length > 0) {
      return await deps.updateState({ googleAuthVerified: true });
    }
    return await deps.updateState(buildDisconnectedStatePatch());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (TRANSIENT_NETWORK_ERROR_PATTERN.test(message)) {
      return state;
    }
    if (AUTH_INVALIDATED_ERROR_PATTERN.test(message)) {
      return await deps.updateState(buildDisconnectedStatePatch());
    }
    return state;
  }
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
