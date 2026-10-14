/**
 * ClearView — rules/detection.js
 * Multi-signal detection engine.
 * Evaluates DOM elements for likelihood of being an intrusive overlay.
 */

'use strict';

// ─── Text Signal Patterns ─────────────────────────────────────────────────────

export const ADBLOCK_PATTERNS = [
  /ad[\s_-]?block(?:er)?[\s_-]?(?:detected?|found|enabled?|active)/i,
  /detect(?:ed|ing)?[\s_-]?ad[\s_-]?block/i,
  /disabl(?:e|ing)[\s_-]?(?:your[\s_-]?)?ad[\s_-]?block(?:er)?/i,
  /turn[\s_-]?off[\s_-]?(?:your[\s_-]?)?ad[\s_-]?block(?:er)?/i,
  /please[\s_-]?(?:disable|turn[\s_-]?off|deactivate)[\s_-]?(?:your[\s_-]?)?(?:ad[\s_-]?block(?:er)?|extension)/i,
  /whitelist[\s_-]?(?:this[\s_-]?)?(?:site|website|page|domain)/i,
  /support[\s_-]?us[\s_-]?by[\s_-]?disabl/i,
  /anti[\s_-]?ad[\s_-]?block/i,
  /advertising[\s_-]?block(?:er)?/i,
  /we[\s_-]?(?:noticed?|detected?|see|found)[\s_-](?:you[\s_-](?:are[\s_-])?using|that[\s_-]you[\s_-]have)[\s_-]?(?:an[\s_-]?)?ad[\s_-]?block/i,
  /your[\s_-]ad[\s_-]?block(?:er)?[\s_-]is[\s_-](?:on|active|enabled|blocking)/i,
  /disabl(?:e|ing)[\s_-](?:your[\s_-])?extension(?:s)?[\s_-]to[\s_-]continue/i,
  /turn[\s_-]off[\s_-](?:your[\s_-])?blocker/i,
  /(?:looks?[\s_-]?like|it[\s_-]?appears?)[\s_-]you[\s_-](?:have|'re[\s_-]using)[\s_-](?:an[\s_-]?)?ad[\s_-]?block/i,
  /please[\s_-]allow[\s_-]ads?/i,
  /revenue[\s_-]from[\s_-]ads?/i,
  /ads?[\s_-](?:help|support|keep|fund)/i,
  /paywalled?[\s_-]content[\s_-]without[\s_-]ads/i
];

export const NEWSLETTER_PATTERNS = [
  /subscribe[\s_-](?:to[\s_-])?(?:our[\s_-])?newsletter/i,
  /sign[\s_-]up[\s_-]for[\s_-](?:our[\s_-])?(?:newsletter|updates|emails?)/i,
  /get[\s_-](?:our[\s_-])?(?:latest[\s_-])?(?:news|updates|articles?)[\s_-](?:delivered|sent)?/i,
  /join[\s_-](?:our[\s_-])?(?:mailing[\s_-]list|community|newsletter)/i,
  /enter[\s_-]your[\s_-]email[\s_-](?:to[\s_-])?(?:subscribe|get|receive)/i
];

export const PROMOTIONAL_PATTERNS = [
  /(?:limited[\s_-]time|exclusive|special)[\s_-]offer/i,
  /(?:\d+%?[\s_-]?off|save[\s_-]\$?\d+)/i,
  /(?:free[\s_-]trial|try[\s_-](?:for[\s_-])?free)/i,
  /(?:flash[\s_-]sale|today[\s_-]only)/i
];

// Strong EXCLUSION signals — elements matching these are never auto-removed
export const EXCLUSION_PATTERNS = [
  /(?:log[\s_-]?in|sign[\s_-]?in|login|signin)/i,
  /(?:create[\s_-]?account|register|sign[\s_-]?up)/i,
  /(?:password|forgot[\s_-]?password)/i,
  /(?:payment|checkout|billing|credit[\s_-]?card|paypal)/i,
  /(?:age[\s_-]?verification|are[\s_-]you[\s_-](?:18|21|over))/i,
  /(?:cookie[\s_-]?(?:policy|consent|notice|settings?)|gdpr|ccpa)/i,
  /(?:privacy[\s_-]?(?:policy|notice|settings?))/i,
  /(?:terms[\s_-]?(?:of[\s_-]?(?:service|use)|and[\s_-]conditions))/i,
  /(?:two[\s_-]?factor|2fa|security[\s_-]?(?:code|check|verification))/i,
  /(?:captcha|robot[\s_-]?check|verify[\s_-]you're[\s_-]human)/i,
  /(?:loading|please[\s_-]wait)/i
];

// Inline-content context signals — high text → likely article discussion, not modal
export const INLINE_CONTEXT_PATTERNS = [
  /how[\s_-]to[\s_-](?:use|install|setup)[\s_-](?:an[\s_-]?)?ad[\s_-]?block/i,
  /best[\s_-]ad[\s_-]?block(?:er)?s?/i,
  /review(?:ing)?[\s_-](?:ad[\s_-]?block|ublock)/i
];

// ─── Structural Heuristics ────────────────────────────────────────────────────

/**
 * Returns the viewport coverage ratio of an element (0-1).
 */
export function getViewportCoverage(el) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth  || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (vw === 0 || vh === 0) return 0;
  const overlapW = Math.max(0, Math.min(rect.right, vw)  - Math.max(rect.left, 0));
  const overlapH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  return (overlapW * overlapH) / (vw * vh);
}

/**
 * Returns computed style for element (memoised within single scan pass via WeakMap).
 */
const styleCache = new WeakMap();
export function getStyle(el) {
  if (!styleCache.has(el)) styleCache.set(el, window.getComputedStyle(el));
  return styleCache.get(el);
}

export function clearStyleCache() { styleCache.clear?.(); }

/**
 * Checks if element has fixed/absolute/sticky positioning.
 */
export function isPositionedOverlay(el) {
  const pos = getStyle(el).position;
  return pos === 'fixed' || pos === 'absolute' || pos === 'sticky';
}

/**
 * Returns z-index as integer, or 0.
 */
export function getZIndex(el) {
  const z = parseInt(getStyle(el).zIndex, 10);
  return isNaN(z) ? 0 : z;
}

/**
 * Returns true if element is visible (not hidden, not zero opacity, not display:none).
 */
export function isVisible(el) {
  const st = getStyle(el);
  return (
    st.display !== 'none' &&
    st.visibility !== 'hidden' &&
    parseFloat(st.opacity) > 0.01
  );
}

/**
 * Returns true if the element appears to block pointer interaction on the whole viewport.
 */
export function blocksPointerEvents(el) {
  const st = getStyle(el);
  if (st.pointerEvents === 'none') return false;
  const coverage = getViewportCoverage(el);
  return coverage > 0.3;
}

/**
 * Checks for ARIA dialog role.
 */
export function isAriaDialog(el) {
  const role = el.getAttribute('role')?.toLowerCase();
  return role === 'dialog' || role === 'alertdialog' ||
    el.getAttribute('aria-modal') === 'true';
}

/**
 * Detects body/html scroll lock caused by an overlay.
 */
export function detectScrollLock() {
  const bodyStyle = getComputedStyle(document.body);
  const htmlStyle = getComputedStyle(document.documentElement);
  const bodyOverflow  = bodyStyle.overflow  === 'hidden' || bodyStyle.overflowY === 'hidden';
  const htmlOverflow  = htmlStyle.overflow  === 'hidden' || htmlStyle.overflowY === 'hidden';
  const bodyFixed     = bodyStyle.position  === 'fixed';
  return bodyOverflow || htmlOverflow || bodyFixed;
}

/**
 * Returns inner text with whitespace normalization and Unicode NFKC normalization.
 */
export function normalizeText(el) {
  const raw = el.innerText ?? el.textContent ?? '';
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Detects if element is a background dimming overlay (semi-transparent full-screen).
 */
export function isBackdropLayer(el) {
  if (!isPositionedOverlay(el)) return false;
  const st    = getStyle(el);
  const bg    = st.backgroundColor;
  const cover = getViewportCoverage(el);
  if (cover < 0.5) return false;
  // rgba with low alpha = dimming layer
  const alphaMatch = bg.match(/rgba?\([\d\s,]+,\s*([\d.]+)\)/);
  const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
  const children = el.querySelectorAll('*').length;
  // Backdrop = large coverage, semi-transparent OR mostly empty element
  return alpha < 0.95 || children < 3;
}

/**
 * Looks for a close button inside an element.
 */
export function hasCloseButton(el) {
  const closeSelectors = [
    '[aria-label*="close" i]', '[aria-label*="dismiss" i]',
    '[title*="close" i]',      '[title*="dismiss" i]',
    '.close', '.dismiss', '.modal-close', '.btn-close',
    'button[class*="close" i]', 'button[class*="dismiss" i]',
    '[data-dismiss]', '[data-close]'
  ];
  return closeSelectors.some(sel => el.querySelector(sel) !== null);
}

/**
 * Determine if element is within an article body or long-form text container.
 */
export function isInsideArticle(el) {
  let cur = el.parentElement;
  while (cur && cur !== document.body) {
    const tag = cur.tagName?.toLowerCase();
    if (tag === 'article' || tag === 'main') return true;
    if (cur.getAttribute('role') === 'main') return true;
    const cls = (cur.className || '').toLowerCase();
    if (/\b(article|post|content|story|body|prose)\b/.test(cls)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Returns true if element appears to be a media player.
 */
export function isMediaPlayer(el) {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'video' || tag === 'audio') return true;
  const cls = (el.className || '').toLowerCase() + ' ' + (el.id || '').toLowerCase();
  return /\b(player|video[\s_-]?js|plyr|jwplayer|brightcove|youtube|vimeo)\b/.test(cls);
}

/**
 * Checks if element is a navigation element.
 */
export function isNavigation(el) {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'nav' || tag === 'header' || tag === 'footer') return true;
  const role = el.getAttribute('role')?.toLowerCase();
  if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return true;
  return false;
}

/**
 * Checks if element is an application root.
 */
export function isAppRoot(el) {
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toLowerCase();
  return /\b(app|root|__next|nuxt|react-root|vue-app|angular-app)\b/.test(id + ' ' + cls);
}

/**
 * Returns text-to-element ratio for an element (high ratio = article text, not modal).
 */
export function getTextDensity(el) {
  const text = normalizeText(el);
  const nodeCount = el.querySelectorAll('*').length + 1;
  return text.length / nodeCount;
}

