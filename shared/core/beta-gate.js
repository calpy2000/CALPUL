// Full-screen entry-code gate shown before the hub loads, for the private
// beta only — up to 50 testers, each with a unique 6-letter code (see
// testers.json at the hub root, distributed manually, no encryption). Once
// a tester enters a valid code it's saved to localStorage, so they never
// have to re-enter it on that device — only clearing local storage (or the
// dev panel's "Reset tester code" button, see tools-panel.js) makes the
// gate show again.
//
// One real-world wrinkle localStorage alone doesn't cover: iOS gives a
// standalone home-screen web app (see index.html's own
// apple-mobile-web-app-capable tag) its OWN isolated storage container,
// separate from regular Safari — deleting and re-adding the home-screen
// icon wipes that container, same as reinstalling any app resets its
// data, taking the saved code with it. tryCodeFromUrl() below is the
// workaround: a tester can add PUSULZ to their home screen from a URL
// with their own code baked in (e.g. .../?code=ABC123) so a future
// delete+re-add silently re-authenticates from the icon's own saved URL
// instead of prompting again.
//
// Hub-only: nothing here is imported by any individual game page, so a
// tester who's already past the hub never sees this again mid-game.

import { showPageLoadingIndicator, hidePageLoadingIndicator } from './loading-indicator.js';

const STORAGE_KEY = 'pusulz_tester';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// { name: "Tester 7", code: "ZBGKVQ" }, or null if no code has been entered
// on this device yet (or it was cleared). Exported so feedback.js can credit
// the tester by name in the feedback email — see buildMessage() there.
export function getStoredTester() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // malformed value (shouldn't normally happen) — treat as "no code stored"
  }
}

// Used by the dev panel's "Reset tester code" button (tools-panel.js) to
// force the gate to show again, without needing to manually clear storage.
export function clearStoredTester() {
  localStorage.removeItem(STORAGE_KEY);
}

// Resolves relative to THIS file's own location (shared/core/), not
// index.html's — same trick tools-panel.js uses for feedback.html — so this
// still finds testers.json correctly regardless of where beta-gate.js is
// ever imported from.
async function fetchTesters() {
  const url = new URL('../../testers.json', import.meta.url);
  const res = await fetch(url);
  return res.json();
}

// Schedules the ?code=... param to be stripped from the address bar after
// a delay — shared by both showGate()'s manual-entry success path and
// tryCodeFromUrl() below, for exactly the same reason (see
// tryCodeFromUrl()'s own comment for the full "why delayed, why 60s"
// story). Re-reads window.location.href fresh at fire time (rather than
// capturing a URL object up front) and no-ops if the param is already
// gone, so it's safe to call from multiple places without them stepping
// on each other.
function scheduleCodeStrip() {
  setTimeout(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code')) return;
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, 60000);
}

function buildGatePanel() {
  return el(
    'form',
    'beta-gate__panel',
    `<div class="beta-gate__logo">
       <span class="beta-gate__logo-tile" style="background:#E59A63">P</span>
       <span class="beta-gate__logo-tile" style="background:#6F9BDB">U</span>
       <span class="beta-gate__logo-tile" style="background:#63B98A">S</span>
       <span class="beta-gate__logo-tile" style="background:#AD82D6">U</span>
       <span class="beta-gate__logo-tile" style="background:#DFAE55">L</span>
       <span class="beta-gate__logo-tile" style="background:#DD7FA3">Z</span>
     </div>
     <span class="beta-gate__badge">Beta Testing</span>
     <h1 class="beta-gate__title">Welcome to beta testing</h1>
     <p class="beta-gate__body">To get started, type in the entry code that you should have and hit enter to unlock the game.</p>
     <input class="beta-gate__input" id="beta-gate-input" type="text" inputmode="text" maxlength="6" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false" autofocus>
     <button class="beta-gate__submit" id="beta-gate-submit" type="submit">
       <span class="beta-gate__submit-label">Enter</span>
     </button>
     <p class="beta-gate__error is-hidden" id="beta-gate-error">That code isn't recognized — check for typos and try again.</p>
     <p class="beta-gate__hint">Your code is remembered on this device — you won't need to enter it again.</p>`
  );
}

