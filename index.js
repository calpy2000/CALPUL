// The hub page's own script — builds one tile per game and wires up the dev
// tools panel. This is a good file to start reading the codebase from,
// since it's the simplest of all the .js files here and touches most of the
// shared modules at least once.

import { GAMES } from './games-registry.js';
import { getBestScore, getBestScoreDate } from './shared/core/game-storage.js';
import { getDailyStatus } from './shared/core/daily-lock.js';
import { todayDateString } from './shared/core/date-utils.js';
import { initToolsPanel } from './shared/core/tools-panel.js';
import { getToolMode } from './shared/core/tool-mode.js';
import { initBetaGate, clearStoredTester } from './shared/core/beta-gate.js';
import { hidePageLoadingIndicator, navigateWithSpinner, reloadWithSpinner, stripReloadParam, yieldForPaint } from './shared/core/loading-indicator.js';
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
  // devOnly games (e.g. VALUZ, still under construction — see
  // games-registry.js) only ever show a hub tile in dev mode. TOOL_MODE is
  // baked into the deployed code (see tool-mode.js) — CALPUL/PUSULZ stay on
  // 'test', so testers never see a devOnly tile no matter what's pushed.
  const visibleGames = GAMES.filter((game) => !game.devOnly || getToolMode() === 'dev');
  visibleGames.forEach((game) => {
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
    // Opt-in per game via games-registry.js's `isNew` flag — currently only
    // VALUZ. Picked from a published mockup gallery of 6 options (corner
    // ribbon, floating pill, sparkle badge, notification dot, glow outline,
    // corner fold) — see .hub__tile-new-ribbon in style.css for the actual
    // styling.
    const newRibbon = game.isNew ? `<span class="hub__tile-new-ribbon">NEW</span>` : '';
    tile.innerHTML = `
      ${newRibbon}
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

// Caps the hub grid's row height two ways at once, per two explicit user
// rules:
//   1. In 2-column mode, show up to 4 rows' worth of height, then scroll
//      for anything past that — rather than the plain `1fr` in style.css
//      shrinking EVERY row evenly to cram however many rows exist onto the
//      screen.
//   2. A tile must NEVER be taller than it is wide, full stop, regardless
//      of row count — this was the actual bug report: on a tall/narrow
//      viewport (e.g. a DevTools panel eating most of the window's width,
//      leaving a lot of leftover height), rule 1 alone — sizing purely off
//      "1/4 of available height" — could produce a per-row height BIGGER
//      than the column's own width, since the two were never compared
//      against each other. rowHeight is now whichever is smaller: the
//      4-rows height cap, or the column's actual resolved width.
//
// This has to be done in JS, not pure CSS: a `container-type:size` +
// `cqh`-based version was tried first, but `.hub__grid`'s own height comes
// from flexbox (flex:1 1 auto against .hub__title's fixed size), and
// having grid-auto-rows ALSO depend on this same element's queried height
// turned out to be circular in exactly the way found in VALUZ's own tile
// CSS (see games/valuz/style.css's .valuz-tile--slot comment) — the
// browser just fell back to dividing evenly among however many rows
// existed anyway, the exact behavior this was meant to replace. Measuring
// the grid's real flex-resolved clientHeight here in JS sidesteps that.
function applyRowHeightCap() {
  // Clear back to the CSS default (plain `1fr`, via style.css's
  // `var(--hub-row-height, 1fr)` fallback) BEFORE measuring — otherwise a
  // previously-applied fixed row height would pin the grid at its old
  // size instead of reporting its true current flex-resolved box (e.g.
  // after a window resize crosses the 2-column/1-column breakpoint).
  grid.style.removeProperty('--hub-row-height');

  const cs = getComputedStyle(grid);
  // Reading the ACTUAL resolved column track widths (rather than
  // re-deriving them from grid.clientWidth by hand) guarantees this can
  // never disagree with what the grid itself just laid out.
  const columnWidths = cs.gridTemplateColumns.split(' ').map(parseFloat);
  const columnCount = columnWidths.length;
  const columnWidth = columnWidths[0]; // repeat(N, 1fr) — every column is the same width

  // Rule 1's cap only applies in 2-column mode (the user's own words:
  // "when the tiles are showing in 2 columns") — 1-column mode has no
  // stated visible-row-count rule, so its only ceiling is rule 2 below.
  // Subtracting 3 row-gaps up front (the gaps a 4-row layout would have)
  // is what makes this land on the EXACT same total height 4 rows used to
  // fill under plain `1fr` — a version that skipped this ran slightly
  // over the available space even in the plain 4-row case.
  const gapPx = parseFloat(cs.rowGap) || 0;
  const fourRowHeightCap = Math.max(100, (grid.clientHeight - gapPx * 3) / 4);
  const heightBasedCap = columnCount === 2 ? fourRowHeightCap : grid.clientHeight;

  const rowHeight = Math.min(heightBasedCap, columnWidth);
  grid.style.setProperty('--hub-row-height', `${rowHeight}px`);
}

// Blocks here (top-level await — supported in module scripts) until a
// tester code is already stored on this device — see
// shared/core/beta-gate.js. That's the ONLY way this ever resolves: a
// tester who still needs to enter a code stays on the gate until they type
// a valid one, at which point beta-gate.js reloads the whole page rather
// than resolving here — see its own comment for why. So nothing below this
// line runs until either this device was already set up, or a fresh reload
// (post-code-entry) reaches this same line on its own next pass.
await initBetaGate();
// See loading-indicator.js's own comment on yieldForPaint(): a genuinely
// new install/update may have just waited on the service worker's own
// fetch-driven install (see update-gate.js's ensureAppReady(), called
// above) before reaching this point, and that kind of await doesn't
// reliably let WebKit paint on its own — this is a defensive guard so the
// hub reveal right below doesn't inherit that same risk.
await yieldForPaint();
document.getElementById('hub').classList.remove('is-gate-hidden');

renderTiles();
applyRowHeightCap();
// Re-checks on resize (e.g. a desktop window dragged narrower/wider across
// the 2-column/1-column breakpoint, or a device rotation) so the cap stays
// correct rather than only being right at whatever size the page happened
// to load at. rAF-throttled: resize can fire many times per second while
// actively dragging a window edge, and only the LAST queued measurement
// before the next paint actually matters.
let resizeRaf = null;
window.addEventListener('resize', () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    applyRowHeightCap();
  });
});

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
