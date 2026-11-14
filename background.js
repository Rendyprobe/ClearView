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
  undoHistorySize: 10,
  blockPopups: true               // Intelligently block hijacked ad-tabs/popunders
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

// ─── Badge Helper & Tab Frame Aggregation ───────────────────────────────────

const tabFrameCounts = new Map();
const recentPopupAttempts = new Map();

function getTabTotalCount(tabId) {
  const frames = tabFrameCounts.get(tabId);
  if (!frames) return 0;
  let total = 0;
  for (const count of frames.values()) total += count;
  return total;
}

chrome.tabs.onRemoved.addListener(tabId => {
  tabFrameCounts.delete(tabId);
  recentPopupAttempts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    tabFrameCounts.delete(tabId);
  }
});

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
  const frameId = sender?.frameId ?? 0;

  switch (message.type) {

    case 'BADGE_UPDATE': {
      const { count, enabled } = message;
      if (tabId !== undefined) {
        if (!tabFrameCounts.has(tabId)) tabFrameCounts.set(tabId, new Map());
        tabFrameCounts.get(tabId).set(frameId, count || 0);
        const total = getTabTotalCount(tabId);
        setBadge(tabId, total, enabled);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'SUSPICIOUS_POPUP_ATTEMPT': {
      if (tabId !== undefined) {
        recentPopupAttempts.set(tabId, Date.now());
      }
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
        .then(r => {
          const totalCount = getTabTotalCount(tab.id) || r?.removedCount || 0;
          sendResponse({ ...r, removedCount: totalCount });
        })
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

// ─── Intelligent New-Tab / Popunder Interception ──────────────────────────────

const AD_SUSPICIOUS_URL_PATTERNS = [
  /ad[\s_.-]?(?:click|server|traffic|network|rotator|redirect|gateway|zone|link|cash|maven|keeper|ster|center)/i,
  /pop[\s_.-]?(?:under|up|cash|ads|myads)/i,
  /(?:bet|casino|gambling|porn|tracker|affiliate|trk|syndication|clickadu|hilltopads|propellerads|exoclick|monetag|richpush|yadro|trafficstars|juicyads|trafficjunky|onclick|revenuehits|yllix)/i,
  /(?:doubleclick\.net|googlesyndication\.com|adnxs\.com)/i,
  /[?&](?:utm_source|aff_id|subid|clickid|pubid|cid|camp|direct_link)=/i,
  /(?:1x-?bet|bet365|slot|jackpot|bonus|vulkan)/i
];

chrome.tabs.onCreated.addListener(async (newTab) => {
  try {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    if (!settings.enabled || settings.blockPopups === false) return;

    // Check if opened by another tab
    if (!newTab.openerTabId) return;

    const openerTab = await chrome.tabs.get(newTab.openerTabId).catch(() => null);
    if (!openerTab || !openerTab.url || !openerTab.url.startsWith('http')) return;

    // Skip if opener domain is allowlisted
    const openerDomain = new URL(openerTab.url).hostname.replace(/^www\./, '');
    const isAllowlisted = (settings.allowlist || []).some(d => {
      const clean = d.replace(/^www\./, '');
      return openerDomain === clean || openerDomain.endsWith('.' + clean);
    });
    if (isAllowlisted) return;

    const tabId = newTab.id;

    // Check if opener tab recently reported a blocked suspicious popup attempt from video player
    const getAttemptDelta = () => Date.now() - (recentPopupAttempts.get(newTab.openerTabId) || 0);
    const isRecentSuspiciousAttempt = () => getAttemptDelta() < 3500;

    // Close tab helper
    const closeBlockedTab = (targetUrl, reason) => {
      chrome.tabs.remove(tabId).catch(() => {});
      chrome.tabs.sendMessage(newTab.openerTabId, {
        type: 'POPUP_TAB_BLOCKED',
        blockedUrl: targetUrl
      }).catch(() => {});

      appendLog({
        type: 'blocked_tab',
        domain: openerDomain,
        url: (targetUrl || '').slice(0, 100),
        reason: reason || 'Suspicious ad/popunder URL pattern'
      });
    };

    // If immediately opened during an unauthorized video popup attempt and initial url matches or is blank
    if (isRecentSuspiciousAttempt() && (newTab.pendingUrl || newTab.url)) {
      const initialUrl = newTab.pendingUrl || newTab.url || '';
      if (initialUrl === 'about:blank' || AD_SUSPICIOUS_URL_PATTERNS.some(p => p.test(initialUrl))) {
        closeBlockedTab(initialUrl, 'Correlated with blocked video popup event');
        return;
      }
    }

    // Monitor url updates on this new tab
    const urlCheckListener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      const targetUrl = changeInfo.url;
      if (!targetUrl) return;

      // Check if target matches ad/popunder suspicious patterns or correlated attempt
      const isSuspicious = AD_SUSPICIOUS_URL_PATTERNS.some(p => p.test(targetUrl));
      if (isSuspicious || (isRecentSuspiciousAttempt() && !targetUrl.includes(openerDomain))) {
        chrome.tabs.onUpdated.removeListener(urlCheckListener);
        closeBlockedTab(targetUrl, isSuspicious ? 'Suspicious ad/popunder URL pattern' : 'Blocked video provider popup');
      }
    };

    chrome.tabs.onUpdated.addListener(urlCheckListener);
    // Remove listener after 10 seconds if no trigger
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(urlCheckListener);
    }, 10000);

  } catch (err) {
    console.error('[ClearView] Error in tab watcher:', err);
  }
});


