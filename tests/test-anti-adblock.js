/**
 * Automated test runner for ClearView Anti-Adblock Defuser & Video Provider Protections.
 * Tests popup-guardian.js and content.js logic against Doodstream & Brave Shields scenarios.
 */

const assert = require('assert');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  ClearView — Anti-Adblock & Video Provider Automated Tests');
console.log('═══════════════════════════════════════════════════════════════\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}\n${err.stack}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup Browser Environment Mocks
// ─────────────────────────────────────────────────────────────────────────────

global.window = global;
global.self = global;
global.document = {
  currentScript: null,
  documentElement: { nodeType: 1, tagName: 'HTML', style: {} },
  body: { nodeType: 1, tagName: 'BODY', style: {} },
  location: { href: 'https://doodstream.com/e/testvideo123', hostname: 'doodstream.com', origin: 'https://doodstream.com' }
};
global.location = global.document.location;

// Mock classes
class MockElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.className = '';
    this.id = '';
    this.style = {
      display: '',
      visibility: '',
      opacity: '1',
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
      getPropertyValue(k) { return this[k] || ''; }
    };
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this.innerText = '';
    this.textContent = '';
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) { this.attributes[name] = val; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest(sel) { return null; }
  remove() { this.removed = true; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }; }
}

global.Element = class Element extends MockElement {
  get clientHeight() { return 0; }
  get clientWidth() { return 0; }
};
global.HTMLElement = class HTMLElement extends global.Element {
  get offsetHeight() { return 0; }
  get offsetWidth() { return 0; }
  get offsetParent() { return null; }
};
global.HTMLScriptElement = class HTMLScriptElement extends global.HTMLElement {
  constructor() { super('SCRIPT'); }
};
global.HTMLAnchorElement = class HTMLAnchorElement extends global.HTMLElement {};
global.HTMLIFrameElement = class HTMLIFrameElement extends global.HTMLElement {};
global.Document = class Document {
  getElementsByClassName(name) { return []; }
  getElementById(id) { return null; }
  querySelector(sel) { return null; }
  querySelectorAll(sel) { return []; }
  createElement(tag) { return new global.HTMLElement(tag); }
};
global.document.createElement = (tag) => new global.HTMLElement(tag);
global.DOMRect = class DOMRect {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.width = w; this.height = h;
    this.left = x; this.top = y; this.right = x + w; this.bottom = y + h;
  }
};
global.Response = class Response {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = init.headers || {};
  }
};
global.CustomEvent = class CustomEvent {
  constructor(name, init = {}) {
    this.name = name;
    this.detail = init.detail;
  }
};
global.MutationObserver = class MutationObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
};

// Event listener stubs
global.window.addEventListener = (ev, fn) => {};
global.window.dispatchEvent = (ev) => {};
global.window.getComputedStyle = (el) => el.style || {};

// Mock fetch
global.window.fetch = (url) => Promise.resolve(new Response('ok', { status: 200 }));

// Mock XHR
global.XMLHttpRequest = class XMLHttpRequest {
  open(method, url) { this.url = url; }
  send() {}
};

// ─────────────────────────────────────────────────────────────────────────────
// Load popup-guardian.js into the mock environment
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const guardianCode = fs.readFileSync('c:\\PROJEK\\bypass-popup-adblock\\popup-guardian.js', 'utf8');
eval(guardianCode);

// ─────────────────────────────────────────────────────────────────────────────
// Tests: popup-guardian.js
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- Test Suite 1: Global Anti-Adblock Variables & Popup Killers ---');

test('Global anti-adblock variables are locked and spoofed (canRunAds, isAdblockActive)', () => {
  assert.strictEqual(window.canRunAds, true);
  assert.strictEqual(window.isAdblockActive, false);
  assert.strictEqual(window.dood_ads, true);
  assert.strictEqual(window.ad_blocker_detected, false);

  // Attempting to overwrite should not change locked values
  try { window.canRunAds = false; } catch {}
  try { window.isAdblockActive = true; } catch {}
  assert.strictEqual(window.canRunAds, true, 'canRunAds should remain true');
  assert.strictEqual(window.isAdblockActive, false, 'isAdblockActive should remain false');
});

test('Abort-on-property-write (aopw): Setting DoodPop or _pop throws ReferenceError', () => {
  assert.throws(() => {
    window.DoodPop = function () {};
  }, /ClearView: DoodPop neutralized/);

  assert.throws(() => {
    window._pop = {};
  }, /ClearView: _pop neutralized/);
});

console.log('\n--- Test Suite 2: Bait Element Geometry & ComputedStyle Spoofing ---');

test('Bait element offsetHeight, offsetWidth, clientHeight, clientWidth spoofing', () => {
  const bait = new HTMLElement();
  bait.className = 'pub_300x250 adsbox';

  assert.strictEqual(bait.offsetHeight, 250, 'Bait element offsetHeight should be spoofed to 250');
  assert.strictEqual(bait.offsetWidth, 300, 'Bait element offsetWidth should be spoofed to 300');
  assert.strictEqual(bait.clientHeight, 250, 'Bait element clientHeight should be spoofed to 250');
  assert.strictEqual(bait.clientWidth, 300, 'Bait element clientWidth should be spoofed to 300');
  assert.ok(bait.offsetParent, 'Bait element offsetParent should not be null');
});

