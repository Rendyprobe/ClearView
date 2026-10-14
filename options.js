/**
 * ClearView — options.js
 * Options page controller.
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  enabled: true,
  sensitivity: 'balanced',
  autoCleanup: true,
  previewOnly: false,
  mutationObserver: true,
  allowlist: [],
  blocklist: [],
  customPatterns: [],
  exclusionKeywords: [
    'login', 'sign in', 'password', 'payment', 'checkout',
    'age verification', 'cookie', 'privacy policy', 'gdpr',
    'terms of service', 'captcha', 'security check'
  ],
  language: 'en',
  maxLogEntries: 200,
  undoHistorySize: 10,
  blockPopups: true
};

let settings = { ...DEFAULT_SETTINGS };
let dirty    = false;

// ─── DOM Refs ────────────────────────────────────────────────────────────────

const saveBar          = document.getElementById('saveBar');
const btnSave          = document.getElementById('btnSave');
const btnReset         = document.getElementById('btnReset');
const btnExport        = document.getElementById('btnExport');
const importFile       = document.getElementById('importFile');

const toggleEnabled        = document.getElementById('toggleEnabled');
const toggleAutoCleanup    = document.getElementById('toggleAutoCleanup');
const togglePreviewOnly    = document.getElementById('togglePreviewOnly');
const toggleMutationObserver = document.getElementById('toggleMutationObserver');
const toggleBlockPopups    = document.getElementById('toggleBlockPopups');
const sensitivityRadios    = document.querySelectorAll('input[name="sensitivity"]');
const undoHistorySize      = document.getElementById('undoHistorySize');
const maxLogEntries        = document.getElementById('maxLogEntries');
const langSelect           = document.getElementById('langSelect');

const exclusionInput       = document.getElementById('exclusionInput');
const btnAddExclusion      = document.getElementById('btnAddExclusion');
const exclusionTags        = document.getElementById('exclusionTags');

const allowlistInput       = document.getElementById('allowlistInput');
const btnAddAllowlist      = document.getElementById('btnAddAllowlist');
const allowlistTags        = document.getElementById('allowlistTags');

const blocklistInput       = document.getElementById('blocklistInput');
const btnAddBlocklist      = document.getElementById('btnAddBlocklist');
const blocklistTags        = document.getElementById('blocklistTags');

const customPatternInput   = document.getElementById('customPatternInput');
const btnAddPattern        = document.getElementById('btnAddPattern');
const customPatternTags    = document.getElementById('customPatternTags');

const btnClearLog          = document.getElementById('btnClearLog');
const logContainer         = document.getElementById('logContainer');

// ─── Tab Navigation ───────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('tab-' + btn.dataset.tab);
    if (panel) panel.classList.add('active');
    if (btn.dataset.tab === 'diagnostics') loadLog();
  });
});

// ─── Dirty Tracking ───────────────────────────────────────────────────────────

function markDirty() {
  dirty = true;
  saveBar.hidden = false;
}

function markClean() {
  dirty = false;
  saveBar.hidden = true;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderSettings() {
  toggleEnabled.checked          = settings.enabled;
  toggleAutoCleanup.checked      = settings.autoCleanup;
  togglePreviewOnly.checked      = settings.previewOnly;
  toggleMutationObserver.checked = settings.mutationObserver;
  if (toggleBlockPopups) toggleBlockPopups.checked = settings.blockPopups ?? true;
  undoHistorySize.value          = settings.undoHistorySize;
  maxLogEntries.value            = settings.maxLogEntries;
  langSelect.value               = settings.language;

  sensitivityRadios.forEach(r => {
    r.checked = r.value === settings.sensitivity;
  });

  renderTags(exclusionTags,    settings.exclusionKeywords,  removeExclusionKw);
  renderTags(allowlistTags,    settings.allowlist,           removeAllowlistEntry);
  renderTags(blocklistTags,    settings.blocklist,           removeBlocklistEntry);
  renderTags(customPatternTags,settings.customPatterns,      removeCustomPattern);
}

// ─── Tag Rendering ────────────────────────────────────────────────────────────

function renderTags(container, items, onRemove) {
  container.innerHTML = '';
  if (!items?.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = 'None added.';
    container.appendChild(empty);
    return;
  }
  items.forEach((item, idx) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = item;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'tag-remove';
    removeBtn.title = 'Remove';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', () => onRemove(idx));
    tag.appendChild(removeBtn);
    container.appendChild(tag);
  });
}

// ─── Tag List Helpers ─────────────────────────────────────────────────────────

function addToList(key, value, container, onRemoveFn) {
  if (!value.trim()) return;
  const list = settings[key] ?? [];
  if (list.includes(value.trim())) return;
  settings[key] = [...list, value.trim()];
  renderTags(container, settings[key], onRemoveFn);
  markDirty();
}

function removeFromList(key, idx, container, onRemoveFn) {
  const list = settings[key] ?? [];
  settings[key] = list.filter((_, i) => i !== idx);
  renderTags(container, settings[key], onRemoveFn);
  markDirty();
}

const removeExclusionKw   = idx => removeFromList('exclusionKeywords', idx, exclusionTags,    removeExclusionKw);
const removeAllowlistEntry= idx => removeFromList('allowlist',         idx, allowlistTags,    removeAllowlistEntry);
const removeBlocklistEntry= idx => removeFromList('blocklist',         idx, blocklistTags,    removeBlocklistEntry);
const removeCustomPattern = idx => removeFromList('customPatterns',    idx, customPatternTags,removeCustomPattern);

// ─── Form Event Listeners ─────────────────────────────────────────────────────

toggleEnabled.addEventListener('change', () => { settings.enabled = toggleEnabled.checked; markDirty(); });
toggleAutoCleanup.addEventListener('change', () => { settings.autoCleanup = toggleAutoCleanup.checked; markDirty(); });
togglePreviewOnly.addEventListener('change', () => { settings.previewOnly = togglePreviewOnly.checked; markDirty(); });
toggleMutationObserver.addEventListener('change', () => { settings.mutationObserver = toggleMutationObserver.checked; markDirty(); });
if (toggleBlockPopups) {
  toggleBlockPopups.addEventListener('change', () => { settings.blockPopups = toggleBlockPopups.checked; markDirty(); });
}

sensitivityRadios.forEach(r => {
  r.addEventListener('change', () => { if (r.checked) { settings.sensitivity = r.value; markDirty(); } });
});

undoHistorySize.addEventListener('input', () => {
  const v = parseInt(undoHistorySize.value, 10);
  if (v >= 1 && v <= 20) { settings.undoHistorySize = v; markDirty(); }
});

maxLogEntries.addEventListener('input', () => {
  const v = parseInt(maxLogEntries.value, 10);
  if (v >= 10 && v <= 500) { settings.maxLogEntries = v; markDirty(); }
});

langSelect.addEventListener('change', () => { settings.language = langSelect.value; markDirty(); });

// Tag editors
btnAddExclusion.addEventListener('click', () => {
  addToList('exclusionKeywords', exclusionInput.value, exclusionTags, removeExclusionKw);
  exclusionInput.value = '';
});
exclusionInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddExclusion.click(); });

btnAddAllowlist.addEventListener('click', () => {
  const val = allowlistInput.value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  addToList('allowlist', val, allowlistTags, removeAllowlistEntry);
  allowlistInput.value = '';
});
allowlistInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddAllowlist.click(); });

btnAddBlocklist.addEventListener('click', () => {
  const val = blocklistInput.value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  addToList('blocklist', val, blocklistTags, removeBlocklistEntry);
  blocklistInput.value = '';
});
blocklistInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddBlocklist.click(); });

btnAddPattern.addEventListener('click', () => {
  const val = customPatternInput.value.trim();
  if (!val) return;
  // Validate regex
  try { new RegExp(val, 'i'); }
  catch { alert('Invalid regular expression: ' + val); return; }
  addToList('customPatterns', val, customPatternTags, removeCustomPattern);
  customPatternInput.value = '';
});
customPatternInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddPattern.click(); });

// ─── Save / Reset / Export / Import ──────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  markClean();
  showToast('Settings saved ✓');
});

btnReset.addEventListener('click', () => {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
  settings = { ...DEFAULT_SETTINGS };
  renderSettings();
  markDirty();
});

btnExport.addEventListener('click', async () => {
  const { log = [] } = await chrome.storage.local.get('log');
  const blob = new Blob([JSON.stringify({ settings, log }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'clearview-settings.json';
  a.click();
  URL.revokeObjectURL(url);
});

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed.settings) throw new Error('No settings key found in file.');
    settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    renderSettings();
    markDirty();
    showToast('Settings imported. Click Save to apply.');
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
  importFile.value = '';
});

// ─── Diagnostics Log ─────────────────────────────────────────────────────────

async function loadLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  logContainer.innerHTML = '';

  if (!log.length) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No log entries yet.';
    logContainer.appendChild(p);
    return;
  }

  for (const entry of log) {
    const div  = document.createElement('div');
    div.className = 'log-entry';

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.timestamp).toLocaleString();

    const type = document.createElement('span');
    type.className = 'log-type ' + (entry.type ?? 'info');
    type.textContent = entry.type ?? 'info';

    const detail = document.createElement('span');
    detail.className = 'log-detail';
    detail.textContent =
      (entry.domain ? `${entry.domain} — ` : '') +
      (entry.count != null ? `${entry.count} element(s)` : '') +
      (entry.sensitivity ? ` [${entry.sensitivity}]` : '');

    div.appendChild(time);
    div.appendChild(type);
    div.appendChild(detail);

    if (entry.signals?.length) {
      const sigs = document.createElement('span');
      sigs.className = 'log-signals';
      sigs.textContent = entry.signals.map(s =>
        `• [${s.category ?? '?'}] score:${s.score} — ${(s.signals ?? []).slice(0,3).join(', ')}`
      ).join('\n');
      div.appendChild(sigs);
    }

    logContainer.appendChild(div);
  }
}

btnClearLog.addEventListener('click', async () => {
  if (!confirm('Clear all diagnostic log entries?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_LOG' });
  loadLog();
});

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg) {
  let toast = document.getElementById('cv-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cv-toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;
      background:#00BCD4;color:#000;
      padding:9px 18px;border-radius:6px;
      font-size:13px;font-weight:700;
      z-index:9999;opacity:0;
      transition:opacity 0.25s;
      pointer-events:none;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ─── Listen for OPEN_TAB from popup ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'OPEN_TAB' && msg.tab) {
    const btn = document.querySelector(`.nav-item[data-tab="${msg.tab}"]`);
    if (btn) btn.click();
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const { settings: stored } = await chrome.storage.local.get('settings');
  if (stored) settings = { ...DEFAULT_SETTINGS, ...stored };
  renderSettings();
  markClean();
}

init();

