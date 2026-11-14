/**
 * ClearView — content.js
 * Main content script. Runs in every page context.
 * Orchestrates detection, scoring, cleanup, and MutationObserver.
 *
 * NOTE: Because Manifest V3 content scripts cannot use ES module imports
 * from other content-script files directly via `import`, this file
 * inlines minimal shims and uses dynamic-script injection via a loader
 * pattern. The rules/ modules are loaded via importScripts equivalents
 * using chrome.runtime.getURL.
 *
 * All detection/scoring/cleanup logic is duplicated into this single file
 * to ensure it works reliably as a non-module content script.
 */

(function () {
  'use strict';

  // ─── Guard: skip restricted pages ───────────────────────────────────────
  if (!document) return;
  const href = location.href;
  if (href.startsWith('chrome://') ||
      href.startsWith('chrome-extension://') ||
      href.startsWith('edge://') ||
      href.startsWith('brave://') ||
      (href.startsWith('about:') && href !== 'about:blank')) return;

  // ─── State ───────────────────────────────────────────────────────────────
  let settings         = null;
  let enabled          = true;
  let removedCount     = 0;
  let observerActive   = false;
  let scanScheduled    = false;
  let scanBudgetMs     = 50;        // max ms per scan pass
  let lastScanTime     = 0;
  let mutationObserver = null;
  let visibilityPaused = false;

  /** @type {Array<{elements: Element[], prevDisplays: string[], scrollRestored: boolean, timestamp: number}>} */
  const undoStack      = [];
  const MAX_UNDO       = 10;

  let savedBodyOverflow  = '';
  let savedHtmlOverflow  = '';
  let savedBodyPosition  = '';

  // ─── Default Settings ────────────────────────────────────────────────────
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

  // ─── Text Patterns ───────────────────────────────────────────────────────
  const ADBLOCK_PATTERNS = [
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
    /(?:does[\s_-]?n'?t|not)[\s_-]?allow[\s_-]?ad[\s_-]?block/i,
    /disable[\s_-]?(?:and|to)[\s_-]?(?:reload|continue)[\s_-]?(?:watching|viewing|reading)/i,
    /publisher[\s_-]?(?:does[\s_-]?n'?t|not)[\s_-]?allow/i
  ];

  const NEWSLETTER_PATTERNS = [
    /subscribe[\s_-](?:to[\s_-])?(?:our[\s_-])?newsletter/i,
    /sign[\s_-]up[\s_-]for[\s_-](?:our[\s_-])?(?:newsletter|updates|emails?)/i,
    /join[\s_-](?:our[\s_-])?(?:mailing[\s_-]list|community|newsletter)/i,
    /enter[\s_-]your[\s_-]email[\s_-](?:to[\s_-])?(?:subscribe|get|receive)/i
  ];

  const PROMO_PATTERNS = [
    /(?:limited[\s_-]time|exclusive|special)[\s_-]offer/i,
    /(?:\d+%?[\s_-]?off|save[\s_-]\$?\d+)/i,
    /(?:free[\s_-]trial|try[\s_-](?:for[\s_-])?free)/i
  ];

  const EXCLUSION_PATTERNS = [
    /(?:log[\s_-]?in|sign[\s_-]?in|login|signin)/i,
    /(?:create[\s_-]?account|register)/i,
    /(?:password|forgot[\s_-]?password)/i,
    /(?:payment|checkout|billing|credit[\s_-]?card)/i,
    /(?:age[\s_-]?verification|are[\s_-]you[\s_-](?:18|21|over))/i,
    /(?:cookie[\s_-]?(?:policy|consent|notice|settings?)|gdpr|ccpa)/i,
    /(?:privacy[\s_-]?(?:policy|notice|settings?))/i,
    /(?:terms[\s_-]?(?:of[\s_-]?(?:service|use)|and[\s_-]conditions))/i,
    /(?:two[\s_-]?factor|2fa|security[\s_-]?(?:code|check|verification))/i,
    /(?:captcha|robot[\s_-]?check|verify[\s_-]you're[\s_-]human)/i
  ];

  const THRESHOLDS = {
    conservative: { autoRemove: 80, preview: 60 },
    balanced:     { autoRemove: 65, preview: 45 },
    aggressive:   { autoRemove: 50, preview: 35 }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function normalizeText(el) {
    const raw = el.innerText || el.textContent || '';
    return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function getViewportCoverage(el) {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth  || document.documentElement.clientWidth  || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const ow = Math.max(0, Math.min(rect.right, vw)  - Math.max(rect.left, 0));
    const oh = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    return (ow * oh) / (vw * vh);
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.01;
  }

  function getZIndex(el) {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    return isNaN(z) ? 0 : z;
  }

  function isPositionedOverlay(el) {
    const pos = getComputedStyle(el).position;
    return pos === 'fixed' || pos === 'absolute' || pos === 'sticky';
  }

  function isAriaDialog(el) {
    const role = el.getAttribute('role')?.toLowerCase();
    return role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true';
  }

  function detectScrollLock() {
    const b = getComputedStyle(document.body);
    const h = getComputedStyle(document.documentElement);
    return b.overflow === 'hidden' || b.overflowY === 'hidden' ||
           h.overflow === 'hidden' || h.overflowY === 'hidden' ||
           b.position === 'fixed';
  }

  function isBackdropLayer(el) {
    if (!isPositionedOverlay(el)) return false;
    const st  = getComputedStyle(el);
    const cov = getViewportCoverage(el);
    if (cov < 0.5) return false;
    const bg  = st.backgroundColor;
    const am  = bg.match(/rgba?\([\d\s,]+,\s*([\d.]+)\)/);
    const alpha = am ? parseFloat(am[1]) : 1;
    return alpha < 0.95 || el.querySelectorAll('*').length < 3;
  }

  function hasCloseButton(el) {
    return !![
      '[aria-label*="close" i]','[aria-label*="dismiss" i]',
      '[title*="close" i]','[title*="dismiss" i]',
      '.close','.dismiss','.modal-close','.btn-close',
      'button[class*="close" i]','button[class*="dismiss" i]',
      '[data-dismiss]','[data-close]'
    ].find(s => el.querySelector(s));
  }

  function isInsideArticle(el) {
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

  function isMediaPlayer(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'video' || tag === 'audio') return true;
    const id  = (el.id || '').toLowerCase();
    const cls = (el.className || '').toLowerCase();
    const full = id + ' ' + cls;

    // Elements explicitly acting as ad overlays, clickjacks, or banners are NOT media players
    if (/\b(ad|ads|overlay|banner|popup|sponsor|click|clickjack|vast|vpaid|preroll|midroll|preview)\b/i.test(full)) {
      return false;
    }

    // Must actually contain a media element to be considered a media player container
    const hasMediaChild = el.querySelector && el.querySelector('video, audio');
    if (!hasMediaChild) return false;

    return /\b(video[\s_-]?js|plyr|jwplayer|brightcove)\b/.test(full) ||
           /^(?:player|video-container|player-wrapper)$/.test(id) ||
           /^(?:player|video-container|player-wrapper)$/.test(cls);
  }

  function isSameOriginUrl(urlStr) {
    if (!urlStr) return true;
    try {
      const u = new URL(urlStr, window.location.href);
      return u.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function findAllVideos(root = document) {
    const videos = [...root.querySelectorAll('video')];
    try {
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          videos.push(...findAllVideos(el.shadowRoot));
        }
      }
    } catch {}
    return videos;
  }

  const ANTI_ADBLOCK_TEXT_REGEX = /(?:does[\s_-]?n'?t|not)[\s_-]?allow[\s_-]?ad[\s_-]?block|disable[\s_-]?(?:and|to)[\s_-]?(?:reload|continue)[\s_-]?(?:watching|viewing)|publisher[\s_-]?(?:does[\s_-]?n'?t|not)[\s_-]?allow/i;

  function cleanAntiAdblockBanners() {
    if (!enabled || !settings?.autoCleanup) return 0;
    let removed = 0;

    // Scan all text-bearing elements for the exact publisher anti-adblock message across whole DOM
    const all = document.querySelectorAll('div, p, span, section, font, b, strong, a, h1, h2, h3, h4, center');
    for (const el of all) {
      if (el.dataset?.clearviewHidden) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > 10 && text.length < 350 && ANTI_ADBLOCK_TEXT_REGEX.test(text)) {
        hideEl(el);
        try { el.remove(); } catch {}
        // Also hide/remove parent box/modal/container if it's an overlay
        let cur = el.parentElement;
        while (cur && cur !== document.body && cur.id !== 'os_player' && cur.id !== 'video_player') {
          const style = getComputedStyle(cur);
          if (style.position === 'absolute' || style.position === 'fixed' || cur.querySelectorAll('*').length < 6) {
            hideEl(cur);
            try { cur.remove(); } catch {}
          }
          cur = cur.parentElement;
        }
        removed++;
      }
    }

    if (removed > 0) {
      removedCount += removed;
      updateBadge();

      // Ensure player containers (#os_player, .player, video) are visible and unlocked
      const playerElements = document.querySelectorAll('#os_player, #video_player, .player, .video-js, video, [class*="player" i]');
      for (const p of playerElements) {
        p.style.setProperty('display', 'block', 'important');
        p.style.setProperty('visibility', 'visible', 'important');
        p.style.setProperty('opacity', '1', 'important');
        p.style.setProperty('pointer-events', 'auto', 'important');
      }

      // Restore clickability of any play buttons inside player containers
      const playButtons = document.querySelectorAll('#os_player button, #os_player [class*="play" i], #os_player svg, .player button, .player [class*="play" i]');
      for (const btn of playButtons) {
        btn.style.setProperty('display', 'block', 'important');
        btn.style.setProperty('visibility', 'visible', 'important');
        btn.style.setProperty('pointer-events', 'auto', 'important');
      }

      // If video exists and is paused, unpause it
      for (const v of document.querySelectorAll('video')) {
        if (v.paused && v.src) {
          try { v.play(); } catch {}
        }
      }

      logEvent({
        type: 'cleanup_anti_adblock_banner',
        count: removed,
        domain: getCurrentDomain()
      });
    }

    return removed;
  }

  function cleanVideoOverlays() {
    if (!enabled || !settings?.autoCleanup) return 0;

    // Clean anti-adblock banners regardless of <video> tag existence
    cleanAntiAdblockBanners();

    const videos = findAllVideos(document);
    const playerContainers = document.querySelectorAll('#os_player, #video_player, .video-js, .jwplayer, .plyr, [class*="player" i]');
    if (!videos.length && !playerContainers.length) return 0;

    let removed = 0;
    const overlaysToRemove = [];

    for (const video of videos) {
      const vRect = video.getBoundingClientRect();
      if (vRect.width < 50 || vRect.height < 50) continue;

      const container = video.closest('.jwplayer, .video-js, .plyr, [class*="player" i], [id*="player" i], div') || video.parentElement;
      if (!container) continue;

      const candidates = container.querySelectorAll('a, div, span, iframe, button, canvas, svg, p, img, section');
      for (const el of candidates) {
        if (el === video || el.contains(video)) continue;
        if (el.dataset?.clearviewHidden) continue;

        const tag = el.tagName.toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        const id  = (el.id || '').toLowerCase();
        const full = id + ' ' + cls;

        // Skip legitimate video player controls
        if (/\b(control|controls|progress|time|volume|fullscreen|play-btn|vjs-play-control|jw-controlbar)\b/i.test(full)) {
          continue;
        }

        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (st.position !== 'absolute' && st.position !== 'fixed') continue;

        const rect = el.getBoundingClientRect();
        const overlapW = Math.max(0, Math.min(rect.right, vRect.right) - Math.max(rect.left, vRect.left));
        const overlapH = Math.max(0, Math.min(rect.bottom, vRect.bottom) - Math.max(rect.top, vRect.top));
        const overlapArea = overlapW * overlapH;
        const videoArea = vRect.width * vRect.height;
        const coverage = videoArea > 0 ? overlapArea / videoArea : 0;

        const innerTxt = el.innerText || el.textContent || '';
        const isAntiAdblockBanner = /(?:does[\s_-]?n'?t|not)[\s_-]?allow[\s_-]?ad[\s_-]?block|disable[\s_-]?(?:and|to)[\s_-]?(?:reload|continue)|publisher[\s_-]?(?:does[\s_-]?n'?t|not)[\s_-]?allow/i.test(innerTxt);

        if (coverage > 0.35 || isAntiAdblockBanner) {
          const opacity = parseFloat(st.opacity);
          const isTransparent = opacity < 0.1 || st.backgroundColor === 'transparent' || st.backgroundColor === 'rgba(0, 0, 0, 0)';
          const isAnchor = tag === 'a' && el.href;
          const isAdNamed = /\b(ad|ads|overlay|click|popup|banner|sponsor|vast|vpaid|preroll|jw-preview|fake|adblock)\b/i.test(full);
          const zIndex = parseInt(st.zIndex, 10) || 0;

          if (isAntiAdblockBanner || isAdNamed || (isAnchor && !isSameOriginUrl(el.href)) || (isTransparent && zIndex > 10 && el.innerText.trim().length < 5)) {
            overlaysToRemove.push(el);
          }
        }
      }
    }

    const record = { elements: [], prevDisplays: [], scrollRestored: false, timestamp: Date.now() };
    for (const el of overlaysToRemove) {
      if (!isVisible(el)) continue;
      const prev = hideEl(el);
      record.elements.push(el);
      record.prevDisplays.push(prev);
      removed++;
    }

    if (record.elements.length) {
      undoStack.unshift(record);
      if (undoStack.length > MAX_UNDO) undoStack.pop();
      removedCount += removed;
      updateBadge();

      // Ensure video element display is restored if hidden by anti-adblock
      for (const video of videos) {
        if (video.style.display === 'none') video.style.removeProperty('display');
        if (video.style.visibility === 'hidden') video.style.removeProperty('visibility');
      }

      logEvent({
        type: 'cleanup_video_overlay',
        count: removed,
        domain: getCurrentDomain()
      });
    }

    return removed;
  }

  function isNavigation(el) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'nav' || tag === 'header' || tag === 'footer') return true;
    const role = el.getAttribute('role')?.toLowerCase();
    return role === 'navigation' || role === 'banner' || role === 'contentinfo';
  }

  function isAppRoot(el) {
    const id  = (el.id || '').toLowerCase();
    const cls = (el.className || '').toLowerCase();
    return /\b(app|root|__next|nuxt|react-root|vue-app|angular-app)\b/.test(id + ' ' + cls);
  }

  function getCurrentDomain() {
    return location.hostname.replace(/^www\./, '');
  }

  function isDomainAllowed(allowlist) {
    const domain = getCurrentDomain();
    return (allowlist ?? []).some(d => {
      const clean = d.replace(/^www\./, '');
      return domain === clean || domain.endsWith('.' + clean);
    });
  }

  // ─── Scoring ─────────────────────────────────────────────────────────────

  function scoreElement(el) {
    if (!isVisible(el)) return { score: 0, signals: ['not visible'], category: 'none' };

    const signals  = [];
    let   score    = 0;
    const text     = normalizeText(el);
    const coverage = getViewportCoverage(el);
    const zIndex   = getZIndex(el);

    if (isAppRoot(el))    return { score: 0, signals: ['app root'], category: 'excluded' };
    if (isNavigation(el)) return { score: 0, signals: ['navigation'], category: 'excluded' };
    if (isMediaPlayer(el))return { score: 0, signals: ['media player'], category: 'excluded' };

    // User exclusion keywords
    const exKw = (settings?.exclusionKeywords ?? DEFAULT_SETTINGS.exclusionKeywords);
    for (const kw of exKw) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        return { score: 0, signals: [`exclusion keyword: ${kw}`], category: 'excluded' };
      }
    }

    // Built-in exclusion patterns
    for (const p of EXCLUSION_PATTERNS) {
      if (p.test(text)) {
        return { score: 0, signals: ['exclusion pattern matched'], category: 'excluded' };
      }
    }

    if (isInsideArticle(el)) {
      score -= 15; signals.push('inside article/main');
    }

    const textLen   = text.length;
    const nodeCount = el.querySelectorAll('*').length + 1;
    if (textLen / nodeCount > 200) {
      score -= 15; signals.push('high text density');
    }

    // Adblock patterns
    let adCount = 0;
    for (const p of ADBLOCK_PATTERNS) if (p.test(text)) adCount++;
    if (adCount >= 2) {
      score += 40; signals.push(`strong adblock text (${adCount} matches)`);
    } else if (adCount === 1) {
      score += textLen < 500 ? 40 : 25;
      signals.push('adblock text detected');
    }

    // Custom patterns
    for (const pat of (settings?.customPatterns ?? [])) {
      try { if (new RegExp(pat, 'i').test(text)) { score += 25; signals.push(`custom: ${pat}`); } }
      catch {}
    }

    for (const p of NEWSLETTER_PATTERNS) if (p.test(text)) { score += 20; signals.push('newsletter'); break; }
    for (const p of PROMO_PATTERNS)      if (p.test(text)) { score += 15; signals.push('promotional'); break; }

    if (isPositionedOverlay(el)) { score += 10; signals.push('positioned overlay'); }
    if (zIndex > 9999)           { score += 12; signals.push(`z-index:${zIndex}`); }
    else if (zIndex > 1000)      { score +=  8; signals.push(`z-index:${zIndex}`); }

    if (coverage > 0.8)          { score += 20; signals.push(`full viewport ${Math.round(coverage*100)}%`); }
    else if (coverage > 0.5)     { score += 12; signals.push(`large viewport ${Math.round(coverage*100)}%`); }
    else if (coverage < 0.1)     { score -= 10; signals.push('small coverage'); }

    if (isAriaDialog(el))        { score +=  8; signals.push('aria-dialog'); }
    if (hasCloseButton(el))      { score +=  6; signals.push('has close btn'); }
    if (isBackdropLayer(el))     { score += 18; signals.push('backdrop layer'); }
    if (detectScrollLock())      { score += 10; signals.push('scroll locked'); }
    if (el.parentElement === document.body) { score += 5; signals.push('body child'); }

    let category = 'unknown';
    if (score <= 0)                                          category = 'safe';
    else if (adCount > 0)                                    category = 'anti-adblock';
    else if (NEWSLETTER_PATTERNS.some(p => p.test(text)))   category = 'newsletter';
    else if (PROMO_PATTERNS.some(p => p.test(text)))        category = 'promotional';
    else if (isBackdropLayer(el))                            category = 'backdrop';
    else                                                      category = 'overlay';

    return { score: Math.max(0, Math.min(100, score)), signals, category };
  }

  // ─── Scan ─────────────────────────────────────────────────────────────────

  function scanDocument() {
    const sensitivity = settings?.sensitivity ?? 'balanced';
    const threshold   = THRESHOLDS[sensitivity]?.preview ?? 45;
    const candidates  = [];
    const seen        = new Set();

    const selectors = [
      '[role="dialog"]','[role="alertdialog"]','[aria-modal="true"]',
      'div[class*="modal" i]','div[class*="overlay" i]','div[class*="popup" i]',
      'div[class*="backdrop" i]','div[class*="adblock" i]','div[class*="ad-block" i]',
      'div[id*="modal" i]','div[id*="overlay" i]','div[id*="popup" i]','div[id*="adblock" i]'
    ].join(',');

    function evaluate(el) {
      if (seen.has(el)) return;
      seen.add(el);
      const tag = el.tagName?.toLowerCase();
      if (!tag || ['script','style','link','meta','input','textarea','select'].includes(tag)) return;
      if (!isVisible(el)) return;
      const result = scoreElement(el);
      if (result.score >= threshold) candidates.push({ el, ...result });
    }

    try { document.querySelectorAll(selectors).forEach(evaluate); } catch {}

    // Walk body children for computed fixed/absolute
    for (const el of [...document.body.children, ...document.body.querySelectorAll(':scope > * > *')]) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'absolute') evaluate(el);
    }

    candidates.sort((a, b) => b.score - a.score);

    // De-duplicate parent/child
    const deduped = [];
    for (const c of candidates) {
      if (!deduped.some(e => e.el.contains(c.el))) deduped.push(c);
    }
    return deduped;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  function findBackdrops(modal) {
    const backdrops = [];
    const check = (el) => {
      if (el !== modal && isBackdropLayer(el) && isVisible(el)) backdrops.push(el);
    };
    if (modal.parentElement) [...modal.parentElement.children].forEach(check);
    [...document.body.children].forEach(check);
    return [...new Set(backdrops)];
  }

  function hideEl(el) {
    const prev = el.style.display;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.dataset.clearviewHidden = '1';
    return prev;
  }

  function showEl(el, prev) {
    el.style.display = prev;
    el.style.removeProperty('pointer-events');
    delete el.dataset.clearviewHidden;
  }

  function unlockScroll() {
    if (!detectScrollLock()) return false;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyPosition = document.body.style.position;
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.setProperty('overflow', 'auto', 'important');
    document.body.style.setProperty('position', '', 'important');
    return true;
  }

  function performCleanup(candidates, force) {
    const sensitivity = settings?.sensitivity ?? 'balanced';
    const threshold   = THRESHOLDS[sensitivity]?.autoRemove ?? 65;
    const toClean     = force ? candidates : candidates.filter(c => c.score >= threshold);
    if (!toClean.length) return { removed: 0 };

    const record = { elements: [], prevDisplays: [], scrollRestored: false, timestamp: Date.now() };
    let removed  = 0;

    for (const cand of toClean) {
      if (!isVisible(cand.el)) continue;
      const prev = hideEl(cand.el);
      record.elements.push(cand.el);
      record.prevDisplays.push(prev);
      removed++;

      for (const bd of findBackdrops(cand.el)) {
        if (!isVisible(bd)) continue;
        const p = hideEl(bd);
        record.elements.push(bd);
        record.prevDisplays.push(p);
        removed++;
      }
    }

    record.scrollRestored = unlockScroll();
    if (record.elements.length) {
      undoStack.unshift(record);
      if (undoStack.length > MAX_UNDO) undoStack.pop();
    }
    removedCount += removed;
    updateBadge();
    return { removed };
  }

  function undoLastCleanup() {
    const record = undoStack.shift();
    if (!record) return { restored: 0 };
    let restored = 0;
    for (let i = 0; i < record.elements.length; i++) {
      const el = record.elements[i];
      if (el?.isConnected) { showEl(el, record.prevDisplays[i]); restored++; }
    }
    if (record.scrollRestored) {
      document.body.style.overflow            = savedBodyOverflow || '';
      document.documentElement.style.overflow = savedHtmlOverflow || '';
      document.body.style.position            = savedBodyPosition  || '';
    }
    removedCount = Math.max(0, removedCount - restored);
    updateBadge();
    return { restored };
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  function highlightElements(elements) {
    removeHighlights();
    if (!document.getElementById('cv-hl-style')) {
      const s = document.createElement('style');
      s.id = 'cv-hl-style';
      s.textContent = `.cv-highlight{outline:3px solid #00BCD4!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(0,188,212,.25)!important}`;
      document.head.appendChild(s);
    }
    elements.forEach(el => el.classList.add('cv-highlight'));
  }

  function removeHighlights() {
    document.querySelectorAll('.cv-highlight').forEach(el => el.classList.remove('cv-highlight'));
  }

  // ─── Badge ────────────────────────────────────────────────────────────────

  function updateBadge() {
    chrome.runtime.sendMessage({
      type: 'BADGE_UPDATE',
      count: removedCount,
      enabled: enabled
    }).catch(() => {});
  }

  // ─── Logging ──────────────────────────────────────────────────────────────

  function logEvent(entry) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', entry }).catch(() => {});
  }

  // ─── Main Scan Logic ──────────────────────────────────────────────────────

  function runScan(force = false) {
    if (!enabled || !settings) return;
    if (isDomainAllowed(settings.allowlist)) return;

    const now = performance.now();
    if (!force && now - lastScanTime < 500) return; // debounce
    lastScanTime = now;
    scanScheduled = false;

    // Clean intrusive video overlays first
    cleanVideoOverlays();

    const candidates = scanDocument();
    if (!candidates.length) return;

    if (settings.previewOnly) {
      highlightElements(candidates.map(c => c.el));
      logEvent({ type: 'preview', count: candidates.length, domain: getCurrentDomain() });
      return;
    }

    if (settings.autoCleanup || force) {
      const { removed } = performCleanup(candidates, force);
      if (removed > 0) {
        logEvent({
          type: 'cleanup',
          count: removed,
          domain: getCurrentDomain(),
          sensitivity: settings.sensitivity,
          signals: candidates.slice(0, 3).map(c => ({ score: c.score, category: c.category, signals: c.signals }))
        });
      }
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => runScan(), 300);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let mutationThrottle = null;
  let mutationDepth    = 0;

  function onMutations(mutations) {
    if (!enabled || !settings?.mutationObserver) return;
    if (mutationDepth > 0) return; // recursion guard

    // Fast check: if an anti-adblock banner node was added, clean it immediately
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) {
            const txt = (n.innerText || n.textContent || '');
            if (txt.length < 350 && ANTI_ADBLOCK_TEXT_REGEX.test(txt)) {
              cleanAntiAdblockBanners();
              break;
            }
          }
        }
      }
    }

    if (mutationThrottle) return;

    const hasRelevant = mutations.some(m =>
      m.type === 'childList' && [...m.addedNodes].some(n =>
        n.nodeType === 1 && !n.dataset?.clearviewHidden
      )
    );
    if (!hasRelevant) return;

    mutationThrottle = setTimeout(() => {
      mutationThrottle = null;
      mutationDepth++;
      try { scheduleScan(); }
      finally { mutationDepth--; }
    }, 400);
  }

  function startObserver() {
    if (observerActive) return;
    mutationObserver = new MutationObserver(onMutations);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-hidden', 'aria-modal']
    });
    observerActive = true;
  }

  function stopObserver() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    observerActive = false;
  }

  // ─── Visibility Change ────────────────────────────────────────────────────

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopObserver();
      visibilityPaused = true;
    } else if (visibilityPaused && settings?.mutationObserver) {
      visibilityPaused = false;
      startObserver();
      scheduleScan();
    }
  });

  // ─── Proactive Hover Video Cleaner ───────────────────────────────────────

  let hoverCleanThrottle = null;
  document.addEventListener('pointerenter', (e) => {
    if (!enabled || !settings?.autoCleanup) return;
    const target = e.target;
    if (target?.closest && target.closest('video, audio, .jwplayer, .video-js, .plyr, [class*="player" i], [id*="player" i]')) {
      if (!hoverCleanThrottle) {
        hoverCleanThrottle = setTimeout(() => {
          hoverCleanThrottle = null;
          cleanVideoOverlays();
        }, 50);
      }
    }
  }, true);

  // ─── Settings Load & Apply ────────────────────────────────────────────────

  async function loadSettings() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, res => {
        const cfg = res?.settings ?? DEFAULT_SETTINGS;
        settings  = { ...DEFAULT_SETTINGS, ...cfg };
        enabled   = settings.enabled;
        resolve(settings);
      });
    });
  }

  // ─── Message Handler ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {

      case 'SETTINGS_UPDATED':
        settings = { ...DEFAULT_SETTINGS, ...message.settings };
        enabled  = settings.enabled;
        updateBadge();
        if (!enabled) { stopObserver(); removeHighlights(); }
        else if (settings.mutationObserver && !observerActive) startObserver();
        sendResponse({ ok: true });
        break;

      case 'TRIGGER_SCAN':
        runScan(true);
        // Relay scan to all nested frames (e.g. video provider embeds)
        for (let i = 0; i < window.frames.length; i++) {
          try { window.frames[i].postMessage({ type: 'CLEARVIEW_TRIGGER_SCAN' }, '*'); } catch {}
        }
        sendResponse({
          ok: true,
          removedCount,
          undoAvailable: undoStack.length > 0,
          domain: getCurrentDomain()
        });
        break;

      case 'UNDO_CLEANUP': {
        const r = undoLastCleanup();
        sendResponse({ ok: true, restored: r.restored });
        break;
      }

      case 'GET_STATUS':
        sendResponse({
          ok: true,
          enabled,
          removedCount,
          undoAvailable: undoStack.length > 0,
          domain: getCurrentDomain(),
          sensitivity: settings?.sensitivity,
          previewOnly: settings?.previewOnly,
          isAllowlisted: isDomainAllowed(settings?.allowlist ?? [])
        });
        break;

      case 'POPUP_TAB_BLOCKED':
        removedCount++;
        updateBadge();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: 'unknown message' });
    }
    return false;
  });

  // Listen for inter-frame scan trigger (from top frame to video provider frames)
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'CLEARVIEW_TRIGGER_SCAN') {
      runScan(true);
    }
  });

  // Listen for ad-popup-blocked events dispatched by popup-guardian.js (MAIN world)
  window.addEventListener('clearview:ad-popup-blocked', (e) => {
    if (!enabled || settings?.blockPopups === false) return;
    removedCount++;
    updateBadge();
    // Notify background script of suspicious popup attempt for tab correlation
    chrome.runtime.sendMessage({
      type: 'SUSPICIOUS_POPUP_ATTEMPT',
      timestamp: Date.now()
    }).catch(() => {});
    logEvent({
      type: 'blocked_popup',
      domain: getCurrentDomain(),
      reason: e.detail?.reason || 'Ad popup prevented',
      url: (e.detail?.url || '').slice(0, 100)
    });
  });

  // ─── Initialise ───────────────────────────────────────────────────────────

  async function init() {
    await loadSettings();
    if (!enabled) { updateBadge(); return; }
    if (isDomainAllowed(settings.allowlist)) {
      console.log('[ClearView] Domain is allowlisted — skipping.');
      return;
    }

    // Instant sweep on initialization
    cleanAntiAdblockBanners();
    cleanVideoOverlays();

    if (settings.mutationObserver) startObserver();

    // Fast initial scan passes
    setTimeout(() => { cleanAntiAdblockBanners(); runScan(); }, 200);
    setTimeout(() => { cleanAntiAdblockBanners(); runScan(); }, 600);
    setTimeout(() => { cleanAntiAdblockBanners(); runScan(); }, 1200);

    // Continuous sweep for delayed anti-adblock banners (first 8 seconds)
    let sweepCount = 0;
    const initialSweeper = setInterval(() => {
      sweepCount++;
      cleanAntiAdblockBanners();
      if (sweepCount >= 10) clearInterval(initialSweeper);
    }, 800);

    // Also scan on full load
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => setTimeout(() => { cleanAntiAdblockBanners(); runScan(); }, 500));
    }
    // Handle SPA route changes
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        removedCount = 0;
        updateBadge();
        setTimeout(() => runScan(), 1000);
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(err => console.error('[ClearView] Init error:', err));
    });
  } else {
    init().catch(err => console.error('[ClearView] Init error:', err));
  }

})();

