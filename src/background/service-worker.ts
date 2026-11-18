import type { SpadaCourse } from "../parsers/spada-html.js";
import { getStoredState, updateStoredState } from "../shared/storage.js";
import {
  isOAuthClientConfigured,
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
  | { type: "SPADA_PAGE_VISITED"; courses?: SpadaCourse[] };

async function updateActionBadge(pendingCount: number): Promise<void> {
  const text = pendingCount > 0 ? String(pendingCount) : "";
  await chrome.action.setBadgeText({ text });
  if (pendingCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D97706" });
  }
}

function countPendingAssignments(
  assignments: Array<{ submitted: boolean; dueDateIso: string | null }>
): number {
  const nowMinusOneDay = Date.now() - 24 * 60 * 60 * 1000;
  return assignments.filter((a) => {
    if (a.submitted) return false;
    if (!a.dueDateIso) return true;
    return Date.parse(a.dueDateIso) >= nowMinusOneDay;
  }).length;
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

async function performSync(interactive: boolean): Promise<void> {
  const state = await getStoredState();
  try {
    const summary = await syncAssignmentsToGoogleCalendar(
      state.assignments,
      state.settings,
      interactive
    );
    await updateStoredState({
      googleConnected: true,
      lastSyncAt: new Date().toISOString(),
      lastSyncSummary: summary,
      lastSyncError: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateStoredState({
      lastSyncError: message,
    });
    throw err;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(AUTO_SCAN_ALARM, {
    periodInMinutes: AUTO_SCAN_PERIOD_MINUTES,
  });
  const state = await getStoredState();
  await updateActionBadge(countPendingAssignments(state.assignments));
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SCAN_ALARM) return;
  try {
    await performScan();
    const state = await getStoredState();
    if (state.googleConnected && isOAuthClientConfigured()) {
      await performSync(false);
    }
  } catch (err) {
    console.warn("Background SPADA alarm scan skipped:", err);
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_STATE") {
        const state = await getStoredState();
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
        if (!isOAuthClientConfigured()) {
          throw new Error(
            "OAUTH_NOT_CONFIGURED: Isi oauth2.client_id di manifest.json dulu sebelum menghubungkan Google."
          );
        }
        const tokenRes = await chrome.identity.getAuthToken({ interactive: true });
        if (!tokenRes.token) {
          throw new Error("Gagal menghubungkan akun Google.");
        }
        const state = await updateStoredState({
          googleConnected: true,
          lastSyncError: null,
        });
        sendResponse({ ok: true, state, oauthConfigured: true });
        return;
      }

      if (message.type === "DISCONNECT_GOOGLE") {
        try {
          const tokenRes = await chrome.identity.getAuthToken({ interactive: false });
          if (tokenRes.token) {
            await chrome.identity.removeCachedAuthToken({ token: tokenRes.token });
            await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${tokenRes.token}`);
          }
        } catch {
          // Ignore if no token is cached
        }
        const state = await updateStoredState({
          googleConnected: false,
          lastSyncError: null,
        });
        sendResponse({ ok: true, state, oauthConfigured: isOAuthClientConfigured() });
        return;
      }

      if (message.type === "SYNC_NOW") {
        await performScan();
        await performSync(true);
        const state = await getStoredState();
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
        const updated = await getStoredState();
        if (updated.googleConnected && isOAuthClientConfigured()) {
          await performSync(false);
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
