// The hub page's own script — builds one tile per game and wires up the dev
// tools panel. This is a good file to start reading the codebase from,
// since it's the simplest of all the .js files here and touches most of the
// shared modules at least once.

import { GAMES } from './games-registry.js';
import { getBestScore, getBestScoreDate } from './shared/core/game-storage.js';
import { getDailyStatus } from './shared/core/daily-lock.js';
import { todayDateString } from './shared/core/date-utils.js';
import { initToolsPanel } from './shared/core/tools-panel.js';
import { initBetaGate, clearStoredTester } from './shared/core/beta-gate.js';
import { hidePageLoadingIndicator, navigateWithSpinner, reloadWithSpinner, stripReloadParam } from './shared/core/loading-indicator.js';
import { ensureAppReady } from './shared/core/update-gate.js';

// Waits here, BEFORE hiding the spinner, only on a brand-new install or a
// version update that needs to precache — see update-gate.js's own comment
// for why this has to run before both hidePageLoadingIndicator() below AND
// initBetaGate() further down. No-ops almost instantly on every normal
// return visit once a device is already up to date.
await ensureAppReady();

// See loading-indicator.js's own comment: this page's whole JS module graph
// (every import above) has already finished loading by the time this line
// runs, so the spinner's job is done — everything from here on either
// finishes fast (renderTiles()) or is genuinely interactive rather than a
// load (the beta gate waiting on a typed code), neither of which the
// spinner should keep covering.
hidePageLoadingIndicator();
// Cleans up the harmless `?_r=...` cache-busting param reloadWithSpinner()
// may have added (see loading-indicator.js) — no-ops if it isn't present.
stripReloadParam();

// Converts a raw number of seconds (e.g. 83) into "M:SS" (e.g. "1:23") for
// display. Used for every game whose games-registry.js entry has
// scoreIsTime: true (SOLVZ/GLYMPZ/SLYDZ/QUADZ) — the rest (JEWELZ/MUVEEZ/
// RAINZ) store a plain count (jewels/guesses/words), shown as-is instead.
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Builds the small "Best: ..." line shown on each hub tile.
function formatBestScore(game) {
  const best = getBestScore(game.id);
  if (best === null) return 'Not played yet';

  // game.scoreIsTime comes from games-registry.js — this used to check
  // game.higherIsBetter instead, which happened to line up for every game
  // EXCEPT MUVEEZ (higherIsBetter: false there too, since fewer guesses
  // wins, but its score isn't a duration) — that showed MUVEEZ's guess
  // count run through formatTime() as a nonsense value like "0:04" instead
  // of "4". scoreIsTime is the actual "is this a duration?" flag.
  const label = game.scoreIsTime ? formatTime(best) : String(best);
  const setToday = getBestScoreDate(game.id) === todayDateString();
  return setToday ? `Best: ${label} (today!)` : `Best: ${label}`;
}

// Builds the "Not played today" / "In progress…" / "Played today ✓" line.
function playedStatusLabel(game) {
  const status = getDailyStatus(game.id).status;
  if (status === 'completed') return 'Played today ✓';
  if (status === 'in-progress') return 'In progress…';
  return 'Not played today';
}

// Each PUSULZ letter tile's --tilt is a fixed value baked directly into
// index.html's inline style (not set here at runtime) — see the comment
// there for why: a plain static value is guaranteed present in the very
// first rendered frame, with no dependency on script timing.

const grid = document.getElementById('hub-grid');

