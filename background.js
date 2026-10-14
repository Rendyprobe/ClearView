/**
 * ClearView — background.js (Service Worker)
 * Handles extension lifecycle, tab messaging, storage coordination,
 * and badge updates. No DOM access occurs here.
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  enabled: true,
  sensitivity: 'balanced',       // 'conservative' | 'balanced' | 'aggressive'
  autoCleanup: true,
  previewOnly: false,
  mutationObserver: true,
  allowlist: [],                  // domains to skip entirely
  blocklist: [],                  // domains to always aggressively scan
  customPatterns: [],             // user-supplied text patterns
  exclusionKeywords: [
    'login', 'sign in', 'password', 'payment', 'checkout',
    'age verification', 'cookie', 'privacy policy', 'gdpr',
    'terms of service', 'captcha', 'security check'
  ],
  language: 'en',
  maxLogEntries: 200,
  undoHistorySize: 10
};

// ─── Installation / Startup ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, log: [] });
    console.log('[ClearView] Extension installed. Default settings applied.');
  } else if (reason === 'update') {
    // Merge new defaults without overwriting existing user settings
    const { settings: stored = {} } = await chrome.storage.local.get('settings');
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    await chrome.storage.local.set({ settings: merged });
    console.log('[ClearView] Extension updated. Settings merged.');
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[ClearView] Browser started.');
});

// ─── Badge Helper ────────────────────────────────────────────────────────────

async function setBadge(tabId, count, enabled) {
  if (!enabled) {
    await chrome.action.setBadgeText({ tabId, text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#555555' });
    return;
  }
  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    await chrome.action.setBadgeText({ tabId, text: label });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#00BCD4' });
  } else {
    await chrome.action.setBadgeText({ tabId, text: '' });
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  switch (message.type) {

    case 'BADGE_UPDATE': {
      const { count, enabled } = message;
      if (tabId !== undefined) setBadge(tabId, count, enabled);
      sendResponse({ ok: true });
      break;
    }

    case 'GET_SETTINGS': {
      chrome.storage.local.get('settings').then(({ settings }) => {
        sendResponse({ settings: settings ?? DEFAULT_SETTINGS });
      });
      return true; // async
    }

    case 'SAVE_SETTINGS': {
      chrome.storage.local.set({ settings: message.settings }).then(() => {
        // Notify all content scripts of updated settings
        notifyAllTabs({ type: 'SETTINGS_UPDATED', settings: message.settings });
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'LOG_EVENT': {
      appendLog(message.entry).then(() => sendResponse({ ok: true }));
      return true;
    }

    case 'GET_LOG': {
      chrome.storage.local.get('log').then(({ log }) => {
        sendResponse({ log: log ?? [] });
      });
      return true;
    }

    case 'CLEAR_LOG': {
      chrome.storage.local.set({ log: [] }).then(() => sendResponse({ ok: true }));
      return true;
    }

    case 'TRIGGER_SCAN': {
      // Forward scan request to the active tab's content script
      if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_SCAN' })
          .then(r => sendResponse(r))
          .catch(() => sendResponse({ error: 'Content script not ready' }));
        return true;
      }
      sendResponse({ error: 'No sender tab' });
      break;
    }

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return false;
});

// Popup/options page sending messages need tab targeting
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // This second listener only handles messages from extension pages (no tab)
  if (sender?.tab) return false;

  if (message.type === 'SCAN_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SCAN' })
        .then(r => sendResponse(r))
        .catch(() => sendResponse({ error: 'Content script not reachable' }));
    });
    return true;
  }

  if (message.type === 'UNDO_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'UNDO_CLEANUP' })
        .then(r => sendResponse(r))
        .catch(() => sendResponse({ error: 'Content script not reachable' }));
    });
    return true;
  }

  if (message.type === 'GET_TAB_STATUS') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' })
        .then(r => sendResponse(r))
        .catch(() => sendResponse({ error: 'Content script not reachable', tabUrl: tab.url }));
    });
    return true;
  }

  return false;
});

// ─── Log Management ───────────────────────────────────────────────────────────

async function appendLog(entry) {
  const { settings, log = [] } = await chrome.storage.local.get(['settings', 'log']);
  const maxEntries = settings?.maxLogEntries ?? DEFAULT_SETTINGS.maxLogEntries;
  const next = [{ ...entry, timestamp: Date.now() }, ...log].slice(0, maxEntries);
  await chrome.storage.local.set({ log: next });
}

// ─── Broadcast to All Tabs ────────────────────────────────────────────────────

async function notifyAllTabs(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url?.startsWith('http')) continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

