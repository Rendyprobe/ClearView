/**
 * ClearView — rules/scoring.js
 * Confidence scoring model.
 * Returns a score (0–100) and an explanation array for each candidate element.
 */

'use strict';

import {
  ADBLOCK_PATTERNS,
  NEWSLETTER_PATTERNS,
  PROMOTIONAL_PATTERNS,
  EXCLUSION_PATTERNS,
  INLINE_CONTEXT_PATTERNS,
  getViewportCoverage,
  getZIndex,
  isPositionedOverlay,
  isVisible,
  isAriaDialog,
  detectScrollLock,
  normalizeText,
  isBackdropLayer,
  hasCloseButton,
  isInsideArticle,
  isMediaPlayer,
  isNavigation,
  isAppRoot,
  getTextDensity,
  blocksPointerEvents
} from './detection.js';

// ─── Sensitivity Thresholds ───────────────────────────────────────────────────

export const THRESHOLDS = {
  conservative: { autoRemove: 80, preview: 60 },
  balanced:     { autoRemove: 65, preview: 45 },
  aggressive:   { autoRemove: 50, preview: 35 }
};

// ─── Signal Weights ───────────────────────────────────────────────────────────

const WEIGHTS = {
  // Positive signals (push score UP)
  ADBLOCK_TEXT_STRONG:    40,   // explicit anti-adblock wording
  ADBLOCK_TEXT_MODERATE:  25,   // softer adblock phrasing
  NEWSLETTER_TEXT:        20,   // newsletter subscription
  PROMO_TEXT:             15,   // promotional offer
  VIEWPORT_FULL:          20,   // covers >80% viewport
  VIEWPORT_LARGE:         12,   // covers >50% viewport
  POSITION_FIXED:         10,   // position: fixed
  HIGH_Z_INDEX:           8,    // z-index > 1000
  VERY_HIGH_Z_INDEX:      12,   // z-index > 9999
  SCROLL_LOCK:            10,   // body scroll is locked
  ARIA_DIALOG:            8,    // role="dialog" or aria-modal
  HAS_CLOSE_BUTTON:       6,    // contains a close button
  BACKDROP_LAYER:         18,   // semi-transparent dimming overlay
  POINTER_BLOCKING:       8,    // covers viewport and intercepts clicks
  BODY_CHILD:             5,    // direct child of body (common for modals)

  // Negative signals (push score DOWN)
  EXCLUSION_TEXT:         -60,  // login/payment/cookie wording
  INLINE_CONTEXT:         -20,  // article discussing adblock
  IS_INSIDE_ARTICLE:      -15,  // inside <article> or <main>
  IS_MEDIA_PLAYER:        -30,  // is or contains video player
  IS_NAVIGATION:          -25,  // nav/header/footer
  IS_APP_ROOT:            -50,  // application container
  HIGH_TEXT_DENSITY:      -15,  // long-form text = article, not modal
  LOW_VIEWPORT_COVERAGE:  -10,  // covers <10% viewport
  VISIBLE_SCROLL:         -8    // page scrollbar visible = content accessible
};

// ─── Scorer ───────────────────────────────────────────────────────────────────

/**
 * Score a single element. Returns { score, signals, category }.
 * @param {Element} el - DOM element to evaluate
 * @param {Object}  settings - user settings
 * @returns {{ score: number, signals: string[], category: string }}
 */
