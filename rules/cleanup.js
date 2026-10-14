/**
 * ClearView — rules/cleanup.js
 * Safe, reversible cleanup engine.
 * Hides or removes high-confidence intrusive elements and manages undo.
 */

'use strict';

import { detectScrollLock, isBackdropLayer, isVisible } from './detection.js';
import { THRESHOLDS } from './scoring.js';

// ─── Undo Stack ───────────────────────────────────────────────────────────────

/** @type {Array<CleanupRecord>} */
const undoStack = [];
const MAX_UNDO  = 10;

/**
 * @typedef {Object} CleanupRecord
 * @property {Element[]}    elements        - Affected elements
 * @property {string[]}     originalDisplay - Saved display values
 * @property {boolean}      scrollRestored  - Whether scroll was unlocked
 * @property {string}       bodyOverflow    - Saved body overflow
 * @property {string}       htmlOverflow    - Saved html overflow
 * @property {string}       bodyPosition    - Saved body position
 * @property {number}       timestamp
 * @property {string}       reason
 */

// ─── Scroll Management ────────────────────────────────────────────────────────

let savedBodyOverflow  = '';
let savedHtmlOverflow  = '';
let savedBodyPosition  = '';
let scrollWasRestored  = false;

function saveScrollState() {
  savedBodyOverflow = document.body.style.overflow;
  savedHtmlOverflow = document.documentElement.style.overflow;
  savedBodyPosition = document.body.style.position;
}

function restoreScroll() {
  document.body.style.overflow         = savedBodyOverflow || '';
  document.documentElement.style.overflow = savedHtmlOverflow || '';
  document.body.style.position         = savedBodyPosition  || '';
  document.body.style.top              = '';
  scrollWasRestored = true;
}

function unlockScroll() {
  // Only unlock if currently locked
  if (!detectScrollLock()) return false;
  saveScrollState();
  document.body.style.setProperty('overflow',  'auto',  'important');
  document.documentElement.style.setProperty('overflow', 'auto',  'important');
  document.body.style.setProperty('position',  '',      'important');
  scrollWasRestored = true;
  return true;
}

// ─── Backdrop Detection ───────────────────────────────────────────────────────

/**
 * Finds backdrop/overlay elements that are likely associated with a given modal.
 * @param {Element} modal
 * @returns {Element[]}
 */
function findAssociatedBackdrops(modal) {
  const backdrops = [];
  const siblings  = modal.parentElement?.children ?? [];

  for (const sibling of siblings) {
    if (sibling === modal) continue;
    if (isBackdropLayer(sibling) && isVisible(sibling)) {
      backdrops.push(sibling);
    }
  }

  // Also check direct body children
  for (const child of document.body.children) {
    if (child === modal || backdrops.includes(child)) continue;
    if (isBackdropLayer(child) && isVisible(child)) {
      backdrops.push(child);
    }
  }

  return backdrops;
}

// ─── Cleanup Actions ──────────────────────────────────────────────────────────

/**
 * Hides a single element by setting display:none (recoverable).
 * @param {Element} el
 * @returns {{ el: Element, prevDisplay: string }}
 */
function hideElement(el) {
  const prevDisplay = el.style.display;
  el.style.setProperty('display', 'none', 'important');
  el.dataset.clearviewHidden = '1';
  return { el, prevDisplay };
}

/**
 * Restores a previously hidden element.
 * @param {Element} el
 * @param {string}  prevDisplay
 */
function showElement(el, prevDisplay) {
  el.style.display = prevDisplay;
  delete el.dataset.clearviewHidden;
}

// ─── Main Cleanup Function ────────────────────────────────────────────────────

/**
 * Cleans up a list of scored candidates.
 * @param {Array<{el: Element, score: number, signals: string[], category: string}>} candidates
 * @param {Object} settings
 * @param {boolean} [force=false]  - Ignore threshold and clean all
 * @returns {{ removed: number, elements: string[], scrollRestored: boolean, undoAvailable: boolean }}
 */