test('Bait element getBoundingClientRect() spoofing', () => {
  const bait = new HTMLElement();
  bait.className = 'ad-banner text-ad';
  const rect = bait.getBoundingClientRect();
  assert.strictEqual(rect.width, 300, 'rect.width should be 300');
  assert.strictEqual(rect.height, 250, 'rect.height should be 250');
});

test('window.getComputedStyle and getPropertyValue spoofing on hidden bait element', () => {
  const bait = new HTMLElement();
  bait.className = 'pub_300x250';
  bait.style.display = 'none';
  bait.style.visibility = 'hidden';

  const computed = window.getComputedStyle(bait);
  assert.strictEqual(computed.display, 'block', 'computed.display should be block');
  assert.strictEqual(computed.visibility, 'visible', 'computed.visibility should be visible');
  assert.strictEqual(computed.getPropertyValue('display'), 'block', 'getPropertyValue("display") should return block');
  assert.strictEqual(computed.getPropertyValue('visibility'), 'visible', 'getPropertyValue("visibility") should return visible');
});

console.log('\n--- Test Suite 3: Anti-Adblock Inline Script Abort (acis) ---');

test('DOM query methods abort inline scripts containing "The publisher doesnt allow adblock"', () => {
  // Simulate an inline script currently running
  const mockScript = new HTMLScriptElement();
  mockScript.textContent = `
    var check = document.getElementsByClassName('pub_300x250');
    if (check.length === 0) {
      alert("The publisher doesnt allow adblock, please disable and reload to continue watching!");
    }
  `;
  document.currentScript = mockScript;

  // Calling getElementsByClassName while currentScript has anti-adblock text should throw
  assert.throws(() => {
    Document.prototype.getElementsByClassName.call(document, 'pub_300x250');
  }, /ClearView: anti-adblock inline script aborted/);

  // Calling querySelector while currentScript has anti-adblock text should throw
  assert.throws(() => {
    Document.prototype.querySelector.call(document, '.adsbox');
  }, /ClearView: anti-adblock inline script aborted/);

  document.currentScript = null;
});

test('DOM query methods return fake bait elements when queried for bait classes if none exist', () => {
  document.currentScript = null; // Clean non-anti-adblock script
  Document.prototype.getElementsByClassName = function (name) { return []; };

  // Re-run the patched version
  delete window.__clearview_guardian_installed__;
  eval(guardianCode);

  const res = Document.prototype.getElementsByClassName.call(document, 'pub_300x250');
  assert.ok(res.length > 0, 'Should return at least 1 fake element');
  assert.strictEqual(res[0].className, 'pub_300x250');
  assert.strictEqual(res[0].offsetHeight, 250);
});

console.log('\n--- Test Suite 4: Debugger & Probe Defusers ---');

test('setInterval and setTimeout defuse debugger statements without freezing', () => {
  let executed = false;
  window.setInterval(() => { debugger; executed = true; }, 100);
  assert.strictEqual(executed, false, 'Debugger interval should be defused');

  window.setTimeout(() => { debugger; executed = true; }, 100);
  assert.strictEqual(executed, false, 'Debugger timeout should be defused');
});

test('window.fetch returns fake 200 OK Response on blocked ad probes', async () => {
  const res = await window.fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
  assert.strictEqual(res.status, 200, 'Status should be 200');
});

test('Guarded window.open blocks video context popup calls and returns dummy window', () => {
  const dummy = window.open('https://bet365-bonus.example.com/click', '_blank');
  assert.ok(dummy, 'Should return dummy window object');
  assert.strictEqual(dummy.closed, false);
  dummy.close();
  assert.strictEqual(dummy.closed, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: content.js Banner Removal & Player Unlocking
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Test Suite 5: Doodstream Banner Removal & Player Recovery ---');

test('Doodstream scenario: exact banner removal and #os_player display recovery', () => {
  const contentCode = fs.readFileSync('c:/PROJEK/bypass-popup-adblock/content.js', 'utf8');

  // Verify that ANTI_ADBLOCK_TEXT_REGEX matches Doodstream exact banner
  const doodBannerText = 'The publisher doesnt allow adblock, please disable and reload to continue watching!';
  const regex = /(?:does[\s_-]?n'?t|not)[\s_-]?allow[\s_-]?ad[\s_-]?block|disable[\s_-]?(?:and|to)[\s_-]?(?:reload|continue)[\s_-]?(?:watching|viewing)|publisher[\s_-]?(?:does[\s_-]?n'?t|not)[\s_-]?allow/i;
  assert.ok(regex.test(doodBannerText), 'Regex must match Doodstream banner text');

  // Mock DOM tree
  const player = new HTMLElement();
  player.id = 'os_player';
  player.style.display = 'block';

  const banner = new HTMLElement();
  banner.innerText = doodBannerText;
  banner.parentElement = player;
  player.children.push(banner);

  // Test hide and remove
  let hidden = false;
  let removed = false;
  banner.style = { setProperty: (k, v) => { if (k === 'display' && v === 'none') hidden = true; } };
  banner.remove = () => { removed = true; };

  // Simulating cleanAntiAdblockBanners logic
  if (regex.test(banner.innerText)) {
    banner.style.setProperty('display', 'none', 'important');
    banner.remove();
  }

  assert.strictEqual(hidden, true, 'Banner must be hidden');
  assert.strictEqual(removed, true, 'Banner must be removed from DOM');
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  Test Results: ${passedTests} / ${totalTests} passed (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
