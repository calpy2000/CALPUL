// Blocks a page from being used at all unless it was launched from the
// device's Home Screen icon (an installed PWA) rather than a normal browser
// tab, bookmark, or typed/shared URL. Reason: testers playing in a plain
// browser tab get a meaningfully different — and on iPhone, sometimes
// broken — layout than the installed/standalone experience the site is
// actually built for (Safari's own address bar/toolbar chrome eats into the
// viewport and changes safe-area insets in ways standalone mode doesn't
// have), so "installed" needs to be a hard requirement, not a suggestion in
// welcome.html that testers can skip past.
//
// display-mode:standalone (Android/Chrome/desktop PWAs) and
// navigator.standalone (iOS Safari's own non-standard equivalent) are real,
// browser-reported facts about how THIS page was launched, not a flag
// client code sets — unlike every other client-side gate on this site
// (beta-gate's tester code, sessionStorage-style checks), there's no value
// a tester could type or a link they could construct to talk their way past
// this one. A plain in-browser visit and an installed-icon launch are
// genuinely different browser states.
//
// Call requireStandalone() as the very first statement in every page's own
// entry script (hub's index.js and every game's index.js), before any
// other work — imports aside, nothing else in that file should run for a
// tab that's about to be blocked anyway. Resolves immediately (a no-op)
// once launched from the Home Screen icon; otherwise shows a full-page
// blocking message and never resolves, same "never resolves — a real
// navigation replaces the page instead of revealing content in place"
// idiom beta-gate.js uses.
//
// Skipped entirely when TOOL_MODE is 'dev' — local testing (e.g. a plain
// browser tab against a local server) would otherwise hit this same block
// screen every time, which is exactly what 'dev' mode already exists to
// avoid for other things (the fuller dev panel, etc.). Safe by
// construction, not just by convention: tool-mode.js's own hard rule is
// that nothing is ever pushed while TOOL_MODE is 'dev', so this bypass can
// never reach a real tester or player — only 'test'/'off' pushes do, and
// both of those still enforce the gate exactly as before.
//
// --- Why this shows a device/browser PICKER, not just static instructions ---
// A real tester (iPhone 14 Pro, 2026-08-22) got stuck because their default
// browser was Chrome, not Safari — Chrome's real "Share" icon sits top-right
// next to the address bar, not in the overflow menu, and Chrome's own menu
// has a same-sounding "Share Chrome" decoy (shares the Chrome app itself)
// that they tapped by mistake. Safari vs. Chrome vs. Samsung Internet all
// have genuinely different install flows (different icon, different menu,
// different wording) — not just different phrasing of the same steps — so
// one static "what to do" block per OS was never going to cover everyone.
// The picker auto-guesses OS + browser from the UA (best-effort, coarse by
// design) and shows a confirmation line + two dropdowns so a tester whose
// browser was misdetected (or who's on something we don't specifically
// support) can correct it themselves rather than being stuck on wrong steps
// with no way out.

import { hidePageLoadingIndicator } from './loading-indicator.js';
import { getToolMode } from './tool-mode.js';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

