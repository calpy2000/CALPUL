// Full-screen entry-code gate shown before the hub loads, for the private
// beta only — up to 50 testers, each with a unique 6-letter code (see
// testers.json at the hub root, distributed manually, no encryption). Once
// a tester enters a valid code it's saved to localStorage, so they never
// have to re-enter it on that device — only clearing local storage (or the
// dev panel's "Reset tester code" button, see tools-panel.js) makes the
// gate show again.
//
// Hub-only: nothing here is imported by any individual game page, so a
// tester who's already past the hub never sees this again mid-game.

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
     <button class="beta-gate__submit" type="submit">Enter</button>
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

      const testers = await fetchTesters();
      const match = Object.entries(testers).find(([, code]) => code === entered);

      if (!match) {
        errorMsg.classList.remove('is-hidden');
        input.select();
        return;
      }

      const [name, code] = match;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, code }));
      gate.classList.add('is-hidden');
      gate.innerHTML = '';
      resolve();
    });
  });
}

// Call once, at the top of the hub's own index.js (only the hub — no game
// page imports this). Resolves immediately if a code is already stored;
// otherwise shows the gate and resolves once the tester enters a valid one.
export async function initBetaGate() {
  if (getStoredTester()) return;
  await showGate();
}
