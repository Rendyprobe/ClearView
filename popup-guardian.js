/**
 * ClearView — popup-guardian.js (MAIN world script)
 * Injected at document_start in the webpage execution context (top level & all frames).
 * Intercepts window.open calls, clickjacking attempts, and video player ad overlays
 * before ad scripts run, while transparently allowing legitimate user navigation
 * (OAuth, SSO, genuine links, user clicks).
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__clearview_guardian_installed__) return;
  window.__clearview_guardian_installed__ = true;

  // ─── Patterns & URL Classification ──────────────────────────────────────────

  // Common ad networks, trackers, popunder, and suspicious redirect patterns
  const AD_URL_PATTERNS = [
    /ad[\s_.-]?(?:click|server|traffic|network|rotator|redirect|gateway|zone|link|cash|maven|keeper|ster|center)/i,
    /pop[\s_.-]?(?:under|up|cash|ads|myads)/i,
    /(?:bet|casino|gambling|porn|tracker|affiliate|trk|syndication|clickadu|hilltopads|propellerads|exoclick|monetag|richpush|yadro|trafficstars|juicyads|trafficjunky|onclick|revenuehits|yllix)/i,
    /(?:doubleclick\.net|googlesyndication\.com|adnxs\.com)/i,
    /[?&](?:utm_source|aff_id|subid|clickid|pubid|cid|camp|direct_link)=/i,
    /(?:1x-?bet|bet365|slot|jackpot|bonus|vulkan)/i,
    /\b(?:banner|prebid|popads|ads?|dood_ads?)\.js\b/i
  ];

  // Video host & streaming provider patterns
  const VIDEO_HOST_PATTERNS = [
    /dood\./i,
    /doodstream\./i,
    /doood\./i,
    /ds2play\./i,
    /streamtape\./i,
    /strtape\./i,
    /strcloud\./i,
    /filelions\./i,
    /fdewsdc\./i,
    /streamwish\./i,
    /wishembed\./i,
    /vidguard\./i,
    /vgembed\./i,
    /vembed\./i,
    /vidcloud\./i,
    /vcstream\./i,
    /mixdrop\./i,
    /mixembed\./i,
    /mp4upload\./i,
    /upstream\./i,
    /fembed\./i,
    /femax\./i,
    /luluvdo\./i,
    /lulustream\./i,
    /vidhide\./i,
    /vidhidepro\./i,
    /voe\.sx/i,
    /streamlare\./i,
    /netu\./i,
    /waaw\./i,
    /superembed\./i,
    /2embed\./i,
    /megacloud\./i,
    /rabbitstream\./i,
    /dokicloud\./i,
    /vidsrc\./i,
    /multiembed\./i,
    /embed\./i,
    /player\./i
  ];

  function isAdOrSuspiciousUrl(urlStr) {
    if (!urlStr) return false;
    return AD_URL_PATTERNS.some(p => p.test(urlStr));
  }

  // ─── Anti-Adblock Defuser (Brave Shields & Video Host Bait Defusal) ──────────

  // 1. Bait element regex patterns for honey-pot checking
  const BAIT_REGEX = /\b(adsbox|ad-banner|banner-ad|ad_banner|pub_300x250|pub_300x250_m|pub_728x90|text-ad|textAd|header-ad|ad-unit|adzone|ad-placement|adblock|google-ad|afs|sponsor|ad-container|ad-wrapper|advertisement)\b/i;
  const ANTI_ADBLOCK_INLINE_REGEX = /(?:does[\s_-]?n'?t|not)[\s_-]?allow[\s_-]?ad[\s_-]?block|disable[\s_-]?(?:and|to)[\s_-]?(?:reload|continue)[\s_-]?(?:watching|viewing)|publisher[\s_-]?(?:does[\s_-]?n'?t|not)[\s_-]?allow|allow[\s_-]?adblock/i;

  function isBait(el) {
    if (!el || el.nodeType !== 1) return false;
    const str = (el.className || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute ? (el.getAttribute('data-ad') || '') : '');
    return BAIT_REGEX.test(str);
  }

  function createFakeBaitElement(className, id) {
    const el = document.createElement('div');
    if (className) el.className = className;
    if (id) el.id = id;
    el.style.cssText = 'position: absolute !important; top: -9999px !important; left: -9999px !important; width: 300px !important; height: 250px !important; display: block !important; visibility: visible !important; opacity: 1 !important;';
    return el;
  }

  // 2. Abort-current-inline-script (acis): Terminate anti-adblock inline scripts when they attempt DOM queries
  function checkAndAbortAntiAdblockInlineScript() {
    const cur = document.currentScript;
    if (cur && cur.tagName === 'SCRIPT') {
      const text = cur.textContent || '';
      if (text.length > 0 && ANTI_ADBLOCK_INLINE_REGEX.test(text)) {
        throw new ReferenceError('ClearView: anti-adblock inline script aborted');
      }
    }
  }

  // 3. Abort-on-property-write (aopw) for known popup controllers (DoodPop, _pop, __aaZoneid)
  ['DoodPop', '_pop', '__aaZoneid'].forEach(prop => {
    try {
      Object.defineProperty(window, prop, {
        set: function () {
          throw new ReferenceError('ClearView: ' + prop + ' neutralized');
        },
        get: function () {
          return undefined;
        },
        configurable: true
      });
    } catch {}
  });

  // 4. Lock anti-adblock flag variables to prevent scripts from reporting detection
  const FAKE_GLOBALS = {
    canRunAds: true,
    isAdblockActive: false,
    adblock: false,
    adblocker: false,
    dood_ads: true,
    is_adblock: false,
    ad_blocker_detected: false,
    hasAdBlocker: false,
    detectedAdBlock: false,
    google_ad_status: 1
  };

  for (const [key, val] of Object.entries(FAKE_GLOBALS)) {
    try {
      Object.defineProperty(window, key, {
        value: val,
        writable: false,
        configurable: true
      });
    } catch {
      try { window[key] = val; } catch {}
    }
  }

  // 5. Spoof HTMLElement.prototype dimensions & parent queries on bait elements
  try {
    const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    if (origOffsetHeight && origOffsetHeight.get) {
      const origGet = origOffsetHeight.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        get: function () {
          const val = origGet.call(this);
          if (val === 0 && isBait(this)) return 250;
          return val;
        },
        configurable: true
      });
    }
  } catch {}

  try {
    const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    if (origOffsetWidth && origOffsetWidth.get) {
      const origGet = origOffsetWidth.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function () {
          const val = origGet.call(this);
          if (val === 0 && isBait(this)) return 300;
          return val;
        },
        configurable: true
      });
    }
  } catch {}

  try {
    const origOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    if (origOffsetParent && origOffsetParent.get) {
      const origGet = origOffsetParent.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        get: function () {
          const parent = origGet.call(this);
          if (!parent && isBait(this)) return document.body || document.documentElement;
          return parent;
        },
        configurable: true
      });
    }
  } catch {}

  // 6. Spoof Element.prototype client dimensions & bounding rect
  try {
    const origClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    if (origClientHeight && origClientHeight.get) {
      const origGet = origClientHeight.get;
      Object.defineProperty(Element.prototype, 'clientHeight', {
        get: function () {
          const val = origGet.call(this);
          if (val === 0 && isBait(this)) return 250;
          return val;
        },
        configurable: true
      });
    }
  } catch {}

  try {
    const origClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    if (origClientWidth && origClientWidth.get) {
      const origGet = origClientWidth.get;
      Object.defineProperty(Element.prototype, 'clientWidth', {
        get: function () {
          const val = origGet.call(this);
          if (val === 0 && isBait(this)) return 300;
          return val;
        },
        configurable: true
      });
    }
  } catch {}

  try {
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const rect = origGetBoundingClientRect.call(this);
      if (isBait(this) && (rect.width === 0 || rect.height === 0)) {
        return new DOMRect(rect.x || 0, rect.y || 0, 300, 250);
      }
      return rect;
    };
  } catch {}

  // 7. Spoof window.getComputedStyle and getPropertyValue for bait elements
  try {
    const origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function (el, pseudo) {
      const style = origGetComputedStyle.call(this, el, pseudo);
      if (isBait(el)) {
        return new Proxy(style, {
          get(target, prop) {
            if (prop === 'display' && target.display === 'none') return 'block';
            if (prop === 'visibility' && target.visibility === 'hidden') return 'visible';
            if (prop === 'opacity' && (target.opacity === '0' || parseFloat(target.opacity) < 0.1)) return '1';
            if (prop === 'getPropertyValue') {
              return function (p) {
                if (p === 'display' && target.getPropertyValue('display') === 'none') return 'block';
                if (p === 'visibility' && target.getPropertyValue('visibility') === 'hidden') return 'visible';
                if (p === 'opacity' && target.getPropertyValue('opacity') === '0') return '1';
                return target.getPropertyValue(p);
              };
            }
            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });
      }
      return style;
    };
  } catch {}

  // 8. Intercept DOM query methods to defend against missing bait elements and abort inline anti-adblock scripts
  try {
    const origGetElementsByClassName = Document.prototype.getElementsByClassName;
    Document.prototype.getElementsByClassName = function (name) {
      checkAndAbortAntiAdblockInlineScript();
      const res = origGetElementsByClassName.call(this, name);
      if (res.length === 0 && BAIT_REGEX.test(name)) {
        const fake = createFakeBaitElement(name, '');
        return [fake];
      }
      return res;
    };
  } catch {}

  try {
    const origGetElementById = Document.prototype.getElementById;
    Document.prototype.getElementById = function (id) {
      checkAndAbortAntiAdblockInlineScript();
      const res = origGetElementById.call(this, id);
      if (!res && BAIT_REGEX.test(id)) {
        return createFakeBaitElement('', id);
      }
      return res;
    };
  } catch {}

  try {
    const origQuerySelector = Document.prototype.querySelector;
    Document.prototype.querySelector = function (selector) {
      checkAndAbortAntiAdblockInlineScript();
      const res = origQuerySelector.call(this, selector);
      if (!res && typeof selector === 'string' && BAIT_REGEX.test(selector)) {
        return createFakeBaitElement(selector.replace(/^[.#]/, ''), '');
      }
      return res;
    };

    const origQuerySelectorAll = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) {
      checkAndAbortAntiAdblockInlineScript();
      const res = origQuerySelectorAll.call(this, selector);
      if (res.length === 0 && typeof selector === 'string' && BAIT_REGEX.test(selector)) {
        return [createFakeBaitElement(selector.replace(/^[.#]/, ''), '')];
      }
      return res;
    };
  } catch {}

  // 9. Defuse setInterval / setTimeout debugger traps and delayed anti-adblock triggers
  try {
    const origSetInterval = window.setInterval;
    window.setInterval = function (fn, delay, ...args) {
      if (typeof fn === 'function' && fn.toString().includes('debugger')) return 0;
      if (typeof fn === 'string' && fn.includes('debugger')) return 0;
      return origSetInterval.call(this, fn, delay, ...args);
    };

    const origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...args) {
      if (typeof fn === 'function') {
        const fnStr = fn.toString();
        if (fnStr.includes('debugger')) return 0;
        if (ANTI_ADBLOCK_INLINE_REGEX.test(fnStr)) return 0;
      }
      if (typeof fn === 'string') {
        if (fn.includes('debugger') || ANTI_ADBLOCK_INLINE_REGEX.test(fn)) return 0;
      }
      return origSetTimeout.call(this, fn, delay, ...args);
    };
  } catch {}

  // 10. Network Probe Defuser (Brave Shields network block interception)
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (resource, init) {
        const urlStr = typeof resource === 'string' ? resource : resource?.url || '';
        if (isAdOrSuspiciousUrl(urlStr)) {
          return Promise.resolve(new Response('/* clearview: defused */', {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/javascript' }
          }));
        }
        return origFetch.apply(this, arguments).catch(err => {
          if (isAdOrSuspiciousUrl(urlStr)) {
            return new Response('/* clearview: defused */', { status: 200 });
          }
          throw err;
        });
      };
    }
  } catch {}

  // 11. XMLHttpRequest Probe Defuser
  try {
    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__cv_target_url = String(url || '');
      return origXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__cv_target_url && isAdOrSuspiciousUrl(this.__cv_target_url)) {
        Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
        Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
        Object.defineProperty(this, 'responseText', { value: '/* clearview: ok */', writable: true, configurable: true });
        setTimeout(() => {
          if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          if (typeof this.onload === 'function') this.onload();
        }, 10);
        return;
      }
      return origXhrSend.apply(this, arguments);
    };
  } catch {}

  // 12. Intercept error events on ad script tags (prevents script.onerror anti-adblock trigger)
  window.addEventListener('error', (e) => {
    const target = e.target;
    if (target && target.tagName === 'SCRIPT') {
      const src = target.src || '';
      if (isAdOrSuspiciousUrl(src) || BAIT_REGEX.test(src)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (typeof target.onload === 'function') {
          try { target.onload(); } catch {}
        }
      }
    }
  }, true);

  try {
    const origScriptErrorDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'onerror');
    if (origScriptErrorDesc && origScriptErrorDesc.set) {
      const origSet = origScriptErrorDesc.set;
      Object.defineProperty(HTMLScriptElement.prototype, 'onerror', {
        set: function (fn) {
          const self = this;
          const wrapped = function (ev) {
            const src = self.src || '';
            if (isAdOrSuspiciousUrl(src) || BAIT_REGEX.test(src)) {
              if (typeof self.onload === 'function') {
                try { self.onload(); } catch {}
              }
              return;
            }
            if (typeof fn === 'function') return fn.call(self, ev);
          };
          origSet.call(this, wrapped);
        },
        configurable: true
      });
    }
  } catch {}

  // 13. Instant DOM Cleaner in MAIN world (catches anti-adblock banners the moment they enter DOM)
  try {
    const removeAntiAdblockNode = (node) => {
      if (!node || node.nodeType !== 1) return;
      const text = (node.innerText || node.textContent || '').trim();
      if (text.length > 10 && text.length < 350 && ANTI_ADBLOCK_INLINE_REGEX.test(text)) {
        try { node.remove(); } catch { node.style.display = 'none'; }
        const players = document.querySelectorAll('#os_player, #video_player, .player, video');
        players.forEach(p => {
          p.style.setProperty('display', 'block', 'important');
          p.style.setProperty('visibility', 'visible', 'important');
          p.style.setProperty('opacity', '1', 'important');
        });
      }
    };

    const mainObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            removeAntiAdblockNode(node);
            const children = node.querySelectorAll ? node.querySelectorAll('*') : [];
            for (const c of children) {
              removeAntiAdblockNode(c);
            }
          }
        }
      }
    });

    const targetRoot = document.documentElement || document;
    mainObserver.observe(targetRoot, { childList: true, subtree: true });
  } catch {}

  // ─── Popup Guardian & Clickjacking Protection ───────────────────────────────

  const originalWindowOpen = window.open;
  const originalProtoOpen = typeof Window !== 'undefined' ? Window.prototype.open : null;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  // Track the most recent user interaction details
  let lastUserClick = {
    time: 0,
    trusted: false,
    target: null,
    targetTag: '',
    targetHref: '',
    isButton: false,
    isNavigation: false,
    inVideoContext: false
  };

  // Safe domains that should never be blocked (OAuth, SSO, Payment, Docs)
  const SAFE_DOMAINS = [
    'accounts.google.com',
    'appleid.apple.com',
    'login.microsoftonline.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'github.com',
    'gitlab.com',
    'paypal.com',
    'stripe.com'
  ];

  function isSafeDomain(urlStr) {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr, window.location.href);
      const host = parsed.hostname.toLowerCase();
      return SAFE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch {
      return false;
    }
  }

  function isSameOriginUrl(urlStr) {
    if (!urlStr) return true;
    try {
      const parsed = new URL(urlStr, window.location.href);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function isVideoHost() {
    const host = window.location.hostname.toLowerCase();
    return VIDEO_HOST_PATTERNS.some(p => p.test(host));
  }

  function isInsideVideoContext(el) {
    if (!el) {
      return (window !== window.top && (isVideoHost() || !!document.querySelector('video, #os_player, .player')));
    }

    const tag = el.tagName?.toLowerCase();
    if (tag === 'video' || tag === 'audio') return true;

    // Check if element is or is within a player container
    if (el.closest) {
      const container = el.closest(
        'video, audio, .jwplayer, .video-js, .plyr, [class*="player" i], [id*="player" i], ' +
        '[class*="vjs-" i], [class*="jw-" i], [id*="vjs" i], [id*="jw" i], ' +
        '.player-container, #player-wrapper, #os_player, #video_player, .media-player, [data-player], [data-video], ' +
        'button[class*="play" i], [class*="play-button" i], [class*="play_btn" i], ' +
        '[class*="play-btn" i], [aria-label*="play" i], [title*="play" i]'
      );
      if (container) return true;
    }

    // Inside iframe with a video player
    if (window !== window.top && (isVideoHost() || !!document.querySelector('video, #os_player, .player'))) {
      return true;
    }

    return false;
  }

  // Create a mock/dummy window object so scripts expecting properties don't crash
  function createDummyWindow() {
    return {
      closed: false,
      focus: () => {},
      blur: () => {},
      close: function () { this.closed = true; },
      location: { href: '', replace: () => {}, assign: () => {} },
      document: { write: () => {}, open: () => {}, close: () => {} },
      postMessage: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  function notifyBlocked(url, reason) {
    window.dispatchEvent(new CustomEvent('clearview:ad-popup-blocked', {
      detail: { url: String(url || ''), reason: reason || 'Popup blocked' }
    }));
  }

  // Check if an anchor element is a transparent clickjacking trap on a video or page
  function isFakeOverlayAnchor(anchor) {
    if (!anchor || !anchor.href) return false;
    if (isSafeDomain(anchor.href)) return false;

    if (!isSameOriginUrl(anchor.href) || isAdOrSuspiciousUrl(anchor.href)) {
      const inVideo = isInsideVideoContext(anchor);
      if (inVideo) return true;

      try {
        const style = window.getComputedStyle(anchor);
        const isPositioned = style.position === 'absolute' || style.position === 'fixed';
        const opacity = parseFloat(style.opacity);
        const isTransparent = opacity < 0.1 || style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)';
        const rect = anchor.getBoundingClientRect();
        const coversArea = rect.width > 200 && rect.height > 150;
        const textEmpty = (anchor.innerText || '').trim().length === 0;

        if (isPositioned && (isTransparent || textEmpty) && (coversArea || inVideo)) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  // Capture phase listener: Catch transparent overlay traps & record physical user clicks
  function handleCaptureClick(e) {
    const now = Date.now();
    const isTrusted = e.isTrusted === true;
    const target = e.target;
    const anchor = target?.closest ? target.closest('a') : null;
    const button = target?.closest ? target.closest('button, [role="button"], input[type="submit"], input[type="button"]') : null;
    const inVideo = isInsideVideoContext(target);

    // 1. Intercept transparent overlay links covering video players or pages
    if (anchor && isFakeOverlayAnchor(anchor)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      notifyBlocked(anchor.href, 'Video clickjacking overlay link blocked');
      try {
        anchor.remove();
      } catch {}
      return;
    }

    // 2. Intercept transparent div/canvas traps placed over the video
    if (inVideo && target && target.tagName !== 'VIDEO') {
      try {
        const idCls = ((target.className || '') + ' ' + (target.id || '')).toLowerCase();
        const isPlayerEl = /\b(player|video|vjs|jw|os_player|screen|stage|poster|wrapper|media|control|controls|progress|time)\b/i.test(idCls);
        if (!isPlayerEl) {
          const style = window.getComputedStyle(target);
          const isPos = style.position === 'absolute' || style.position === 'fixed';
          const op = parseFloat(style.opacity);
          const isTrans = op < 0.1 || style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)';
          const r = target.getBoundingClientRect();
          const isBig = r.width > 150 && r.height > 100;
          const noText = (target.innerText || '').trim().length === 0;
          if (isPos && (isTrans || noText) && isBig && !target.querySelector('button, input, select, video')) {
            target.style.setProperty('pointer-events', 'none', 'important');
            if (/\b(overlay|click|trap|fake|ad|banner)\b/i.test(idCls)) {
              target.style.setProperty('display', 'none', 'important');
            }
          }
        }
      } catch {}
    }

    // 3. Record genuine user interaction
    lastUserClick = {
      time: now,
      trusted: isTrusted,
      target: target,
      targetTag: target?.tagName?.toLowerCase() || '',
      targetHref: anchor?.href || '',
      isButton: !!button,
      isNavigation: !!(anchor || button),
      inVideoContext: inVideo
    };
  }

  // Register capture listeners across all interaction types
  window.addEventListener('click', handleCaptureClick, true);
  window.addEventListener('pointerdown', handleCaptureClick, true);
  window.addEventListener('mousedown', handleCaptureClick, true);
  window.addEventListener('touchend', handleCaptureClick, true);

  // Monkey-patch HTMLAnchorElement.prototype.click to catch dynamic `a.click()` ad triggers
  HTMLAnchorElement.prototype.click = function () {
    const url = this.href || '';
    if (isSafeDomain(url)) {
      return originalAnchorClick.call(this);
    }

    const now = Date.now();
    const timeSinceClick = now - lastUserClick.time;
    const isRecent = timeSinceClick >= 0 && timeSinceClick < 1000;
    const inVideo = isInsideVideoContext(this) || lastUserClick.inVideoContext;

    if (inVideo || !lastUserClick.trusted || !isRecent || isAdOrSuspiciousUrl(url) || (!isSameOriginUrl(url) && !lastUserClick.isNavigation)) {
      notifyBlocked(url, 'Programmatic anchor click blocked');
      return;
    }

    return originalAnchorClick.call(this);
  };

  // Guarded window.open implementation
  function guardedWindowOpen(url, target, features) {
    const urlStr = String(url || '');
    const now = Date.now();
    const timeSinceClick = now - lastUserClick.time;
    const isRecentClick = timeSinceClick >= 0 && timeSinceClick < 1000;
    const isTrustedUser = lastUserClick.trusted && isRecentClick;

    if (isSafeDomain(urlStr)) {
      const openFn = originalWindowOpen || originalProtoOpen;
      return openFn.call(this, url, target, features);
    }

    // 1. Block ANY external window.open originating from a video player or video provider
    const inVideo = isInsideVideoContext(lastUserClick.target) || lastUserClick.inVideoContext || isVideoHost();
    if (inVideo) {
      if (!isSameOriginUrl(urlStr) || urlStr === '' || urlStr === 'about:blank' || isAdOrSuspiciousUrl(urlStr)) {
        notifyBlocked(urlStr, 'Video provider popup blocked');
        return createDummyWindow();
      }
    }

    // 2. Block if there was NO recent physical user click
    if (!isTrustedUser) {
      notifyBlocked(urlStr, 'No trusted user click');
      return createDummyWindow();
    }

    // 3. Block if user clicked arbitrary container (clickjacking listener on body/div)
    if (!lastUserClick.isNavigation && !lastUserClick.isButton) {
      if (!isSameOriginUrl(urlStr) || isAdOrSuspiciousUrl(urlStr) || urlStr === '' || urlStr === 'about:blank') {
        notifyBlocked(urlStr, 'Clickjacking on non-navigation element');
        return createDummyWindow();
      }
    }

    // 4. Block known ad/popunder patterns
    if (isAdOrSuspiciousUrl(urlStr)) {
      notifyBlocked(urlStr, 'Suspicious ad/popunder destination');
      return createDummyWindow();
    }

    const openFn = originalWindowOpen || originalProtoOpen;
    return openFn.call(this, url, target, features);
  }

  // Monkey-patch window.open and Window.prototype.open
  window.open = guardedWindowOpen;
  try {
    if (typeof Window !== 'undefined' && Window.prototype) {
      Window.prototype.open = guardedWindowOpen;
    }
  } catch {}

  // Trap dynamically created clean iframes to ensure their contentWindow.open is also guarded
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (desc && desc.get) {
      const origGet = desc.get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const win = origGet.call(this);
          if (win && !win.__clearview_guardian_installed__) {
            try {
              win.open = guardedWindowOpen;
              if (win.Window?.prototype) win.Window.prototype.open = guardedWindowOpen;
              win.__clearview_guardian_installed__ = true;
            } catch {}
          }
          return win;
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch {}
})();