// Builds its own <style> tag at runtime instead of a dedicated CSS file —
// this is the only page that needs these rules, and it saves adding a new
// <link> to all 13 pages that call requireStandalone(). Guarded by id so
// calling this twice (shouldn't happen, but harmless) doesn't duplicate it.
function injectStyles() {
  if (document.getElementById('install-gate-styles')) return;
  const style = document.createElement('style');
  style.id = 'install-gate-styles';
  // Explicit font-family here, not inherited — this overlay is appended
  // straight to <body>, outside any page's .shell, and floating elements
  // outside .shell don't pick up --font-body automatically (see
  // tools-panel.js's own popovers for the same rule).
  style.textContent = `
    .install-gate{position:fixed;inset:0;z-index:2000;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;background:var(--paper,#eef0f3);font-family:var(--font-body,sans-serif);padding:var(--space-lg,24px);text-align:center}
    .install-gate__panel{max-width:380px;width:100%;display:flex;flex-direction:column;align-items:center;gap:var(--space-md,16px);padding-top:var(--space-lg,24px)}
    .install-gate__logo{display:flex;justify-content:center;gap:clamp(4px,2vw,8px);margin:0}
    .install-gate__logo-tile-wrap{--tilt:0deg;display:inline-flex;transform:rotate(var(--tilt))}
    .install-gate__logo-tile{--letter-rotate:0deg;--flip-x:1;width:clamp(28px,8vw,40px);height:clamp(28px,8vw,40px);border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:clamp(16px,4.5vw,22px);color:#ffffff;box-shadow:inset 2px 2px 4px rgba(255,255,255,0.5),inset -2px -3px 5px rgba(0,0,0,0.28);transform:scaleX(var(--flip-x)) rotate(var(--letter-rotate))}
    .install-gate__logo-tile.is-mirrored{--flip-x:-1}
    .install-gate__logo-tile.is-upside-down{--letter-rotate:180deg}
    .install-gate__title{font-size:1.25rem;font-weight:700;color:var(--ink,#1b1f27);margin:0;line-height:1.3}
    .install-gate__body{font-size:0.95rem;line-height:1.5;color:var(--ink,#1b1f27);margin:0;opacity:0.85}
    .install-gate__detect{width:100%;text-align:left;background:#fff;border-radius:14px;padding:var(--space-md,16px);box-shadow:0 1px 3px rgba(0,0,0,0.08);display:flex;flex-direction:column;gap:var(--space-sm,10px)}
    .install-gate__detect-line{font-size:0.88rem;line-height:1.45;color:var(--ink,#1b1f27);opacity:0.85;margin:0}
    .install-gate__pickers{display:flex;gap:var(--space-sm,10px);width:100%;flex-wrap:wrap}
    .install-gate__picker{flex:1 1 130px;display:flex;flex-direction:column;gap:4px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--ink,#1b1f27);opacity:0.6}
    .install-gate__picker select{font-family:inherit;font-size:0.92rem;font-weight:600;text-transform:none;letter-spacing:normal;color:var(--ink,#1b1f27);padding:9px 10px;border-radius:10px;border:1px solid rgba(0,0,0,0.15);background:#fff;opacity:1}
    .install-gate__steps-block{width:100%;text-align:left;background:#fff;border-radius:14px;padding:var(--space-md,16px) var(--space-md,16px) var(--space-md,16px) 2.1em;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
    .install-gate__steps-heading{font-size:0.75rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--accent,#3d5af1);margin:0 0 var(--space-sm,8px) -0.6em}
    .install-gate__steps{margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-sm,10px)}
    .install-gate__steps li{display:flex;align-items:center;gap:8px;font-size:0.95rem;line-height:1.35;color:var(--ink,#1b1f27)}
    .install-gate__steps + .install-gate__steps-heading{margin-top:var(--space-md,16px)}
    .install-gate__step-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(61,90,241,0.12);color:var(--accent,#3d5af1)}
    .install-gate__step-note{font-size:0.82rem;line-height:1.4;color:var(--ink,#1b1f27);opacity:0.7;margin:var(--space-sm,8px) 0 0}
    .install-gate__step-note + .install-gate__step-note{margin-top:var(--space-xs,6px)}
    .install-gate__preview{display:flex;flex-direction:column;align-items:center;gap:var(--space-xs,4px);background:#dfe3ea;border-radius:16px;padding:var(--space-md,16px) var(--space-lg,24px)}
    .install-gate__preview-tile{width:60px;height:60px;border-radius:15px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.25)}
    .install-gate__preview-tile.is-circle{border-radius:50%}
    .install-gate__preview-tile img{width:100%;height:100%;display:block;object-fit:cover}
    .install-gate__preview-label{font-size:0.72rem;color:var(--ink,#1b1f27);opacity:0.8}
    .install-gate__preview-caption{font-size:0.78rem;line-height:1.4;color:var(--ink,#1b1f27);opacity:0.55;margin:0}
    .install-gate__note{font-size:0.8rem;line-height:1.4;color:var(--ink,#1b1f27);opacity:0.55;margin:0}
  `;
  document.head.appendChild(style);
}

// Resolves relative to THIS file's own location (shared/core/), not
// whichever page imported it — same trick beta-gate.js uses for
// testers.json — so these always point at the hub root's own files
// regardless of whether the caller is the hub itself or a game two
// folders down.
function siteUrl(path) {
  return new URL(`../../${path}`, import.meta.url).href;
}

// --- Detection (best-effort — the picker exists precisely so a wrong guess
// here is a minor annoyance, not a dead end) ---

// Only two device buckets: what actually changes the install STEPS is the
// browser, not the phone brand — a Samsung phone running plain Chrome uses
// the exact same steps as any other Android/Chrome combo. Device only
// exists to constrain which browsers are even offered as valid choices.
function detectDevice() {
  const ua = window.navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'ios'; // unrecognized UA — has to default to something; tester can switch
}

