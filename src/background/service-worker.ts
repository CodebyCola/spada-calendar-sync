import type { SpadaCourse } from "../parsers/spada-html.js";
import {
  getStoredState,
  mutateStoredState,
  updateStoredState,
  type StoredExtensionState,
} from "../shared/storage.js";
import {
  countPendingAssignments,
  handleExtensionInstalled,
  revalidateLegacyGoogleAuth,
  runClearLocalData,
  runDisconnectGoogle,
  runSaveSettings,
  runSessionGuardedConnect,
  runSessionGuardedSync,
} from "./install-lifecycle.js";
import { runListWritableCalendars } from "./calendar-list-handler.js";
import {
  CALENDAR_EVENTS_SCOPES,
  isOAuthClientConfigured,
  requestChromeAuthToken,
  requestChromeAuthTokenDetailed,
  revokeAllGoogleTokens,
  scanSpadaWithFetcher,
  syncAssignmentsToGoogleCalendar,
} from "./scanner.js";

const AUTO_SCAN_ALARM = "spada-auto-scan";
const AUTO_SCAN_PERIOD_MINUTES = 180;
const VISIT_THROTTLE_MS = 15 * 60 * 1000;

export type ExtensionMessage =
  | { type: "GET_STATE" }
  | { type: "SCAN_NOW"; courses?: SpadaCourse[] }
  | { type: "CONNECT_GOOGLE" }
  | { type: "DISCONNECT_GOOGLE" }
  | { type: "SYNC_NOW" }
  | { type: "SAVE_SETTINGS"; settings: unknown }
  | { type: "CLEAR_DATA" }
  | { type: "LIST_CALENDARS"; interactive?: boolean }
  | { type: "SPADA_PAGE_VISITED"; courses?: SpadaCourse[] };

async function updateActionBadge(pendingCount: number): Promise<void> {
  const text = pendingCount > 0 ? String(pendingCount) : "";
  await chrome.action.setBadgeText({ text });
  if (pendingCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D97706" });
  }
}

async function revalidateStateIfNeeded(
  state: StoredExtensionState
): Promise<StoredExtensionState> {
  return revalidateLegacyGoogleAuth(state, {
    oauthConfigured: isOAuthClientConfigured(),
    getState: getStoredState,
    mutateState: mutateStoredState,
    getSilentToken: async () => {
      if (typeof chrome.identity?.getAuthToken !== "function") {
        return null;
      }
      const result = await chrome.identity.getAuthToken({
        interactive: false,
        scopes: [...CALENDAR_EVENTS_SCOPES],
      });
      return result.token ?? null;
    },
    updateState: updateStoredState,
  });
}

async function performScan(seedCourses?: SpadaCourse[]): Promise<void> {
  try {
    const result = await scanSpadaWithFetcher(fetch, seedCourses);
    await updateStoredState({
      courses: result.courses,
      assignments: result.assignments,
      lastScanAt: new Date().toISOString(),
      lastScanError: null,
    });
    await updateActionBadge(countPendingAssignments(result.assignments));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateStoredState({
      lastScanError: message,
    });
    throw err;
  }
}

async function performSync(
  interactive: boolean,
  expectedGeneration?: number,
  requireConnected = false
): Promise<void> {
  await runSessionGuardedSync({
    getState: getStoredState,
    updateState: updateStoredState,
    mutateState: mutateStoredState,
    expectedGeneration,
    requireConnected,
    runSync: (state) =>
      syncAssignmentsToGoogleCalendar(state.assignments, state.settings, interactive),
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await handleExtensionInstalled(details.reason, {
    scheduleAutoScan: async () => {
      await chrome.alarms.create(AUTO_SCAN_ALARM, {
        periodInMinutes: AUTO_SCAN_PERIOD_MINUTES,
      });
    },
    getState: getStoredState,
    updateBadge: updateActionBadge,
    openOnboardingTab: async () => {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("onboarding/onboarding.html"),
      });
    },
    revalidateAuth: revalidateStateIfNeeded,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SCAN_ALARM) return;
  try {
    await performScan();
    const state = await revalidateStateIfNeeded(await getStoredState());
    if (state.googleConnected && state.googleAuthVerified && isOAuthClientConfigured()) {
      await performSync(false, state.googleSessionGeneration, true);
    }
  } catch (err) {
    console.warn("Background SPADA alarm scan skipped:", err);
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_STATE") {
        const state = await revalidateStateIfNeeded(await getStoredState());
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "SCAN_NOW") {
        await performScan(message.courses);
        const state = await getStoredState();
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "CONNECT_GOOGLE") {
        const result = await runSessionGuardedConnect({
          getState: getStoredState,
          updateState: updateStoredState,
          mutateState: mutateStoredState,
          requestToken: async () => {
            if (!isOAuthClientConfigured()) {
              throw new Error(
                "OAUTH_NOT_CONFIGURED: Isi oauth2.client_id di manifest.json dulu sebelum menghubungkan Google."
              );
            }
            return requestChromeAuthToken(true);
          },
        });
        sendResponse({ ok: true, state: result.state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "DISCONNECT_GOOGLE") {
        const state = await runDisconnectGoogle({
          getState: getStoredState,
          updateState: updateStoredState,
          mutateState: mutateStoredState,
          revokeCachedToken: () => revokeAllGoogleTokens(),
        });
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "LIST_CALENDARS") {
        const result = await runListWritableCalendars(Boolean(message.interactive), {
          oauthConfigured: isOAuthClientConfigured(),
          getState: getStoredState,
          getTokenDetailed: (interactive, scopes) =>
            requestChromeAuthTokenDetailed(interactive, scopes),
          removeCachedToken: async (token) => {
            if (typeof chrome.identity?.removeCachedAuthToken === "function") {
              await chrome.identity.removeCachedAuthToken({ token });
            }
          },
        });
        sendResponse(result);
        return;
      }

      if (message.type === "SYNC_NOW") {
        const startGeneration = (await getStoredState()).googleSessionGeneration;
        await performScan();
        await performSync(true, startGeneration);
        const state = await getStoredState();
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "SAVE_SETTINGS") {
        const state = await runSaveSettings(message.settings, {
          getState: getStoredState,
          updateState: updateStoredState,
          mutateState: mutateStoredState,
        });
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "CLEAR_DATA") {
        const state = await runClearLocalData({
          getState: getStoredState,
          updateState: updateStoredState,
          mutateState: mutateStoredState,
          updateBadge: updateActionBadge,
        });
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "SPADA_PAGE_VISITED") {
        const current = await getStoredState();
        if (!current.settings.autoSyncOnVisit) {
          sendResponse({ ok: true, skipped: true });
          return;
        }
        const lastMs = current.lastScanAt ? Date.parse(current.lastScanAt) : 0;
        if (Date.now() - lastMs < VISIT_THROTTLE_MS && current.assignments.length > 0) {
          sendResponse({ ok: true, throttled: true });
          return;
        }
        await performScan(message.courses);
        const updated = await revalidateStateIfNeeded(await getStoredState());
        if (updated.googleConnected && updated.googleAuthVerified && isOAuthClientConfigured()) {
          await performSync(false, updated.googleSessionGeneration, true);
        }
        sendResponse({ ok: true });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const state = await getStoredState();
      sendResponse({
        ok: false,
        error: errorMessage,
        state,
        oauthConfigured: isOAuthClientConfigured(),
      });
    }
  })();

  return true;
});
