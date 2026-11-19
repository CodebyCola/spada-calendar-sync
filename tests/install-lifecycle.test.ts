import { afterEach, describe, expect, it } from "vitest";
import {
  buildDisconnectedStatePatch,
  handleExtensionInstalled,
  revalidateLegacyGoogleAuth,
  runClearLocalData,
  runDisconnectGoogle,
  runSaveSettings,
  runSessionGuardedConnect,
  runSessionGuardedSync,
} from "../src/background/install-lifecycle.js";
import { evaluateSetupStatus } from "../src/setup/setup-diagnostics.js";
import {
  DEFAULT_SETTINGS,
  getStoredState,
  mutateStoredState,
  type StoredExtensionState,
  updateStoredState,
} from "../src/shared/storage.js";

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

describe("Atomic storage-queue generation checks under pending disconnect writes", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  });

  function installInMemoryChromeStorage(initial: StoredExtensionState) {
    let data: Record<string, unknown> = { spadaScannerState: structuredClone(initial) };
    let holdNextSet = false;
    let setStartedResolve: (() => void) | null = null;
    let releaseHeldSet: (() => void) | null = null;

    const waitUntilHeldSetStarts = () =>
      new Promise<void>((resolve) => {
        setStartedResolve = resolve;
      });

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
          set: async (items: Record<string, unknown>) => {
            if (holdNextSet) {
              holdNextSet = false;
              setStartedResolve?.();
              await new Promise<void>((resolve) => {
                releaseHeldSet = resolve;
              });
            }
            data = { ...data, ...structuredClone(items) };
          },
        },
      },
    };

    return {
      armHoldOnNextSet: () => {
        holdNextSet = true;
      },
      waitUntilHeldSetStarts,
      releaseSet: () => {
        releaseHeldSet?.();
      },
    };
  }

  it("Does not resurrect Google connection when SYNC finishes while DISCONNECT write is still pending in storage queue", async () => {
    const harness = installInMemoryChromeStorage(
      makeState({
        lastScanAt: "2026-11-19T00:00:00.000Z",
        googleConnected: true,
        googleAuthVerified: true,
        googleSessionGeneration: 1,
      })
    );

    let releaseSync!: (summary: { created: number; updated: number; skipped: number }) => void;
    const heldSync = new Promise<{ created: number; updated: number; skipped: number }>((resolve) => {
      releaseSync = resolve;
    });

    const syncTask = runSessionGuardedSync({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      runSync: () => heldSync,
    });

    // Ensure sync captured startGeneration=1 before disconnect starts
    await Promise.resolve();
    await Promise.resolve();

    // Hold disconnect's chrome.storage.local.set mid-flight inside the storage queue
    harness.armHoldOnNextSet();
    const setStarted = harness.waitUntilHeldSetStarts();
    const disconnectTask = runDisconnectGoogle({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      revokeCachedToken: async () => {},
    });
    await setStarted;

    // Release sync WHILE disconnect's storage.local.set is still pending (storage.get still sees generation 1!)
    releaseSync({ created: 5, updated: 0, skipped: 0 });
    await Promise.resolve();
    await Promise.resolve();

    // Now let disconnect's storage write finish, then wait for both tasks
    harness.releaseSet();
    await disconnectTask;
    const syncOutcome = await syncTask;

    const finalState = await getStoredState();
    expect(syncOutcome.stale).toBe(true);
    expect(finalState.googleSessionGeneration).toBe(2);
    expect(finalState.googleConnected).toBe(false);
    expect(finalState.googleAuthVerified).toBe(false);
    expect(finalState.lastSyncAt).toBeNull();
  });

  it("Does not resurrect Google connection when CONNECT or legacy revalidation finishes while DISCONNECT write is pending", async () => {
    const harness = installInMemoryChromeStorage(
      makeState({
        lastScanAt: "2026-11-19T00:00:00.000Z",
        googleConnected: true,
        googleAuthVerified: false,
        googleSessionGeneration: 1,
      })
    );

    let releaseToken!: (token: string) => void;
    const heldToken = new Promise<string>((resolve) => {
      releaseToken = resolve;
    });

    const connectTask = runSessionGuardedConnect({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      requestToken: () => heldToken,
    });

    await Promise.resolve();
    await Promise.resolve();

    harness.armHoldOnNextSet();
    const setStarted = harness.waitUntilHeldSetStarts();
    const disconnectTask = runDisconnectGoogle({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      revokeCachedToken: async () => {},
    });
    await setStarted;

    releaseToken("fresh-token");
    await Promise.resolve();
    await Promise.resolve();

    harness.releaseSet();
    await disconnectTask;
    const connectOutcome = await connectTask;

    const finalState = await getStoredState();
    expect(connectOutcome.stale).toBe(true);
    expect(finalState.googleSessionGeneration).toBe(2);
    expect(finalState.googleConnected).toBe(false);
    expect(finalState.googleAuthVerified).toBe(false);

    // Also verify revalidateLegacyGoogleAuth under pending disconnect write
    const revalHarness = installInMemoryChromeStorage(
      makeState({
        googleConnected: true,
        googleAuthVerified: false,
        googleSessionGeneration: 1,
      })
    );

    let releaseSilentToken!: (tok: string | null) => void;
    const heldSilent = new Promise<string | null>((resolve) => {
      releaseSilentToken = resolve;
    });

    const initialLegacy = await getStoredState();
    const revalTask = revalidateLegacyGoogleAuth(initialLegacy, {
      oauthConfigured: true,
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      getSilentToken: () => heldSilent,
    });

    await Promise.resolve();
    await Promise.resolve();

    revalHarness.armHoldOnNextSet();
    const revalSetStarted = revalHarness.waitUntilHeldSetStarts();
    const disconnectTask2 = runDisconnectGoogle({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      revokeCachedToken: async () => {},
    });
    await revalSetStarted;

    releaseSilentToken("legacy-token");
    await Promise.resolve();
    await Promise.resolve();

    revalHarness.releaseSet();
    await disconnectTask2;
    await revalTask;

    const finalRevalState = await getStoredState();
    expect(finalRevalState.googleSessionGeneration).toBe(2);
    expect(finalRevalState.googleConnected).toBe(false);
    expect(finalRevalState.googleAuthVerified).toBe(false);
  });

  it("Skips auto-sync when requireConnected is true and state was already disconnected", async () => {
    const store = makeState({
      lastScanAt: "2026-11-19T00:00:00.000Z",
      googleConnected: false,
      googleAuthVerified: false,
      googleSessionGeneration: 2,
    });

    let runSyncCalled = false;
    const outcome = await runSessionGuardedSync({
      getState: async () => store,
      updateState: async (p) => ({ ...store, ...p }),
      expectedGeneration: 2,
      requireConnected: true,
      runSync: async () => {
        runSyncCalled = true;
        return { created: 1, updated: 0, skipped: 0 };
      },
    });

    expect(outcome.stale).toBe(true);
    expect(runSyncCalled).toBe(false);
  });

  it("Preserves disconnect when Options saves settings concurrently through the worker storage queue", async () => {
    const harness = installInMemoryChromeStorage(
      makeState({
        googleConnected: true,
        googleAuthVerified: true,
        googleSessionGeneration: 0,
      })
    );

    // Hold disconnect's write in-flight while Options submits SAVE_SETTINGS
    harness.armHoldOnNextSet();
    const setStarted = harness.waitUntilHeldSetStarts();
    const disconnectTask = runDisconnectGoogle({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      revokeCachedToken: async () => {},
    });
    await setStarted;

    const saveTask = runSaveSettings(
      {
        calendarId: "team-cal@group.calendar.google.com",
        syncSubmitted: false,
        includePastAssignments: true,
        autoSyncOnVisit: false,
      },
      {
        getState: getStoredState,
        updateState: updateStoredState,
        mutateState: mutateStoredState,
      }
    );

    harness.releaseSet();
    await disconnectTask;
    const savedState = await saveTask;

    const finalState = await getStoredState();
    expect(savedState.googleConnected).toBe(false);
    expect(finalState.googleConnected).toBe(false);
    expect(finalState.googleAuthVerified).toBe(false);
    expect(finalState.googleSessionGeneration).toBe(1);
    expect(finalState.settings).toEqual({
      calendarId: "team-cal@group.calendar.google.com",
      syncSubmitted: false,
      includePastAssignments: true,
      autoSyncOnVisit: false,
    });
  });

  it("Prevents an in-flight sync started at generation 0 from resurrecting Google state after CLEAR_DATA reset", async () => {
    installInMemoryChromeStorage(
      makeState({
        courses: [
          {
            courseId: "52581",
            courseName: "Kapita Selekta",
            shortCourseName: "Kapita Selekta",
            courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
          },
        ],
        lastScanAt: "2026-11-19T00:00:00.000Z",
        googleConnected: true,
        googleAuthVerified: true,
        googleSessionGeneration: 0,
        settings: {
          ...DEFAULT_SETTINGS,
          calendarId: "custom-cal",
        },
      })
    );

    let releaseSync!: (summary: { created: number; updated: number; skipped: number }) => void;
    const heldSync = new Promise<{ created: number; updated: number; skipped: number }>((resolve) => {
      releaseSync = resolve;
    });

    // 1. Start sync at generation 0
    const syncTask = runSessionGuardedSync({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      runSync: () => heldSync,
    });

    await Promise.resolve();
    await Promise.resolve();

    // 2. User triggers "Hapus Data Lokal" via worker CLEAR_DATA
    let badgeResetValue: number | null = null;
    await runClearLocalData({
      getState: getStoredState,
      updateState: updateStoredState,
      mutateState: mutateStoredState,
      updateBadge: async (count) => {
        badgeResetValue = count;
      },
    });

    // 3. Release the held generation-0 sync
    releaseSync({ created: 4, updated: 1, skipped: 0 });
    const syncOutcome = await syncTask;

    const finalState = await getStoredState();
    expect(badgeResetValue).toBe(0);
    expect(syncOutcome.stale).toBe(true);
    expect(finalState.googleSessionGeneration).toBe(1);
    expect(finalState.googleConnected).toBe(false);
    expect(finalState.googleAuthVerified).toBe(false);
    expect(finalState.lastSyncAt).toBeNull();
    expect(finalState.lastSyncSummary).toBeNull();
    expect(finalState.courses).toEqual([]);
    expect(finalState.settings).toEqual(DEFAULT_SETTINGS);
  });
});
