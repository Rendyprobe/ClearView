/**
 * ClearView — popup.js
 * Controls the browser action popup UI.
 */

'use strict';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const masterToggle      = document.getElementById('masterToggle');
const statusDot         = document.getElementById('statusDot');
const statusText        = document.getElementById('statusText');
const removedCountEl    = document.getElementById('removedCount');
const modeLabelEl       = document.getElementById('modeLabel');
const domainLabelEl     = document.getElementById('domainLabel');
const restrictedNotice  = document.getElementById('restrictedNotice');
const allowlistedNotice = document.getElementById('allowlistedNotice');
const btnScan           = document.getElementById('btnScan');
const btnUndo           = document.getElementById('btnUndo');
const btnAllowlist      = document.getElementById('btnAllowlist');
const btnOptions        = document.getElementById('btnOptions');
const allowlistBtnLabel = document.getElementById('allowlistBtnLabel');
const feedback          = document.getElementById('feedback');
const feedbackText      = document.getElementById('feedbackText');
const footerDiag        = document.getElementById('footerDiag');

// ─── State ───────────────────────────────────────────────────────────────────
let settings       = null;
let tabStatus      = null;
let isRestricted   = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showFeedback(msg, isError = false) {
  feedbackText.textContent = msg;
  feedback.hidden  = false;
  feedback.classList.toggle('is-error', isError);
  clearTimeout(feedback._timer);
  feedback._timer = setTimeout(() => { feedback.hidden = true; }, 4000);
}

function sensitivityLabel(s) {
  return { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive' }[s] ?? s;
}

function truncateDomain(d, max = 14) {
  if (!d || d === '—') return d;
  return d.length > max ? d.slice(0, max - 1) + '…' : d;
}

// ─── UI Render ───────────────────────────────────────────────────────────────

function renderStatus() {
  const on       = settings?.enabled;
  const allowed  = tabStatus?.isAllowlisted;
  const preview  = settings?.previewOnly;

  masterToggle.classList.toggle('is-on', !!on);
  masterToggle.setAttribute('aria-checked', on ? 'true' : 'false');

  removedCountEl.textContent = tabStatus?.removedCount ?? 0;
  modeLabelEl.textContent    = sensitivityLabel(settings?.sensitivity ?? '—');

  const domain = tabStatus?.domain ?? '—';
  domainLabelEl.textContent  = truncateDomain(domain);
  domainLabelEl.title        = domain;

  allowlistedNotice.hidden   = !allowed;
  restrictedNotice.hidden    = !isRestricted;

  const undoAvail = !!(tabStatus?.undoAvailable) && on && !isRestricted;
  btnUndo.disabled           = !undoAvail;
  btnScan.disabled           = !on || isRestricted;
  btnAllowlist.disabled      = isRestricted;

  if (allowed) {
    allowlistBtnLabel.textContent = 'Remove from Allowlist';
  } else {
    allowlistBtnLabel.textContent = 'Allowlist This Site';
  }

  if (isRestricted) {
    statusDot.className  = 'status-dot off';
    statusText.textContent = 'Cannot run on this page type.';
  } else if (!on) {
    statusDot.className  = 'status-dot off';
    statusText.textContent = 'ClearView is disabled.';
  } else if (allowed) {
    statusDot.className  = 'status-dot warn';
    statusText.textContent = 'Site is allowlisted — monitoring paused.';
  } else if (preview) {
    statusDot.className  = 'status-dot warn';
    statusText.textContent = 'Preview mode — no changes applied.';
  } else {
    statusDot.className  = 'status-dot active';
    statusText.textContent = 'Active — monitoring for overlays.';
  }
}

// ─── Data Load ───────────────────────────────────────────────────────────────

async function loadData() {
  // Load settings from background
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, res => {
      settings = res?.settings ?? null;
      resolve();
    });
  });

  // Query active tab status via content script
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS' }, res => {
      if (res?.error?.includes('reachable') || res?.error?.includes('ready')) {
        // Content script not reachable — check if restricted page
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          const url = tab?.url ?? '';
          if (url.startsWith('chrome://') || url.startsWith('edge://') ||
              url.startsWith('brave://') || url.startsWith('about:') ||
              url.startsWith('chrome-extension://')) {
            isRestricted = true;
          }
          resolve();
        });
      } else {
        tabStatus = res;
        resolve();
      }
    });
  });

  renderStatus();
}

// ─── Events ──────────────────────────────────────────────────────────────────

// Master toggle
masterToggle.addEventListener('click', async () => {
  if (!settings) return;
  settings.enabled = !settings.enabled;
  await new Promise(r => chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, r));
  showFeedback(settings.enabled ? 'ClearView enabled.' : 'ClearView disabled.');
  renderStatus();
});

masterToggle.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); masterToggle.click(); }
});

// Scan button
btnScan.addEventListener('click', async () => {
  btnScan.disabled = true;
  btnScan.textContent = 'Scanning…';
  try {
    await new Promise(r => chrome.runtime.sendMessage({ type: 'SCAN_ACTIVE_TAB' }, r));
    // Refresh status
    await new Promise(r => {
      chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS' }, res => {
        tabStatus = res;
        r();
      });
    });
    const count = tabStatus?.removedCount ?? 0;
    showFeedback(count > 0 ? `Scan complete. ${count} element(s) handled.` : 'Scan complete. No intrusive overlays found.');
    renderStatus();
  } catch (err) {
    showFeedback('Scan failed: ' + (err.message ?? 'unknown error'), true);
  } finally {
    btnScan.disabled = false;
    btnScan.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
      <line x1="11" y1="11" x2="15" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg> Scan This Page`;
  }
});

// Undo button
btnUndo.addEventListener('click', async () => {
  btnUndo.disabled = true;
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: 'UNDO_ACTIVE_TAB' }, r));
  if (res?.restored > 0) {
    tabStatus = { ...(tabStatus ?? {}), removedCount: Math.max(0, (tabStatus?.removedCount ?? 0) - res.restored) };
    showFeedback(`Restored ${res.restored} element(s).`);
  } else {
    showFeedback('Nothing to undo.', true);
  }
  // Refresh status
  await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS' }, res2 => {
    tabStatus = res2;
    r();
  }));
  renderStatus();
});

// Allowlist button
btnAllowlist.addEventListener('click', async () => {
  if (!settings || !tabStatus?.domain) return;
  const domain   = tabStatus.domain;
  const list     = settings.allowlist ?? [];
  const idx      = list.findIndex(d => d.replace(/^www\./, '') === domain);

  if (idx >= 0) {
    settings.allowlist = list.filter((_, i) => i !== idx);
    showFeedback(`"${domain}" removed from allowlist.`);
  } else {
    settings.allowlist = [...list, domain];
    showFeedback(`"${domain}" added to allowlist. ClearView paused here.`);
  }

  await new Promise(r => chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, r));
  tabStatus = { ...(tabStatus ?? {}), isAllowlisted: idx < 0 };
  renderStatus();
});

// Options button
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Diagnostics footer link
footerDiag.addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  // Options page opens to diagnostics tab
  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url?.includes('options.html')) {
        chrome.tabs.sendMessage(tab.id ?? 0, { type: 'OPEN_TAB', tab: 'diagnostics' }).catch(() => {});
      }
    });
  }, 400);
});

// ─── Init ────────────────────────────────────────────────────────────────────
loadData();