export function scoreElement(el, settings = {}) {
  if (!el || !isVisible(el)) {
    return { score: 0, signals: ['Element not visible'], category: 'none' };
  }

  const signals  = [];
  let   score    = 0;
  const text     = normalizeText(el);
  const coverage = getViewportCoverage(el);
  const zIndex   = getZIndex(el);

  // ── Exclusion checks (bail early) ────────────────────────────────────────

  if (isAppRoot(el)) {
    return { score: 0, signals: ['Application root — excluded'], category: 'excluded' };
  }

  if (isNavigation(el)) {
    return { score: 0, signals: ['Navigation element — excluded'], category: 'excluded' };
  }

  if (isMediaPlayer(el)) {
    return { score: 0, signals: ['Media player — excluded'], category: 'excluded' };
  }

  // Check user exclusion keywords
  const userExclusions = settings.exclusionKeywords ?? [];
  const allExclusions  = [...EXCLUSION_PATTERNS];
  const textLower      = text.toLowerCase();

  for (const kw of userExclusions) {
    if (textLower.includes(kw.toLowerCase())) {
      return { score: 0, signals: [`User exclusion keyword matched: "${kw}"`], category: 'excluded' };
    }
  }

  // Check built-in exclusion patterns
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(text)) {
      score += WEIGHTS.EXCLUSION_TEXT;
      signals.push(`Exclusion pattern matched: ${pattern.source.slice(0, 50)}`);
      // Hard exclusion — do not proceed
      if (score <= -50) {
        return { score: Math.max(score, 0), signals, category: 'excluded' };
      }
    }
  }

  // ── Inline context (article discussing adblock) ───────────────────────────

  for (const pattern of INLINE_CONTEXT_PATTERNS) {
    if (pattern.test(text)) {
      score += WEIGHTS.INLINE_CONTEXT;
      signals.push('Inline discussion context (article text)');
    }
  }

  if (isInsideArticle(el)) {
    score += WEIGHTS.IS_INSIDE_ARTICLE;
    signals.push('Element is inside article/main content');
  }

  const textDensity = getTextDensity(el);
  if (textDensity > 200) {
    score += WEIGHTS.HIGH_TEXT_DENSITY;
    signals.push(`High text density (${Math.round(textDensity)} chars/node) — likely article`);
  }

  // ── Positive text signals ─────────────────────────────────────────────────

  let adblockMatchCount = 0;
  for (const pattern of ADBLOCK_PATTERNS) {
    if (pattern.test(text)) {
      adblockMatchCount++;
    }
  }

  if (adblockMatchCount >= 2) {
    score += WEIGHTS.ADBLOCK_TEXT_STRONG;
    signals.push(`Strong anti-adblock text (${adblockMatchCount} patterns matched)`);
  } else if (adblockMatchCount === 1) {
    // Single match in a short text = modal; single match in a long text = article
    if (text.length < 500) {
      score += WEIGHTS.ADBLOCK_TEXT_STRONG;
      signals.push('Anti-adblock text detected in short element');
    } else {
      score += WEIGHTS.ADBLOCK_TEXT_MODERATE;
      signals.push('Anti-adblock text detected (long text element)');
    }
  }

  // Check custom user patterns
  for (const pattern of (settings.customPatterns ?? [])) {
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(text)) {
        score += WEIGHTS.ADBLOCK_TEXT_MODERATE;
        signals.push(`Custom pattern matched: "${pattern}"`);
      }
    } catch { /* ignore invalid regex */ }
  }

  for (const pattern of NEWSLETTER_PATTERNS) {
    if (pattern.test(text)) {
      score += WEIGHTS.NEWSLETTER_TEXT;
      signals.push('Newsletter subscription text');
      break;
    }
  }

  for (const pattern of PROMOTIONAL_PATTERNS) {
    if (pattern.test(text)) {
      score += WEIGHTS.PROMO_TEXT;
      signals.push('Promotional offer text');
      break;
    }
  }

  // ── Structural signals ────────────────────────────────────────────────────

  if (isPositionedOverlay(el)) {
    score += WEIGHTS.POSITION_FIXED;
    signals.push(`Positioned overlay (${getComputedStyle(el).position})`);
  }

  if (zIndex > 9999) {
    score += WEIGHTS.VERY_HIGH_Z_INDEX;
    signals.push(`Very high z-index: ${zIndex}`);
  } else if (zIndex > 1000) {
    score += WEIGHTS.HIGH_Z_INDEX;
    signals.push(`High z-index: ${zIndex}`);
  }

  if (coverage > 0.8) {
    score += WEIGHTS.VIEWPORT_FULL;
    signals.push(`Full viewport coverage: ${Math.round(coverage * 100)}%`);
  } else if (coverage > 0.5) {
    score += WEIGHTS.VIEWPORT_LARGE;
    signals.push(`Large viewport coverage: ${Math.round(coverage * 100)}%`);
  } else if (coverage < 0.1 && coverage > 0) {
    score += WEIGHTS.LOW_VIEWPORT_COVERAGE;
    signals.push(`Small viewport coverage: ${Math.round(coverage * 100)}%`);
  }

  if (isAriaDialog(el)) {
    score += WEIGHTS.ARIA_DIALOG;
    signals.push('ARIA dialog role detected');
  }

  if (hasCloseButton(el)) {
    score += WEIGHTS.HAS_CLOSE_BUTTON;
    signals.push('Contains close/dismiss button');
  }

  if (isBackdropLayer(el)) {
    score += WEIGHTS.BACKDROP_LAYER;
    signals.push('Semi-transparent backdrop layer');
  }

  if (blocksPointerEvents(el)) {
    score += WEIGHTS.POINTER_BLOCKING;
    signals.push('Blocks pointer interaction across viewport');
  }

  if (detectScrollLock()) {
    score += WEIGHTS.SCROLL_LOCK;
    signals.push('Body scroll lock detected');
  }

  // Direct child of body is a strong structural signal for modals
  if (el.parentElement === document.body) {
    score += WEIGHTS.BODY_CHILD;
    signals.push('Direct child of <body>');
  }

  // Visible scrollbar → content is accessible below, slightly reduces confidence
  const bodyHasScroll = document.body.scrollHeight > window.innerHeight * 1.1;
  if (bodyHasScroll && !detectScrollLock()) {
    score += WEIGHTS.VISIBLE_SCROLL;
    signals.push('Page content accessible below (scroll present)');
  }

  // ── Categorise ────────────────────────────────────────────────────────────

  let category = 'unknown';
  if (score <= 0) {
    category = 'safe';
  } else if (adblockMatchCount > 0) {
    category = 'anti-adblock';
  } else if (NEWSLETTER_PATTERNS.some(p => p.test(text))) {
    category = 'newsletter';
  } else if (PROMOTIONAL_PATTERNS.some(p => p.test(text))) {
    category = 'promotional';
  } else if (isBackdropLayer(el)) {
    category = 'backdrop';
  } else {
    category = 'overlay';
  }

  return {
    score:   Math.max(0, Math.min(100, score)),
    signals,
    category
  };
}

