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
    .install-gate{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:var(--paper,#eef0f3);font-family:var(--font-body,sans-serif);padding:var(--space-lg,24px);text-align:center}
    .install-gate__panel{max-width:340px;width:100%;display:flex;flex-direction:column;align-items:center;gap:var(--space-md,16px)}
    .install-gate__icon{width:72px;height:72px;border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.15)}
    .install-gate__title{font-size:1.25rem;font-weight:700;color:var(--ink,#1b1f27);margin:0;line-height:1.3}
    .install-gate__body{font-size:0.95rem;line-height:1.5;color:var(--ink,#1b1f27);margin:0;opacity:0.85}
    .install-gate__link{display:inline-flex;align-items:center;justify-content:center;padding:13px 30px;border-radius:999px;background:var(--accent,#3d5af1);color:var(--accent-contrast,#fff);font-weight:700;font-size:1rem;text-decoration:none;margin-top:var(--space-xs,4px)}
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

function showGate() {
  return new Promise(() => {
    hidePageLoadingIndicator();
    injectStyles();
    const gate = document.createElement('div');
    gate.className = 'install-gate';
    gate.innerHTML = `
      <div class="install-gate__panel">
        <img class="install-gate__icon" src="${siteUrl('icon-192.png')}" alt="">
        <h1 class="install-gate__title">Open PUSULZ from your Home Screen</h1>
        <p class="install-gate__body">PUSULZ is built to run as an installed app, not a browser tab — a few games don't display correctly otherwise. Add it to your Home Screen, then open it from there.</p>
        <a class="install-gate__link" href="${siteUrl('welcome.html')}">See install steps</a>
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
