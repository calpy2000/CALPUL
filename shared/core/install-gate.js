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

import { hidePageLoadingIndicator } from './loading-indicator.js';

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
    .install-gate__steps{margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-sm,8px)}
    .install-gate__steps li{font-size:0.95rem;line-height:1.4;color:var(--ink,#1b1f27)}
    .install-gate__steps + .install-gate__steps-heading{margin-top:var(--space-md,16px)}
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

const IOS_STEPS = `
  <p class="install-gate__steps-heading">On iPhone (Safari)</p>
  <ol class="install-gate__steps">
    <li>Tap the <strong>Share</strong> icon (square with an arrow, along the bottom of the screen)</li>
    <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
    <li>Tap <strong>"Add"</strong> in the top-right</li>
  </ol>
`;

const ANDROID_STEPS = `
  <p class="install-gate__steps-heading">On Android (Chrome)</p>
  <ol class="install-gate__steps">
    <li>Tap the <strong>&#8942;</strong> menu (three dots, top-right of Chrome)</li>
    <li>Tap <strong>"Add to Home screen"</strong> (some phones show <strong>"Install app"</strong> instead)</li>
    <li>Confirm with <strong>"Add"</strong> or <strong>"Install"</strong></li>
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
        <p class="install-gate__body">PUSULZ is built to run as an installed app, not a browser tab — a few games don't display correctly otherwise. Follow the steps below, right here in your browser.</p>
        <div class="install-gate__steps-block">${stepsHtml(platform)}</div>
        <div class="install-gate__preview">
          <div class="install-gate__preview-tile"><img src="${siteUrl(tileIconPath(platform))}" alt=""></div>
          <span class="install-gate__preview-label">PUSULZ</span>
        </div>
        <p class="install-gate__preview-caption">This is what the new icon on your Home Screen will look like — tap it to open PUSULZ from now on.</p>
        <p class="install-gate__note">Already installed? Close this tab and open PUSULZ from its icon instead.</p>
      </div>
    `;
    document.body.appendChild(gate);
  });
}

export async function requireStandalone() {
  if (isStandalone()) return;
  await showGate();
}
