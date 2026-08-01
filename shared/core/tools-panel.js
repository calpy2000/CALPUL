// Injects the floating gear-icon panel used for both dev tools (build-time
// testing convenience) and tester tools (given to real testers for their
// daily play) — which one shows, if either, is decided entirely by
// getToolMode() (see tool-mode.js, where TOOL_MODE is set). Set to 'off',
// this injects nothing at all — the real-player experience.
//
// Call once per page with the ids of the games this panel's "reset today"
// button should act on.

import { clearProgress, clearAllData } from './game-storage.js';
import { getToolMode } from './tool-mode.js';
import { APP_VERSION } from './app-version.js';
import { reloadWithSpinner, navigateWithSpinner } from './loading-indicator.js';

// Same small DOM-building helper used in shell.js and flip-timer.js — see
// the longer explanation in shell.js if you haven't read that one yet.
function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// Builds the URL to the full feedback page (shared/feedback.html — see that
// file for the actual form). `new URL('../feedback.html', import.meta.url)`
// resolves relative to THIS file's own location (shared/core/), not the
// importing page's, so it lands on shared/feedback.html correctly whether
// this runs from the hub root or a games/<name>/ subfolder. game/returnTo
// are passed as query params so the feedback page knows what it's feedback
// ABOUT and where to send the tester back to afterward.
function buildFeedbackPageUrl() {
  const url = new URL('../feedback.html', import.meta.url);
  url.searchParams.set('game', document.title);
  url.searchParams.set('returnTo', window.location.href);
  return url.href;
}

// Builds the URL to the tester welcome/onboarding page (welcome.html, at
// the hub root — see that file). Same "resolve relative to THIS file's own
// location" trick as buildFeedbackPageUrl() above, just one level further
// up (shared/core/ -> shared/ -> root/), so it lands on welcome.html
// correctly whether this runs from the hub root or a games/<name>/
// subfolder. No query params — welcome.html is deliberately generic (see
// its own header comment), so there's nothing tester-specific to pass.
function buildWelcomePageUrl() {
  const url = new URL('../../welcome.html', import.meta.url);
  return url.href;
}

// gameIds: array of game ids the "reset today" button should act on (the
// hub page passes all seven; each individual game page passes just its own
// id, so resetting from inside GLYMPZ doesn't also wipe SOLVZ/JEWELZ).
//
// extraActions: optional array of { label, onClick } for page-specific dev
// shortcuts (e.g. GLYMPZ's "Solve puzzle") — Dev-mode only, and the panel
// tucks itself away after one of these fires (matches these being one-shot
// "do a thing and get out of the way" actions).
//
// radioGroups: optional array of { label, name, options: [{value, label}],
// get, set } for page-specific "pick exactly one of N" dev controls (e.g.
// WARPZ's "which obstacle type populates the field this round" — see
// games/warpz/index.js). Dev-mode only, and — like toggles would be, but
// unlike extraActions — the panel stays OPEN after picking one, since you
// might want to re-check the choice before closing it. `get()` reads the
// currently-selected option's value from the calling game's own code;
// `set(value)` writes a newly-picked value back into it — this file only
// ever renders/wires the radio inputs, the calling game owns what each
// value actually means and does with it.
export function initToolsPanel(gameIds, { extraActions = [], radioGroups = [] } = {}) {
  const mode = getToolMode();
  if (mode === 'off') return; // real players: no gear icon, nothing injected

  const isDev = mode === 'dev';

  const toggle = el('button', 'dev-toggle', isDev ? '⚙️' : '🧪');
  toggle.type = 'button'; // without this, a <button> inside a <form> defaults to type="submit"
  toggle.setAttribute('aria-label', isDev ? 'Developer tools' : 'Tester tools');
  toggle.title = isDev ? 'Developer tools' : 'Tester tools';

  const panel = isDev ? buildDevPanelContent(extraActions, radioGroups) : buildTestPanelContent();

  // Appended straight onto <body> (not into #game-root or .shell) so this
  // floats on top of everything else on the page, positioned via
  // `position: fixed` in shared/tools-panel.css.
  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  // Clicking the gear/flask icon just toggles the "is-hidden" CSS class —
  // the panel's DOM never gets removed/recreated, only shown or hidden.
  // refreshDebugInfo() re-reads live values every time the panel is
  // opened (not just once at build time), since the whole point is
  // catching state at whatever moment the tester actually checks it —
  // e.g. right before "Add to Home Screen" vs. right after opening the
  // resulting icon.
  toggle.addEventListener('click', () => {
    panel.classList.toggle('is-hidden');
    if (!panel.classList.contains('is-hidden')) refreshDebugInfo(panel);
  });

  if (isDev) {
    wireDevPanel(panel, gameIds, extraActions, radioGroups);
  } else {
    wireTestPanel(panel, gameIds);
  }
}

// TEMPORARY diagnostic block — added to help debug a real-device-only
// "still asked for the code after Add to Home Screen" report that hasn't
// been reproducible any other way (no access to a real iOS device/Safari
// to test against directly). Shows exactly the values needed to tell
// whether the URL a home-screen icon actually launches with has ?code=...
// on it or not, and whether the page even recognizes itself as running in
// standalone (home-screen icon) mode at all. Meant to be screenshotted/
// read off by hand, not pretty — remove once the underlying issue is
// found and fixed for real.
function buildDebugInfoHtml() {
  return `<pre class="dev-panel__debug" id="dev-debug-info"></pre>`;
}