/**
 * Returns candidates from the document that exceed the preview threshold.
 * @param {Object} settings
 * @returns {Array<{ el: Element, score: number, signals: string[], category: string }>}
 */
export function scanDocument(settings) {
  const sensitivity  = settings.sensitivity ?? 'balanced';
  const threshold    = THRESHOLDS[sensitivity]?.preview ?? THRESHOLDS.balanced.preview;
  const candidates   = [];

  // Efficient candidate set: positioned elements + ARIA dialogs + body children
  const selector = [
    '[style*="position:fixed"]',
    '[style*="position: fixed"]',
    '[style*="position:absolute"]',
    '[style*="position: absolute"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    'div[class*="modal" i]',
    'div[class*="overlay" i]',
    'div[class*="popup" i]',
    'div[class*="backdrop" i]',
    'div[class*="adblock" i]',
    'div[class*="ad-block" i]',
    'div[id*="modal" i]',
    'div[id*="overlay" i]',
    'div[id*="popup" i]',
    'div[id*="adblock" i]'
  ].join(',');

  const seen = new Set();

  function evaluate(el) {
    if (seen.has(el)) return;
    seen.add(el);

    // Skip extension own UI, inputs, scripts, styles
    const tag = el.tagName?.toLowerCase();
    if (!tag || ['script','style','link','meta','input','textarea','select'].includes(tag)) return;
    if (!isVisible(el)) return;

    const result = scoreElement(el, settings);
    if (result.score >= threshold) {
      candidates.push({ el, ...result });
    }
  }

  // Query structural candidates
  try {
    document.querySelectorAll(selector).forEach(evaluate);
  } catch {}

  // Also walk computed-style fixed/absolute elements (catches inline style variants)
  const allDivs = document.querySelectorAll('body > *, body > * > *');
  allDivs.forEach(el => {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'absolute') evaluate(el);
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // De-duplicate: if a parent and child both scored, prefer the outermost element
  const deduped = [];
  for (const cand of candidates) {
    const dominated = deduped.some(existing => existing.el.contains(cand.el));
    if (!dominated) deduped.push(cand);
  }

  return deduped;
}

