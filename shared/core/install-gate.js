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
    .install-gate__icon{width:72px;height:72px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.15)}
    .install-gate__title{font-size:1.25rem;font-weight:700;color:var(--ink,#1b1f27);margin:0;line-height:1.3}
    .install-gate__body{font-size:0.95rem;line-height:1.5;color:var(--ink,#1b1f27);margin:0;opacity:0.85}
    .install-gate__steps-block{width:100%;text-align:left;background:#fff;border-radius:14px;padding:var(--space-md,16px) var(--space-md,16px) var(--space-md,16px) 2.1em;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
    .install-gate__steps-heading{font-size:0.75rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--accent,#3d5af1);margin:0 0 var(--space-sm,8px) -0.6em}
    .install-gate__steps{margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-sm,10px)}
    .install-gate__steps li{display:flex;align-items:center;gap:8px;font-size:0.95rem;line-height:1.35;color:var(--ink,#1b1f27)}
    .install-gate__steps + .install-gate__steps-heading{margin-top:var(--space-md,16px)}
    .install-gate__step-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(61,90,241,0.12);color:var(--accent,#3d5af1)}
    .install-gate__step-note{font-size:0.82rem;line-height:1.4;color:var(--ink,#1b1f27);opacity:0.7;margin:var(--space-sm,8px) 0 0}
    .install-gate__preview{display:flex;flex-direction:column;align-items:center;gap:var(--space-xs,4px);background:#dfe3ea;border-radius:16px;padding:var(--space-md,16px) var(--space-lg,24px)}
    .install-gate__preview-tile{width:60px;height:60px;border-radius:15px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.25)}
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

// Coarse but sufficient for choosing which install steps to show — doesn't
// need to be bulletproof (a misdetected device just sees both platforms'
// steps instead of one), only good enough to skip showing Android menu
// instructions to an iPhone and vice versa.
function detectPlatform() {
  const ua = window.navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

// Small inline glyphs (not real Apple/Google icon assets — plain SVG
// approximations) so a tester can visually match what they're looking for
// on their own screen, not just read a name. currentColor lets each pick up
// .install-gate__step-icon's own color via CSS rather than being hardcoded.
const MORE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><circle cx="7.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="16.5" cy="12" r="1.4" fill="currentColor"/></svg>`;
const SHARE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.5 7.5L12 3l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/></svg>`;

function stepIcon(svg) {
  return `<span class="install-gate__step-icon">${svg}</span>`;
}

const IOS_STEPS = `
  <p class="install-gate__steps-heading">What to do (iPhone, Safari)</p>
  <ol class="install-gate__steps">
    <li>${stepIcon(MORE_ICON_SVG)}<span>Tap the <strong>&#8226;&#8226;&#8226;</strong> icon next to the address bar, at the bottom right of this page below</span></li>
    <li>${stepIcon(SHARE_ICON_SVG)}<span>Tap the <strong>Share</strong> icon</span></li>
    <li><span>Scroll down and tap <strong>"Add to Home Screen"</strong></span></li>
  </ol>
  <p class="install-gate__step-note">Don't tap <strong>"Add Bookmark"</strong> at any point — that's a different option nearby, and it won't create a working Home Screen icon.</p>
`;

const ANDROID_STEPS = `
  <p class="install-gate__steps-heading">What to do (Android, Chrome)</p>
  <ol class="install-gate__steps">
    <li><span>Tap the <strong>&#8942;</strong> menu (three dots, top-right of Chrome)</span></li>
    <li><span>Tap <strong>"Add to Home screen"</strong> (some phones show <strong>"Install app"</strong> instead)</span></li>
    <li><span>Confirm with <strong>"Add"</strong> or <strong>"Install"</strong></span></li>
  </ol>
  <p class="install-gate__step-note">If Chrome shows its own pop-up suggesting you install PUSULZ before you even get to the menu, you can tap that instead — same result.</p>
`;

function stepsHtml(platform) {
  if (platform === 'ios') return IOS_STEPS;
  if (platform === 'android') return ANDROID_STEPS;
  return IOS_STEPS + ANDROID_STEPS; // unrecognized device — show both rather than guess wrong
}

// iOS reads the Home Screen icon from <link rel="apple-touch-icon">, not
// the web manifest's icons array (which Android/Chrome uses instead) — see
// each page's own <head> for both tags. Different files, so the preview
// uses whichever one that platform will actually show, not the same image
// for both.
function tileIconPath(platform) {
  return platform === 'ios' ? 'apple-touch-icon.png' : 'icon-192.png';
}

function deviceLabel(platform) {
  if (platform === 'ios') return 'iPhone';
  if (platform === 'android') return 'Android phone';
  return 'phone';
}

function showGate() {
  return new Promise(() => {
    hidePageLoadingIndicator();
    injectStyles();
    const platform = detectPlatform();
    const gate = document.createElement('div');
    gate.className = 'install-gate';
    gate.innerHTML = `
      <div class="install-gate__panel">
        <img class="install-gate__icon" src="${siteUrl('icon-192.png')}" alt="">
        <h1 class="install-gate__title">Add PUSULZ to your Home Screen</h1>
        <p class="install-gate__body">Testers, I can tell you're still accessing PUSULZ by tapping a link or typing the address (URL) directly. While the games do work that way, the page ends up squashed, which is a problem for some games. To fix this, we need to add a PUSULZ tile to your Home Screen — then you just tap that every day to play.</p>
        <div class="install-gate__steps-block">${stepsHtml(platform)}</div>
        <p class="install-gate__body">When this is done, you'll see a tile on your ${deviceLabel(platform)} that looks like this:</p>
        <div class="install-gate__preview">
          <div class="install-gate__preview-tile"><img src="${siteUrl(tileIconPath(platform))}" alt=""></div>
          <span class="install-gate__preview-label">PUSULZ</span>
        </div>
        <p class="install-gate__body">Simply tap that tile every day to access PUSULZ.</p>
        <p class="install-gate__body">The first time you tap the tile, you will need to enter your 6-letter user code that was sent to you by WhatsApp — so make sure you have this handy.</p>
        <p class="install-gate__note">Already installed? Close this tab and open PUSULZ from its icon instead.</p>
      </div>
    `;
    document.body.appendChild(gate);
  });
}

export async function requireStandalone() {
  if (getToolMode() === 'dev') return;
  if (isStandalone()) return;
  await showGate();
}
