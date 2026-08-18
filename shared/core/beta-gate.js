// Full-screen entry-code gate shown before the hub loads, for the private
// beta only — up to 50 testers, each with a unique 6-letter code (see
// testers.json at the hub root, distributed manually, no encryption). Once
// a tester enters a valid code it's saved to localStorage, so they never
// have to re-enter it on that device — only clearing local storage (or the
// dev panel's "Reset tester code" button, see tools-panel.js) makes the
// gate show again.
//
// Note: iOS gives a standalone home-screen web app (see index.html's own
// apple-mobile-web-app-capable tag) its OWN isolated storage container,
// separate from regular Safari, from its very first launch — so a tester
// always re-enters their code once when first opening their home-screen
// tile, even right after entering it in Safari. This is a fixed iOS
// platform behaviour (confirmed: the tile launches via the web app
// manifest's start_url, not whatever URL was open when it was created) —
// no client-side fix is possible, so welcome.html sets this expectation
// up front instead. tryCodeFromUrl() below still has a real purpose
// though: it lets a tester log in silently via a shared link with their
// code baked in (e.g. .../?code=ABC123, used in WhatsApp invites).
//
// Hub-only: nothing here is imported by any individual game page, so a
// tester who's already past the hub never sees this again mid-game.
//
// Skipped entirely when TOOL_MODE is 'dev' — same reasoning and same
// safety net as install-gate.js's own dev-mode bypass: local testing
// shouldn't need a stored/typed code every time, and this can never reach
// a real tester since nothing is ever pushed while TOOL_MODE is 'dev'.

import { showPageLoadingIndicator, hidePageLoadingIndicator, yieldForPaint, reloadWithSpinner } from './loading-indicator.js';
import { getToolMode } from './tool-mode.js';

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

// Shows the gate. Deliberately never resolves on success — see the submit
// handler's own comment on reloadWithSpinner(): a valid code triggers a
// real page reload instead, so initBetaGate() (and index.js's own await on
// it) just stays paused here until that reload replaces the page, rather
// than resolving into an in-place hub reveal.
function showGate() {
  return new Promise(() => {
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
      // See loading-indicator.js's own comment on yieldForPaint(): without
      // this, the disabled input/button and the spinner just added above
      // can both silently never make it to the screen before the fetch
      // below starts — a real on-device freeze, not just a missing spinner.
      await yieldForPaint();

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
      // Deliberately reloads instead of hiding the spinner and resolving
      // in place — a real on-device trace proved every step of the
      // in-place path (hide spinner, resolve, reveal the hub, render
      // tiles) WAS completing successfully, all within ~400ms, but WebKit
      // never painted any of it until a manual refresh. The one thing
      // every OTHER working case on this site has in common that this
      // in-place path doesn't: a real navigation. reloadWithSpinner()
      // (already proven reliable everywhere else — see its own comment)
      // re-runs this page from scratch; getStoredTester() will find the
      // code we just saved and skip straight past the gate into a
      // normally-painted hub, no in-place reveal involved at all.
      reloadWithSpinner();
    });
  });
}

// Silently checks a ?code=XXXXXX URL param against testers.json and saves
// it exactly like a typed submission would, WITHOUT ever showing the gate
// form — lets a tester log straight in via a shared link with their code
// baked in (e.g. a WhatsApp invite to .../?code=ABC123). Returns true if a
// valid code was found and saved, false otherwise (missing param, bad
// code, or the fetch failing) — either way, the caller falls back to the
// normal gate.
async function tryCodeFromUrl() {
  const url = new URL(window.location.href);
  const entered = url.searchParams.get('code');
  if (!entered) return false;

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

  // Clean the code back out of the address bar now that it's saved — no
  // reason to leave a tester's code sitting in the visible URL/history.
  url.searchParams.delete('code');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);

  // Reloads instead of returning true — same reasoning as showGate()'s own
  // submit handler (see its comment): this success path is ALSO a
  // fetch-then-reveal sequence, and letting the caller (initBetaGate())
  // return normally here would hand control back to index.js's own
  // in-place hub reveal, the exact pattern proven unreliable. Returning a
  // Promise that never resolves keeps initBetaGate() (and everything
  // after it in index.js) paused here for good — harmless, since the page
  // is about to be replaced by the reload anyway.
  reloadWithSpinner();
  return new Promise(() => {});
}

// Call once, at the top of the hub's own index.js (only the hub — no game
// page imports this). Resolves immediately (synchronously, in practice) if
// a code is already stored on this device — the normal case on every
// return visit. Otherwise shows the gate (or silently checks a
// ?code=XXXXXX URL param first — see tryCodeFromUrl()) and, on a VALID
// code, triggers a real page reload rather than ever resolving — see
// showGate()'s own comment for why.
export async function initBetaGate() {
  if (getToolMode() === 'dev') return;
  if (getStoredTester()) return;
  if (await tryCodeFromUrl()) return;
  await showGate();
}