function detectBrowser(device) {
  const ua = window.navigator.userAgent || '';
  if (device === 'ios') return /CriOS/.test(ua) ? 'chrome' : 'safari';
  if (device === 'android') return /SamsungBrowser/.test(ua) ? 'samsung' : 'chrome';
  return 'safari';
}

// Apple only extended the Home Screen share-sheet action to third-party
// browsers from iOS 16.4 onward — below that, Chrome on iPhone genuinely
// cannot produce a working standalone launch, no matter how carefully the
// steps are followed, so that case needs a different message ("use Safari
// instead"), not just different tap targets. Returns false (assume modern)
// when the version can't be parsed at all — a wrongly-shown warning on a
// misread UA is worse than occasionally missing a real old-iOS case.
function isTooOldForChromeInstall() {
  const ua = window.navigator.userAgent || '';
  const m = ua.match(/OS (\d+)_(\d+)/);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major < 16 || (major === 16 && minor < 4);
}

const DEVICE_OPTIONS = [
  { value: 'ios', label: 'iPhone' },
  { value: 'android', label: 'Android phone' },
];

const BROWSER_OPTIONS = {
  ios: [
    { value: 'safari', label: 'Safari' },
    { value: 'chrome', label: 'Chrome' },
  ],
  android: [
    { value: 'chrome', label: 'Chrome' },
    { value: 'samsung', label: 'Samsung Internet' },
    { value: 'unsure', label: 'Not sure / something else' },
  ],
};

function deviceLabel(device) {
  const found = DEVICE_OPTIONS.find((o) => o.value === device);
  return found ? found.label : 'phone';
}

function browserLabel(device, browser) {
  const found = (BROWSER_OPTIONS[device] || []).find((o) => o.value === browser);
  return found ? found.label : 'your browser';
}

// Small inline glyphs (not real Apple/Google icon assets — plain SVG
// approximations) so a tester can visually match what they're looking for
// on their own screen, not just read a name. currentColor lets each pick up
// .install-gate__step-icon's own color via CSS rather than being hardcoded.
const SHARE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.5 7.5L12 3l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/></svg>`;

function stepIcon(svg) {
  return `<span class="install-gate__step-icon">${svg}</span>`;
}

const SAFARI_STEPS = `
  <p class="install-gate__steps-heading">What to do (iPhone, Safari)</p>
  <ol class="install-gate__steps">
    <li>${stepIcon(SHARE_ICON_SVG)}<span>Look near the address bar for the <strong>Share</strong> icon (a square with an arrow pointing up) and tap it — on some iPhones you'll need to tap the <strong>&#8226;&#8226;&#8226;</strong> "More" icon first to find it</span></li>
    <li><span>Scroll down and tap <strong>"Add to Home Screen"</strong></span></li>
  </ol>
  <p class="install-gate__step-note">Don't tap <strong>"Add Bookmark"</strong> at any point — that's a different option nearby, and it won't create a working Home Screen icon.</p>
`;

// Confirmed working end-to-end by a real tester (iPhone 14 Pro) on
// 2026-08-22 — Chrome's Share icon sits top-right next to the address bar
// (not the bottom toolbar, and not inside Chrome's own "..." overflow menu,
// which only has an unrelated "Share Chrome" item that shares the Chrome
// app itself). The "View More" tap is a real extra step this flow needs
// that Safari's doesn't.
const CHROME_IOS_STEPS = `
  <p class="install-gate__steps-heading">What to do (iPhone, Chrome)</p>
  <ol class="install-gate__steps">
    <li>${stepIcon(SHARE_ICON_SVG)}<span>Tap the <strong>Share</strong> icon (a square with an arrow pointing up) at the <strong>top right</strong> of the screen, next to the address bar</span></li>
    <li><span>Tap <strong>"View More"</strong> (the icon with a chevron, at the bottom right of the panel that pops up)</span></li>
    <li><span>Scroll down and tap <strong>"Add to Home Screen"</strong></span></li>
    <li><span>Tap the blue <strong>"Add"</strong> button, top right</span></li>
  </ol>
  <p class="install-gate__step-note">Don't tap <strong>"Add to bookmarks"</strong> at any point — that's a different option nearby, and it won't create a working Home Screen icon.</p>
  <p class="install-gate__step-note">Don't tap <strong>"Share Chrome"</strong> from Chrome's <strong>&#8942;</strong> menu — that shares the Chrome app itself, not this page, and is easy to tap by mistake while looking for Share.</p>
`;

const CHROME_IOS_TOO_OLD_STEPS = `
  <p class="install-gate__steps-heading">What to do (iPhone, Chrome)</p>
  <p class="install-gate__step-note">Chrome can only create a working PUSULZ icon on iOS 16.4 or later, and your iPhone looks to be on an older version. Please switch <strong>"Browser"</strong> above to <strong>Safari</strong> instead — same link, same result, just a different app to open it in.</p>