// Shows the gate and resolves once a valid code has been entered and saved.
function showGate() {
  return new Promise((resolve) => {
    const gate = document.getElementById('beta-gate');
    const panel = buildGatePanel();
    gate.innerHTML = '';
    gate.appendChild(panel);
    gate.classList.remove('is-hidden');

    const input = panel.querySelector('#beta-gate-input');
    const errorMsg = panel.querySelector('#beta-gate-error');
    const submitBtn = panel.querySelector('#beta-gate-submit');

    // Codes are all-caps (see testers.json) — this uppercases as the tester
    // types so e.g. "akglex" still matches "AKGLEX" without them needing to
    // hold shift or hit caps lock themselves.
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase();
    });

    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entered = input.value.trim().toUpperCase();
      if (!entered) return;

      // fetchTesters() is a real network request (testers.json) — on a
      // cold cache/slow connection this is a genuine multi-second wait with
      // nothing else on screen to show for it (the page-load spinner, see
      // loading-indicator.js, is long gone by this point — it's dismissed
      // the moment this page's JS starts running, which is BEFORE this
      // gate even appears). Reuses that SAME full-page centered spinner
      // rather than a separate one built into the button, so a spinner
      // always looks and appears the same way everywhere on the site — the
      // button itself still disables immediately so the tester sees SOMETHING
      // happened the instant they hit Enter, even before the 200ms delay on
      // the overlay's own reveal.
      submitBtn.disabled = true;
      input.disabled = true;
      showPageLoadingIndicator();

      let testers;
      try {
        testers = await fetchTesters();
      } catch (err) {
        hidePageLoadingIndicator();
        submitBtn.disabled = false;
        input.disabled = false;
        errorMsg.textContent = "Couldn't reach the server — check your connection and try again.";
        errorMsg.classList.remove('is-hidden');
        return;
      }
      const match = Object.entries(testers).find(([, code]) => code === entered);

      if (!match) {
        hidePageLoadingIndicator();
        submitBtn.disabled = false;
        input.disabled = false;
        errorMsg.classList.remove('is-hidden');
        input.select();
        return;
      }

      const [name, code] = match;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, code }));

      // Bakes ?code=... onto the CURRENT url — welcome.html's own
      // instructions have the tester do "Add to Home Screen" shortly AFTER
      // landing on the hub, not before, so without this the resulting icon
      // would be created from a plain, code-less URL. A home-screen icon
      // gets its own separate, isolated storage from its very FIRST
      // launch (not just on a later delete+re-add), so with nothing baked
      // into its own saved URL to fall back on, opening it hit that empty
      // container and prompted for the code again immediately — confirmed
      // on a real device. Same delayed strip as tryCodeFromUrl() uses, so
      // it isn't left sitting in the address bar indefinitely.
      const url = new URL(window.location.href);
      url.searchParams.set('code', code);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      scheduleCodeStrip();

      hidePageLoadingIndicator();
      gate.classList.add('is-hidden');
      gate.innerHTML = '';
      resolve();
    });
  });
}

// Silently checks a ?code=XXXXXX URL param against testers.json and saves
// it exactly like a typed submission would, WITHOUT ever showing the gate
// form — this is what lets a tester's home-screen icon survive iOS wiping
// its isolated storage on a delete+re-add (see initBetaGate()'s own
// comment): if the icon's own target URL has their code baked in, opening
// it re-authenticates automatically instead of prompting for the code
// again. Returns true if a valid code was found and saved, false
// otherwise (missing param, bad code, or the fetch failing) — either way,
// the caller falls back to the normal gate.
async function tryCodeFromUrl() {
  const url = new URL(window.location.href);
  const entered = url.searchParams.get('code');
  if (!entered) return false;

  // Strips the code out of the visible/bookmarkable address bar URL —
  // replaceState, not a real navigation, so this doesn't add a history
  // entry or reload anything. The code stays effective for THIS load
  // either way; this purely keeps it from lingering on-screen indefinitely.
  //
  // Deliberately DELAYED (not immediate, see scheduleCodeStrip() above) —
  // a tester doing "Add to Home Screen" shortly after this URL resolves
  // needs the address bar to STILL have ?code=... on it at that moment, or
  // the icon they create won't have it baked into ITS OWN saved target
  // URL, which is what lets a future delete+re-add (which wipes iOS's
  // isolated storage for standalone apps) silently re-authenticate instead
  // of prompting for the code again. An immediate strip closed that window
  // before anyone could realistically get through the Share-icon flow.
  // Accepted as a low-risk tradeoff, per the user's explicit call — the
  // whole codebook (testers.json) is already public/unencrypted, so a code
  // visible in the address bar/history for an extra minute isn't a
  // meaningful new exposure on top of that.
  scheduleCodeStrip();

  let testers;
  try {
    testers = await fetchTesters();
  } catch {
    return false; // network hiccup — just fall through to the normal gate rather than blocking on it
  }
  const match = Object.entries(testers).find(([, code]) => code === entered.trim().toUpperCase());
  if (!match) return false;

  const [name, code] = match;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, code }));
  return true;
}

// Call once, at the top of the hub's own index.js (only the hub — no game
// page imports this). Resolves immediately if a code is already stored (or
// a valid ?code=XXXXXX URL param silently re-establishes one — see
// tryCodeFromUrl()); otherwise shows the gate and resolves once the tester
// enters a valid one.
export async function initBetaGate() {
  if (getStoredTester()) return;
  if (await tryCodeFromUrl()) return;
  await showGate();
}