function refreshDebugInfo(panel) {
  const el = panel.querySelector('#dev-debug-info');
  if (!el) return;
  // navigator.standalone is iOS Safari's own (non-standard, iOS-only) way
  // of reporting "this page is running as a launched home-screen icon,
  // not a normal browser tab" — undefined on every other browser/OS.
  const standalone = 'standalone' in window.navigator ? String(window.navigator.standalone) : 'not iOS Safari';
  const stored = localStorage.getItem('pusulz_tester') || '(none)';
  el.textContent =
    `url: ${window.location.href}\n` +
    `standalone: ${standalone}\n` +
    `stored tester: ${stored}\n` +
    `referrer: ${document.referrer || '(none)'}`;
}

function buildDevPanelContent(extraActions, radioGroups) {
  // .map() transforms the extraActions array into an array of HTML strings
  // (one <button> per action), and .join('\n') glues them into one big
  // string to drop into the panel's innerHTML below. Each button gets a
  // predictable id ("dev-extra-0", "dev-extra-1", ...) based on its
  // position in the array, so wireDevPanel()'s click-handler loop can find
  // the right one for each action. Each radio group gets the same
  // predictable-id-by-position treatment, one level deeper ("dev-radio-0-0",
  // "dev-radio-0-1", ...) since a group holds several options — rendered as
  // its own labeled fieldset above the one-shot action buttons. `name` on
  // each group's `<input>`s is what makes the browser treat them as one
  // mutually-exclusive set rather than independent checkboxes.
  const extraButtonsHtml = extraActions
    .map((action, i) => `<button class="dev-panel__btn" id="dev-extra-${i}" type="button">${action.label}</button>`)
    .join('\n');

  const radioGroupsHtml = radioGroups.length
    ? radioGroups
        .map(
          (group, gi) => `<div class="dev-panel__radio-group">
            <p class="dev-panel__radio-group-label">${group.label}</p>
            ${group.options
              .map(
                (opt, oi) => `<label class="dev-panel__toggle">
                  <input type="radio" name="${group.name}" id="dev-radio-${gi}-${oi}" ${opt.value === group.get() ? 'checked' : ''} />
                  ${opt.label}
                </label>`
              )
              .join('\n')}
          </div>`
        )
        .join('\n')
    : '';

  return el(
    'div',
    'dev-panel is-hidden',
    `<p class="dev-panel__title">Dev tools<span class="dev-panel__version">V${APP_VERSION}</span></p>
     ${buildDebugInfoHtml()}
     ${radioGroupsHtml}
     ${extraButtonsHtml}
     <button class="dev-panel__btn" id="dev-reset-today" type="button">Reset today's progress</button>
     <button class="dev-panel__btn dev-panel__btn--danger" id="dev-reset-all" type="button">Reset all data (incl. best scores)</button>
     <p class="dev-panel__status" id="dev-panel-status"></p>`
  );
}

function buildTestPanelContent() {
  return el(
    'div',
    'dev-panel is-hidden',
    `<p class="dev-panel__title">Tester tools<span class="dev-panel__version">V${APP_VERSION}</span></p>
     ${buildDebugInfoHtml()}
     <button class="dev-panel__btn" id="dev-reset-today" type="button">Reset today's progress</button>
     <button class="dev-panel__btn" id="dev-send-feedback" type="button">Send feedback</button>
     <button class="dev-panel__btn" id="dev-see-instructions" type="button">See tester instructions</button>
     <p class="dev-panel__status" id="dev-panel-status"></p>`
  );
}

// Shared by both modes' "reset today" button: shows a status message, then
// reloads the page shortly after so the game re-reads the now-cleared
// localStorage state from scratch (simpler and more reliable than trying
// to manually reset every piece of in-memory game state by hand).
function afterReset(panel, message) {
  panel.querySelector('#dev-panel-status').textContent = message;
  // reloadWithSpinner() (not a plain reload()) — confirmed on a real device
  // that a bare window.location.reload() blanks the screen to plain white
  // BEFORE the spinner (or anything else) gets a chance to show, unlike
  // navigating to a URL, which keeps the current page's last-painted frame
  // up until the next page is ready — see that function's own comment.
  setTimeout(() => reloadWithSpinner(), 500);
}

function wireDevPanel(panel, gameIds, extraActions, radioGroups) {
  // Wires up a click handler for each extra action button, matching each
  // one back to its original { label, onClick } entry by array index.
  extraActions.forEach((action, i) => {
    panel.querySelector(`#dev-extra-${i}`).addEventListener('click', () => {
      action.onClick();
      panel.classList.add('is-hidden'); // tuck the panel away after using a shortcut
    });
  });

  // Wires up a change handler for each option in each radio group —
  // deliberately does NOT hide the panel afterward (unlike extraActions
  // above), since you might want to double-check which option ended up
  // selected before closing it.
  radioGroups.forEach((group, gi) => {
    group.options.forEach((opt, oi) => {
      panel.querySelector(`#dev-radio-${gi}-${oi}`).addEventListener('change', (e) => {
        if (e.target.checked) group.set(opt.value);
      });
    });
  });

  panel.querySelector('#dev-reset-today').addEventListener('click', () => {
    gameIds.forEach((id) => clearProgress(id));
    afterReset(panel, "Today's progress cleared — reloading…");
  });

  panel.querySelector('#dev-reset-all').addEventListener('click', () => {
    gameIds.forEach((id) => clearAllData(id));
    afterReset(panel, 'All data cleared — reloading…');
  });
}

function wireTestPanel(panel, gameIds) {
  panel.querySelector('#dev-reset-today').addEventListener('click', () => {
    gameIds.forEach((id) => clearProgress(id));
    afterReset(panel, "Today's progress cleared — reloading…");
  });

  panel.querySelector('#dev-send-feedback').addEventListener('click', () => {
    navigateWithSpinner(buildFeedbackPageUrl());
  });

  panel.querySelector('#dev-see-instructions').addEventListener('click', () => {
    navigateWithSpinner(buildWelcomePageUrl());
  });
}