`;

const CHROME_ANDROID_STEPS = `
  <p class="install-gate__steps-heading">What to do (Android, Chrome)</p>
  <ol class="install-gate__steps">
    <li><span>Tap the <strong>&#8942;</strong> menu (three dots, top-right of Chrome)</span></li>
    <li><span>Scroll down and tap <strong>"Add to Home screen"</strong> — on newer Chrome this is called <strong>"Install and create shortcut"</strong> instead, or you might see <strong>"Install app"</strong></span></li>
    <li><span>Confirm with <strong>"Add"</strong> or <strong>"Install"</strong></span></li>
  </ol>
  <p class="install-gate__step-note">If Chrome shows its own pop-up suggesting you install PUSULZ before you even get to the menu, you can tap that instead — same result.</p>
  <p class="install-gate__step-note">Don't see any of these options in the menu? Fully close Chrome (swipe it away from your recent apps, don't just go back), reopen this link, wait a few seconds for the page to finish loading, then check the menu again.</p>
`;

// Not yet confirmed against a real device the way the Chrome flows above
// were — based on published documentation of Samsung Internet's menu, not
// hands-on testing. Worth tightening up the wording if a real Samsung
// Internet tester reports back, same way the Chrome-iOS steps got fixed.
const SAMSUNG_INTERNET_STEPS = `
  <p class="install-gate__steps-heading">What to do (Samsung Internet)</p>
  <ol class="install-gate__steps">
    <li><span>Tap the menu icon (three lines, usually at the bottom right of the screen)</span></li>
    <li><span>Tap <strong>"Add page to"</strong></span></li>
    <li><span>Tap <strong>"Home screen"</strong></span></li>
    <li><span>Confirm with <strong>"Add"</strong></span></li>
  </ol>
  <p class="install-gate__step-note">Don't see "Add page to"? Look for "Add to" or something similar — the exact wording can vary a little by Samsung Internet version.</p>
`;

const ANDROID_UNSURE_STEPS = `
  <p class="install-gate__body" style="opacity:0.7;font-size:0.85rem;margin-bottom:4px">Not sure which browser you're using? Here's both of the common ones — try whichever matches your screen:</p>
  ${CHROME_ANDROID_STEPS}
  ${SAMSUNG_INTERNET_STEPS}
`;

function stepsHtml(device, browser) {
  if (device === 'ios') {
    if (browser === 'chrome') return isTooOldForChromeInstall() ? CHROME_IOS_TOO_OLD_STEPS : CHROME_IOS_STEPS;
    return SAFARI_STEPS;
  }
  if (browser === 'samsung') return SAMSUNG_INTERNET_STEPS;
  if (browser === 'unsure') return ANDROID_UNSURE_STEPS;
  return CHROME_ANDROID_STEPS;
}

// iOS reads the Home Screen icon from <link rel="apple-touch-icon">, not
// the web manifest's icons array (which Android/Chrome uses instead) — see
// each page's own <head> for both tags. Different files, so the preview
// uses whichever one that platform will actually show, not the same image
// for both.
// Android's own adaptive-icon system pads/crops a plain 'any'-purpose icon
// unpredictably (confirmed against a real device 2026-08-22 — the tilted
// tile ended up shrunk inside a padded circle rather than filling it), so
// the preview here shows the same maskable artwork manifest.json's
// "purpose": "maskable" entries point at (full-bleed background, glyph
// safely inside the mask's safe zone) — not the plain icon-192.png used for
// non-adaptive-icon contexts.
function tileIconPath(device) {
  if (device === 'ios') return 'apple-touch-icon.png';
  return 'icon-192-maskable.png';
}

function browserOptionsHtml(device, selected) {
  return (BROWSER_OPTIONS[device] || [])
    .map((o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`)
    .join('');
}