export function performCleanup(candidates, settings, force = false) {
  const sensitivity = settings.sensitivity ?? 'balanced';
  const threshold   = THRESHOLDS[sensitivity]?.autoRemove ?? THRESHOLDS.balanced.autoRemove;

  const toClean = force
    ? candidates
    : candidates.filter(c => c.score >= threshold);

  if (toClean.length === 0) {
    return { removed: 0, elements: [], scrollRestored: false, undoAvailable: false };
  }

  const record = {
    elements:       [],
    originalDisplay:[],
    scrollRestored: false,
    bodyOverflow:   savedBodyOverflow,
    htmlOverflow:   savedHtmlOverflow,
    bodyPosition:   savedBodyPosition,
    timestamp:      Date.now(),
    reason:         toClean.map(c => c.category).join(', ')
  };

  const elementSummaries = [];

  for (const candidate of toClean) {
    const { el, signals, category } = candidate;

    // Safety: never clean elements that are already hidden
    if (!isVisible(el)) continue;

    // Find associated backdrops first
    const backdrops = findAssociatedBackdrops(el);

    // Hide the main element
    const { prevDisplay } = hideElement(el);
    record.elements.push(el);
    record.originalDisplay.push(prevDisplay);

    const summary = el.tagName.toLowerCase() +
      (el.id ? `#${el.id}` : '') +
      (el.className ? `.${String(el.className).split(' ')[0]}` : '');
    elementSummaries.push(`${summary} [${category}] score:${candidate.score}`);

    // Hide associated backdrops
    for (const backdrop of backdrops) {
      if (!isVisible(backdrop)) continue;
      const { prevDisplay: bd } = hideElement(backdrop);
      record.elements.push(backdrop);
      record.originalDisplay.push(bd);
      elementSummaries.push(`  ↳ backdrop: ${backdrop.tagName.toLowerCase()}`);
    }
  }

  // Attempt scroll restoration
  const scrolled = unlockScroll();
  record.scrollRestored = scrolled;

  // Push to undo stack
  if (record.elements.length > 0) {
    undoStack.unshift(record);
    if (undoStack.length > MAX_UNDO) undoStack.pop();
  }

  return {
    removed:       record.elements.length,
    elements:      elementSummaries,
    scrollRestored: scrolled,
    undoAvailable: undoStack.length > 0
  };
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

/**
 * Undoes the most recent cleanup operation.
 * @returns {{ restored: number, scrollRestored: boolean } | null}
 */
export function undoLastCleanup() {
  const record = undoStack.shift();
  if (!record) return null;

  let restored = 0;
  for (let i = 0; i < record.elements.length; i++) {
    const el = record.elements[i];
    if (el && el.isConnected) {
      showElement(el, record.originalDisplay[i]);
      restored++;
    }
  }

  let scrollRestored = false;
  if (record.scrollRestored) {
    document.body.style.overflow            = record.bodyOverflow || '';
    document.documentElement.style.overflow = record.htmlOverflow || '';
    document.body.style.position            = record.bodyPosition  || '';
    scrollRestored = true;
  }

  return { restored, scrollRestored };
}

/**
 * @returns {boolean}
 */
export function canUndo() {
  return undoStack.length > 0;
}

/**
 * @returns {number}
 */
export function undoStackSize() {
  return undoStack.length;
}

// ─── Preview Mode ─────────────────────────────────────────────────────────────

const HIGHLIGHT_CLASS = 'clearview-highlight';

/**
 * Highlights elements in preview mode without removing them.
 * @param {Element[]} elements
 */
export function highlightElements(elements) {
  removeHighlights();
  if (!document.getElementById('clearview-highlight-style')) {
    const style = document.createElement('style');
    style.id    = 'clearview-highlight-style';
    style.textContent = `
      .clearview-highlight {
        outline: 3px solid #00BCD4 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(0,188,212,0.25) !important;
        position: relative !important;
      }
      .clearview-highlight::after {
        content: "ClearView: Detected Overlay" !important;
        position: absolute !important;
        top: 4px !important;
        right: 4px !important;
        background: #00BCD4 !important;
        color: #000 !important;
        font-size: 11px !important;
        font-family: monospace !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }
  for (const el of elements) {
    el.classList.add(HIGHLIGHT_CLASS);
    el.dataset.clearviewPreview = '1';
  }
}

/**
 * Removes all preview highlights.
 */
export function removeHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS);
    delete el.dataset.clearviewPreview;
  });
}

// ─── Reinsertion Guard ────────────────────────────────────────────────────────

/** Track elements that were removed to prevent re-adding them. */
const reinsertionGuard = new WeakSet();

/**
 * Marks elements so the MutationObserver can ignore their reinsertion.
 * @param {Element[]} elements
 */
export function markForGuard(elements) {
  for (const el of elements) reinsertionGuard.add(el);
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isGuarded(el) {
  return reinsertionGuard.has(el);
}

// ─── Cleanup Report ───────────────────────────────────────────────────────────

/**
 * Returns a summary report of recent cleanup operations.
 * @returns {Array<Object>}
 */
export function getCleanupReport() {
  return undoStack.map((record, index) => ({
    index,
    timestamp:      record.timestamp,
    elementsCount:  record.elements.length,
    scrollRestored: record.scrollRestored,
    reason:         record.reason,
    canUndo:        index === 0
  }));
}

