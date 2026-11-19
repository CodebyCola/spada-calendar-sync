import { describe, expect, it } from "vitest";
import {
  buildDisconnectedStatePatch,
  handleExtensionInstalled,
  revalidateLegacyGoogleAuth,
  runDisconnectGoogle,
  runSessionGuardedConnect,
  runSessionGuardedSync,
} from "../src/background/install-lifecycle.js";
import { evaluateSetupStatus } from "../src/setup/setup-diagnostics.js";
import { DEFAULT_SETTINGS, type StoredExtensionState } from "../src/shared/storage.js";

function makeState(overrides: Partial<StoredExtensionState> = {}): StoredExtensionState {
  return {
    courses: [],
    assignments: [],
    lastScanAt: null,
    lastScanError: null,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastSyncError: null,
    googleConnected: false,
    googleAuthVerified: false,
    googleSessionGeneration: 0,
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

describe("buildDisconnectedStatePatch", () => {
  it("Clears googleConnected, googleAuthVerified, lastSyncAt, lastSyncSummary, lastSyncError and increments generation", () => {
    expect(buildDisconnectedStatePatch(2)).toEqual({
      googleConnected: false,
      googleAuthVerified: false,
      googleSessionGeneration: 3,
      lastSyncAt: null,
      lastSyncSummary: null,
      lastSyncError: null,
    });
  });
});

describe("revalidateLegacyGoogleAuth", () => {
  it("Upgrades legacy googleConnected state to googleAuthVerified when silent token succeeds", async () => {
    const legacy = makeState({
      googleConnected: true,
      googleAuthVerified: false,
      lastSyncAt: "2026-11-18T12:00:00.000Z",
    });

    let appliedPatch: Partial<StoredExtensionState> | null = null;
    const updated = await revalidateLegacyGoogleAuth(legacy, {
      oauthConfigured: true,
      getSilentToken: async () => "cached-token",
      updateState: async (patch) => {
        appliedPatch = patch;
        return { ...legacy, ...patch };
      },
    });

    expect(appliedPatch).toEqual({ googleAuthVerified: true });
    expect(updated.googleAuthVerified).toBe(true);
    expect(updated.lastSyncAt).toBe("2026-11-18T12:00:00.000Z");
  });

  it("Invalidates legacy state via buildDisconnectedStatePatch when silent token is missing or not granted", async () => {
    const legacy = makeState({
      googleConnected: true,
      googleAuthVerified: false,
      lastSyncAt: "2026-11-18T12:00:00.000Z",
      lastSyncSummary: { created: 0, updated: 0, skipped: 0 },
    });

    const clearedOnNull = await revalidateLegacyGoogleAuth(legacy, {
      oauthConfigured: true,
      getSilentToken: async () => null,
      updateState: async (patch) => ({ ...legacy, ...patch }),
    });
    expect(clearedOnNull.googleConnected).toBe(false);
    expect(clearedOnNull.googleAuthVerified).toBe(false);
    expect(clearedOnNull.lastSyncAt).toBeNull();
    expect(clearedOnNull.lastSyncSummary).toBeNull();

    const clearedOnRevoked = await revalidateLegacyGoogleAuth(legacy, {
      oauthConfigured: true,
      getSilentToken: async () => {
        throw new Error("OAuth2 not granted or revoked.");
      },
      updateState: async (patch) => ({ ...legacy, ...patch }),
    });
    expect(clearedOnRevoked.googleConnected).toBe(false);
    expect(clearedOnRevoked.lastSyncAt).toBeNull();
  });

  it("Preserves legacy state untouched on transient network errors while offline", async () => {
    const legacy = makeState({
      googleConnected: true,
      googleAuthVerified: false,
      lastSyncAt: "2026-11-18T12:00:00.000Z",
    });

    let updateCalls = 0;
    const result = await revalidateLegacyGoogleAuth(legacy, {
      oauthConfigured: true,
      getSilentToken: async () => {
        throw new Error("Failed to fetch");
      },
      updateState: async (patch) => {
        updateCalls++;
        return { ...legacy, ...patch };
      },
    });

    expect(updateCalls).toBe(0);
    expect(result.googleConnected).toBe(true);
    expect(result.googleAuthVerified).toBe(false);
    expect(result.lastSyncAt).toBe("2026-11-18T12:00:00.000Z");

    for (const chromiumOfflineErr of [
      "OAuth2 request failed: Service unavailable.",
      "OAuth2 request failed: Connection failed (-106).",
    ]) {
      let calls = 0;
      const preserved = await revalidateLegacyGoogleAuth(legacy, {
        oauthConfigured: true,
        getSilentToken: async () => {
          throw new Error(chromiumOfflineErr);
        },
        updateState: async (patch) => {
          calls++;
          return { ...legacy, ...patch };
        },
      });
      expect(calls).toBe(0);
      expect(preserved.googleConnected).toBe(true);
      expect(preserved.lastSyncAt).toBe("2026-11-18T12:00:00.000Z");
    }
  });

  it("No-ops when already verified or disconnected", async () => {
    let tokenCalls = 0;
    const verified = makeState({ googleConnected: true, googleAuthVerified: true });

    const out = await revalidateLegacyGoogleAuth(verified, {
      oauthConfigured: true,
      getSilentToken: async () => {
        tokenCalls++;
        return "tok";
      },
      updateState: async (patch) => ({ ...verified, ...patch }),
    });

    expect(tokenCalls).toBe(0);
    expect(out).toBe(verified);
  });
});

describe("handleExtensionInstalled", () => {
  it("Opens onboarding tab only on fresh install while always scheduling alarm and updating badge", async () => {
    const events: string[] = [];
    const baseState = makeState();

    await handleExtensionInstalled("install", {
      scheduleAutoScan: async () => {
        events.push("alarm");
      },
      getState: async () => baseState,
      updateBadge: async (count) => {
        events.push(`badge:${count}`);
      },
      openOnboardingTab: async () => {
        events.push("onboarding");
      },
      revalidateAuth: async (s) => {
        events.push("revalidate");
        return s;
      },
    });

    expect(events).toEqual(["alarm", "badge:0", "onboarding"]);
  });

  it("Does not open onboarding tab on update or chrome_update and revalidates legacy auth on update", async () => {
    const updateEvents: string[] = [];
    const baseState = makeState({ googleConnected: true, googleAuthVerified: false });

    await handleExtensionInstalled("update", {
      scheduleAutoScan: async () => {
        updateEvents.push("alarm");
      },
      getState: async () => baseState,
      updateBadge: async (count) => {
        updateEvents.push(`badge:${count}`);
      },
      openOnboardingTab: async () => {
        updateEvents.push("onboarding");
      },
      revalidateAuth: async (s) => {
        updateEvents.push("revalidate");
        return s;
      },
    });

    expect(updateEvents).toEqual(["alarm", "revalidate", "badge:0"]);

    const chromeUpdateEvents: string[] = [];
    await handleExtensionInstalled("chrome_update", {
      scheduleAutoScan: async () => {
        chromeUpdateEvents.push("alarm");
      },
      getState: async () => baseState,
      updateBadge: async (count) => {
        chromeUpdateEvents.push(`badge:${count}`);
      },
      openOnboardingTab: async () => {
        chromeUpdateEvents.push("onboarding");
      },
      revalidateAuth: async (s) => {
        chromeUpdateEvents.push("revalidate");
        return s;
      },
    });

    expect(chromeUpdateEvents).toEqual(["alarm", "badge:0"]);
  });
});

describe("Google session concurrency & legacy disconnect migration", () => {
  it("Prevents an in-flight SYNC_NOW from resurrecting Google connection after DISCONNECT_GOOGLE completes", async () => {
    let store = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      googleConnected: true,
      googleAuthVerified: true,
      googleSessionGeneration: 1,
    });

    const getState = async () => store;
    const updateState = async (patch: Partial<StoredExtensionState>) => {
      store = { ...store, ...patch };
      return store;
    };

    let releaseSync!: (summary: { created: number; updated: number; skipped: number }) => void;
    const heldSyncPromise = new Promise<{ created: number; updated: number; skipped: number }>(
      (resolve) => {
        releaseSync = resolve;
      }
    );

    // 1. Start SYNC_NOW and hold it mid-flight
    const syncTask = runSessionGuardedSync({
      getState,
      updateState,
      runSync: () => heldSyncPromise,
    });

    // 2. While sync is suspended, user clicks Disconnect ("Putuskan")
    await runDisconnectGoogle({
      getState,
      updateState,
      revokeCachedToken: async () => {},
    });

    expect(store.googleConnected).toBe(false);
    expect(store.googleAuthVerified).toBe(false);
    expect(store.googleSessionGeneration).toBe(2);

    // 3. Release the stale in-flight sync
    releaseSync({ created: 3, updated: 0, skipped: 0 });
    const syncOutcome = await syncTask;

    expect(syncOutcome.stale).toBe(true);
    expect(store.googleConnected).toBe(false);
    expect(store.googleAuthVerified).toBe(false);
    expect(store.lastSyncAt).toBeNull();
    expect(store.lastSyncSummary).toBeNull();

    // Also verifies pre-sync abort if disconnect happened during SCAN before runSync started
    let runSyncCalled = false;
    const preAborted = await runSessionGuardedSync({
      getState,
      updateState,
      expectedGeneration: 1, // stale compared to current generation 2
      runSync: async () => {
        runSyncCalled = true;
        return { created: 1, updated: 0, skipped: 0 };
      },
    });
    expect(preAborted.stale).toBe(true);
    expect(runSyncCalled).toBe(false);
  });

  it("Clears legacy disconnected lastSyncAt on CONNECT_GOOGLE so a newly connected account still requires first sync", async () => {
    // Reproduces v1.0.0 legacy state after disconnect: googleConnected=false but historical lastSyncAt persisted
    let store = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      googleConnected: false,
      googleAuthVerified: false,
      lastSyncAt: "2026-11-18T12:00:00.000Z",
      lastSyncSummary: { created: 4, updated: 0, skipped: 0 },
    });

    const getState = async () => store;
    const updateState = async (patch: Partial<StoredExtensionState>) => {
      store = { ...store, ...patch };
      return store;
    };

    const connectOutcome = await runSessionGuardedConnect({
      getState,
      updateState,
      requestToken: async () => "new-account-token",
    });

    expect(connectOutcome.stale).toBe(false);
    expect(store.googleConnected).toBe(true);
    expect(store.googleAuthVerified).toBe(true);
    expect(store.lastSyncAt).toBeNull();
    expect(store.lastSyncSummary).toBeNull();

    const status = evaluateSetupStatus(store, true);
    expect(status.steps.google.state).toBe("done");
    expect(status.steps.firstSync.state).toBe("active");
    expect(status.overallReady).toBe(false);
    expect(status.hasCompletedInitialSetup).toBe(false);
  });
});
