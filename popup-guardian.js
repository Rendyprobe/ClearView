/**
 * ClearView — popup-guardian.js (MAIN world script)
 * Injected at document_start in the webpage execution context.
 * Intercepts window.open calls and clickjacking attempts before ad scripts run,
 * while transparently allowing legitimate user navigation (OAuth, links, user clicks).
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__clearview_guardian_installed__) return;
  window.__clearview_guardian_installed__ = true;

  const originalWindowOpen = window.open;

  // Track the most recent user interaction details
  let lastUserClick = {
    time: 0,
    trusted: false,
    targetTag: '',
    targetHref: '',
    isButton: false,
    isNavigation: false
  };

  // Safe domains that should never be blocked when opened in new window (OAuth, SSO, Payment, Docs)
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

  // Record real physical user click events in capture phase
  window.addEventListener('click', (e) => {
    const now = Date.now();
    const isTrusted = e.isTrusted === true;

    // Determine target element or its closest interactive parent
    const target = e.target;
    const anchor = target?.closest ? target.closest('a') : null;
    const button = target?.closest ? target.closest('button, [role="button"], input[type="submit"], input[type="button"]') : null;

    lastUserClick = {
      time: now,
      trusted: isTrusted,
      targetTag: target?.tagName?.toLowerCase() || '',
      targetHref: anchor?.href || '',
      isButton: !!button,
      isNavigation: !!(anchor || button)
    };
  }, true);

  // Monkey-patch window.open
  window.open = function (url, target, features) {
    const now = Date.now();
    const timeSinceClick = now - lastUserClick.time;
    const isRecentClick = timeSinceClick >= 0 && timeSinceClick < 1000;
    const isTrustedUser = lastUserClick.trusted && isRecentClick;

    // Check if the destination is a known legitimate service
    const isSafe = isSafeDomain(url);

    // If it's a safe domain, always allow
    if (isSafe) {
      return originalWindowOpen.call(this, url, target, features);
    }

    // If there was NO trusted user click recently (e.g., timer, onload, simulated dispatchEvent)
    if (!isTrustedUser) {
      // Dispatched without any physical user click -> Popunder / Popup Ad
      window.dispatchEvent(new CustomEvent('clearview:ad-popup-blocked', {
        detail: { url: String(url || ''), reason: 'No trusted user click' }
      }));
      return null;
    }

    // If user clicked, but the click was on blank body/container (click-jacking listener)
    // rather than on a real navigation element (link/button)
    if (!lastUserClick.isNavigation && !lastUserClick.isButton) {
      // Check if url points to same origin or hash
      let isSameOrigin = false;
      try {
        const u = new URL(url, window.location.href);
        isSameOrigin = (u.origin === window.location.origin);
      } catch {}

      // If it's opening an external site on an arbitrary click, it's a hijacked click
      if (!isSameOrigin) {
        window.dispatchEvent(new CustomEvent('clearview:ad-popup-blocked', {
          detail: { url: String(url || ''), reason: 'Clickjacking on non-navigation element' }
        }));
        return null;
      }
    }

    // Allow genuine navigation
    return originalWindowOpen.call(this, url, target, features);
  };
})();