// Wipes out and rebuilds every tile from scratch. Called once on page load,
// and again by the dev panel's reset buttons (see shared/core/tools-panel.js)
// so the "Not played today" / "Best: ..." text immediately reflects the
// just-cleared data without needing a full page reload.
function renderTiles() {
  grid.innerHTML = ''; // clears out any previously-rendered tiles first
  GAMES.forEach((game) => {
    // Building each tile as an <a> (link) element, entirely in JavaScript,
    // rather than writing three near-identical <a> tags by hand in the
    // HTML — this is the same "loop over data, build matching DOM" pattern
    // frameworks like React automate, done here with plain browser APIs.
    const tile = document.createElement('a');
    // Adding a game-specific class (hub__tile--solvz, hub__tile--glympz, ...)
    // alongside the shared hub__tile class lets style.css target one
    // specific game's tile differently later if a one-off ever needs it —
    // nothing currently does, since color/icon differences are all handled
    // through the --tile-* custom properties set below instead.
    tile.className = `hub__tile hub__tile--${game.id}`;
    tile.href = game.path;
    // Shows the spinner on THIS (still-current) page the instant a tile is
    // tapped, rather than relying only on the destination game's own
    // spinner timing — this page's last-painted content (spinner included)
    // stays on screen until the next page is ready to replace it, so it
    // bridges the whole transition regardless of how long any part of it
    // (stylesheet fetch, that game's own JS module graph, etc.) takes. The
    // heavier games — WARPZ especially, with the most stylesheets/JS of any
    // page — are exactly where that gap was visible before this. preventDefault()
    // + navigateWithSpinner() (rather than just calling
    // showPageLoadingIndicator() and letting the plain href navigate on its
    // own) is what actually guarantees the spinner gets a real painted frame
    // before navigation begins — see that function's own comment for why a
    // bare same-tick DOM change right before navigating isn't enough on its
    // own.
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      navigateWithSpinner(game.path);
    });
    // .style.setProperty() sets a CSS custom property directly on this one
    // element (as an inline style), rather than in a stylesheet — this is
    // how each tile gets ITS OWN color even though they all share the same
    // hub__tile CSS class. style.css then reads these back with
    // var(--tile-flat) / var(--tile-rim).
    tile.style.setProperty('--tile-flat', game.color);
    tile.style.setProperty('--tile-rim', game.rim);
    // Only SOLVZ (no generated icon art of its own) supplies `accent` —
    // it's the background for that one game's icon circle. Every other
    // game supplies `emojiImage` instead and shows that image directly,
    // with no circle behind it.
    if (game.accent) tile.style.setProperty('--tile-accent', game.accent);
    const iconSlot = game.emojiImage
      ? `<img class="hub__tile-icon-img" src="${game.emojiImage}" alt="">`
      : `<span class="hub__tile-badge">${game.emoji}</span>`;
    tile.innerHTML = `
      <div class="hub__tile-row1">
        ${iconSlot}
        <span class="hub__tile-title">${game.title}</span>
      </div>
      <span class="hub__tile-tagline">${game.tagline}</span>
      <span class="hub__tile-status">${playedStatusLabel(game)}</span>
      <span class="hub__tile-score">${formatBestScore(game)}</span>
    `;
    grid.appendChild(tile);
  });
}

// Blocks here (top-level await — supported in module scripts) until either
// a tester code is already stored on this device, or the tester enters a
// valid one into the gate — see shared/core/beta-gate.js. Nothing below
// this line runs until that resolves, so the hub tiles never get built (or
// shown — see the "is-gate-hidden" class in index.html/beta-gate.css)
// behind a locked gate.
await initBetaGate();
document.getElementById('hub').classList.remove('is-gate-hidden');

renderTiles();

// GAMES.map((game) => game.id) transforms the array of game objects into
// just an array of their id strings (['solvz', 'glympz', 'jewelz']) — that's
// what initToolsPanel() expects: which games its Reset buttons should act on.
// Since this is the hub page, it passes ALL games, so a reset here clears
// every game at once (each individual game page instead passes only its own
// id — see e.g. games/glympz/index.js).
//
// extraActions' "Reset tester code" is passed ONLY here (no game page's own
// initToolsPanel() call includes it) — dev-mode only (see buildDevPanelContent
// in tools-panel.js, which is the only panel extraActions ever render into),
// and hub-only since this is the hub's own index.js. Clears the saved
// tester name/code and reloads so the beta gate shows again immediately,
// which is the whole point — testing the gate itself without having to
// manually clear localStorage by hand.
initToolsPanel(GAMES.map((game) => game.id), {
  extraActions: [
    {
      label: 'Reset tester code',
      onClick: () => {
        clearStoredTester();
        // reloadWithSpinner(), not a plain reload() — see
        // loading-indicator.js's own comment: a bare reload() blanks the
        // screen to plain white before anything else gets a chance to show.
        reloadWithSpinner();
      },
    },
  ],
});