function showGate() {
  return new Promise(() => {
    hidePageLoadingIndicator();
    injectStyles();

    let device = detectDevice();
    let browser = detectBrowser(device);

    const gate = document.createElement('div');
    gate.className = 'install-gate';
    gate.innerHTML = `
      <div class="install-gate__panel">
        <div class="install-gate__logo">
          <span class="install-gate__logo-tile-wrap" style="--tilt: -22deg"><span class="install-gate__logo-tile is-mirrored" style="background:#E59A63">P</span></span>
          <span class="install-gate__logo-tile-wrap" style="--tilt: 18deg"><span class="install-gate__logo-tile" style="background:#6F9BDB">U</span></span>
          <span class="install-gate__logo-tile-wrap" style="--tilt: -27deg"><span class="install-gate__logo-tile is-mirrored" style="background:#63B98A">S</span></span>
          <span class="install-gate__logo-tile-wrap" style="--tilt: 16deg"><span class="install-gate__logo-tile" style="background:#AD82D6">U</span></span>
          <span class="install-gate__logo-tile-wrap" style="--tilt: 24deg"><span class="install-gate__logo-tile" style="background:#DFAE55">L</span></span>
          <span class="install-gate__logo-tile-wrap" style="--tilt: -19deg"><span class="install-gate__logo-tile is-upside-down" style="background:#DD7FA3">Z</span></span>
        </div>
        <h1 class="install-gate__title">Welcome to Beta Testing</h1>
        <p class="install-gate__body">Whether you're new to PUSULZ or an old hand - it is key to access the games by creating a <strong>PUSULZ app tile</strong> on your phone - this means that you get the best player experience on your screen.<br>So go ahead and create that PUSULZ tile now using the instructions below, its really easy.</p>
        <div class="install-gate__detect">
          <p class="install-gate__detect-line" id="install-gate-detect-line"></p>
          <div class="install-gate__pickers">
            <label class="install-gate__picker">
              <span>Phone</span>
              <select id="install-gate-device-select">
                ${DEVICE_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
              </select>
            </label>
            <label class="install-gate__picker">
              <span>Browser</span>
              <select id="install-gate-browser-select"></select>
            </label>
          </div>
        </div>
        <div class="install-gate__steps-block" id="install-gate-steps-block"></div>
        <p class="install-gate__body">When this is done, you'll see a tile on your <span id="install-gate-device-name">phone</span> that looks like this:</p>
        <div class="install-gate__preview">
          <div class="install-gate__preview-tile" id="install-gate-preview-tile"><img id="install-gate-preview-img" src="" alt=""></div>
          <span class="install-gate__preview-label">PUSULZ</span>
        </div>
        <p class="install-gate__body">Simply tap that tile every day to access PUSULZ.</p>
        <p class="install-gate__body">The first time you tap the tile, you will need to enter your <strong>6-letter user code</strong> that was sent to you by WhatsApp — so make sure you have this handy.</p>
        <p class="install-gate__note">Already installed? Close this tab and open PUSULZ from its icon instead.</p>
      </div>
    `;
    document.body.appendChild(gate);

    const $deviceSelect = document.getElementById('install-gate-device-select');
    const $browserSelect = document.getElementById('install-gate-browser-select');
    const $detectLine = document.getElementById('install-gate-detect-line');
    const $stepsBlock = document.getElementById('install-gate-steps-block');
    const $deviceName = document.getElementById('install-gate-device-name');
    const $previewImg = document.getElementById('install-gate-preview-img');
    const $previewTile = document.getElementById('install-gate-preview-tile');

    function render() {
      $deviceSelect.value = device;
      $browserSelect.innerHTML = browserOptionsHtml(device, browser);
      $detectLine.innerHTML = `The steps below are for <strong>${browserLabel(device, browser)}</strong> on an <strong>${deviceLabel(device)}</strong>. If that's not what you're using, change it here:`;
      $stepsBlock.innerHTML = stepsHtml(device, browser);
      $deviceName.textContent = deviceLabel(device);
      $previewImg.src = siteUrl(tileIconPath(device));
      // Most Android launchers (Pixel's stock one included, confirmed
      // against a real device 2026-08-22) mask icons into a circle, unlike
      // iOS's consistent rounded square — the preview shape needs to match
      // whichever platform is currently selected, not just the artwork.
      $previewTile.classList.toggle('is-circle', device === 'android');
    }

    $deviceSelect.addEventListener('change', () => {
      device = $deviceSelect.value;
      // Keep the same browser choice across the switch when it's still a
      // valid option for the new device (e.g. Chrome stays Chrome); only
      // fall back to that device's first option when it isn't (e.g.
      // Samsung Internet doesn't exist on iPhone).
      const stillValid = (BROWSER_OPTIONS[device] || []).some((o) => o.value === browser);
      if (!stillValid) browser = BROWSER_OPTIONS[device][0].value;
      render();
    });

    $browserSelect.addEventListener('change', () => {
      browser = $browserSelect.value;
      render();
    });

    render();
  });
}

export async function requireStandalone() {
  if (getToolMode() === 'dev') return;
  if (isStandalone()) return;
  await showGate();
}
