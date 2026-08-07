// GLYMPZ — a 6x6 sliding image puzzle. Every tile shows one slice of today's
// photo (a different image file each day); drag tiles to swap them until
// every slice is back in its correct spot and the picture is whole again.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { getTileIconDataURL } from './row-icon.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

const GAME_ID = 'glympz';

// See the matching comment in games/solvz/index.js for what $(function(){})
// does (runs once the page's HTML is ready).
$(function () {

  const totalTiles = 36; // a 6x6 grid
  const columns = 6;
  const $container = $('#grid-container');

  // Inline "solved tile" badge for the instructions text — the exact same
  // badge/SVG markup createTiles() below draws on a correctly-placed tile
  // (see .tick-mark in style.css), so the instructions show the real
  // in-game visual rather than describing it in words alone.
  const TICK_IMG = `<span class="glympz-inline-tick"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;

  // Picks today's image: dayOfYear() (see shared/core/date-utils.js)
  // returns a number 1-366, and this project ships one numbered .jpg per
  // day in the images/ folder (1.jpg, 2.jpg, ... 366.jpg) — so "today's
  // puzzle" is really just "load the image file whose name matches today's
  // day-of-year." document.documentElement is the <html> element;
  // .style.setProperty(...) sets a CSS custom property directly on it
  // (inline), which style.css then reads back with
  // background-image: var(--daily-image, ...) — this is how the SAME CSS
  // rule ends up showing a DIFFERENT image every day, without editing any
  // CSS file.
  const imageFileName = `${dayOfYear()}.jpg`;
  document.documentElement.style.setProperty('--daily-image', `url('./images/${imageFileName}')`);

  let totalSeconds = 0;
  let timerInterval = null;
  let locked = false; // reassigned to `true` a bit further down, before anything can interact with it — see the comment there

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateClockDisplay() {
    shell.timer.setSeconds(totalSeconds);
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      totalSeconds++;
      updateClockDisplay();
      persistProgress(false);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  // Builds the 36 tile <div>s. Each tile shows ONE piece of today's photo —
  // that's done with a single shared background-image (set as --daily-image
  // above, applied to every tile via style.css) plus a different
  // background-position PER TILE, so each tile acts like a window onto a
  // different part of the same underlying image (a technique sometimes
  // called a "sprite sheet" or "CSS sprite," here applied to one big photo
  // instead of a grid of small icons).
  function createTiles() {
    $container.empty(); // clears out any previously-built tiles first (e.g. if this ever got called twice)

    for (let i = 0; i < totalTiles; i++) {
      const $tile = $('<div></div>');
      $tile.attr('id', `t${i + 1}`);
      // jQuery's .data(key, value) stores data ATTACHED to the element (in
      // jQuery's internal data cache — this is different from a real HTML
      // data-* attribute, though it's read back the same way via
      // .data(key)). "correct-order" never changes once set — it's this
      // tile's permanent "home" position, used later to check whether the
      // puzzle is solved.
      $tile.data('correct-order', i + 1);
      $tile.addClass('tile');

      // The little green checkmark badge shown on a tile once it's in its
      // correct spot — built as inline SVG (a small vector graphic
      // described directly in the HTML/JS, rather than loaded from a
      // separate image file) so it can be recolored/resized easily via CSS.
      // Starts hidden (`is-hidden` class) since a freshly-shuffled tile is
      // very unlikely to already be correct.
      const $tick = $(`
        <div class="tick-mark is-hidden">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
      `);
      $tile.append($tick);

      // Works out which "slice" of the photo this tile should show, purely
      // from its position in the original (unshuffled) 6x6 layout — this
      // background-position is set ONCE here and never changes again for
      // this tile's whole lifetime; only the tile's on-screen POSITION
      // changes as the player drags things around (see the CSS `order`
      // property used in applyOrders() below), while its background image
      // slice stays fixed. i % columns / Math.floor(i / columns) turn the
      // flat tile index back into a (col, row) position, same technique as
      // SOLVZ's buildGrid(). Dividing by (columns - 1) and multiplying by
      // 100 converts that position into a percentage from 0% (leftmost/
      // topmost slice) to 100% (rightmost/bottommost) — which is exactly
      // what CSS background-position expects for percentage-based
      // positioning of a background image larger than its container (see
      // style.css's background-size: 600% 600%, which is what makes each
      // tile only show a 1/6th-width, 1/6th-height slice of the full image
      // in the first place).
      const col = i % columns;
      const row = Math.floor(i / columns);
      const posX = (col / (columns - 1)) * 100;
      const posY = (row / (columns - 1)) * 100;
      $tile.css('background-position', `${posX}% ${posY}%`);

      $container.append($tile);
    }
  }

  // Randomly rearranges the tiles' on-screen ORDER (not their background
  // slices — see the comment above), using a classic algorithm called the
  // "Fisher-Yates shuffle," with one extra constraint: keep re-shuffling
  // until EXACTLY one tile happens to land back in its correct spot. That's
  // a deliberate design choice (not a bug) — it guarantees every fresh
  // puzzle starts with one visible "correct" checkmark already showing, as
  // a small hint/encouragement, while still being thoroughly scrambled.
  function shuffleGrid() {
    let orders;
    let exactMatchFound = false;

    while (!exactMatchFound) {
      // Array.from({ length: N }, (_, i) => i + 1) builds [1, 2, 3, ..., N]
      // — a shorthand for creating a numbered array without a manual loop.
      // The `_` parameter name is a common convention meaning "this
      // argument (the array element, which doesn't exist yet) is
      // intentionally unused — only the index `i` matters here."
      orders = Array.from({ length: totalTiles }, (_, i) => i + 1);

      // THE FISHER-YATES SHUFFLE: walks the array backwards from the last
      // element to the second (index 1), and at each step swaps the
      // current element with a RANDOMLY CHOSEN element from anywhere at or
      // before its own current position (0 through i inclusive). Doing
      // this for every position, in this specific backwards order, is
      // mathematically proven to produce a perfectly uniform shuffle (every
      // possible ordering equally likely) — unlike more naive "just swap
      // random pairs a bunch of times" approaches, which subtly favor some
      // orderings over others.
      for (let i = orders.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        // Array destructuring swap: [a, b] = [b, a] swaps two values
        // without needing a temporary third variable to hold one of them
        // during the swap, which is how you'd have to do it in most older
        // languages (temp = a; a = b; b = temp;).
        [orders[i], orders[j]] = [orders[j], orders[i]];
      }

      // Counts how many tiles ended up back in their own original slot
      // purely by chance, and only accepts this shuffle if that count is
      // exactly 1 — otherwise the while loop tries a whole new shuffle from
      // scratch.
      let correctCount = 0;
      for (let i = 0; i < orders.length; i++) {
        if (orders[i] === i + 1) correctCount++;
      }
      if (correctCount === 1) exactMatchFound = true;
    }

    applyOrders(orders);
  }

  // Given an array of 36 position numbers (in tile order), moves every tile
  // to its new spot by setting the CSS `order` property (see style.css —
  // #grid-container uses CSS Grid, and every grid/flex item's `order`
  // controls where it renders WITHOUT moving it in the actual DOM tree).
  // This is what makes swapping fast and simple: no DOM elements are ever
  // removed or re-inserted, only their `order` numbers change.
  function applyOrders(orders) {
    $('.tile').each(function (index) {
      const orderVal = parseInt(orders[index], 10); // parseInt's second argument (10) means "parse as base-10" — good practice to always specify it explicitly
      $(this).css('order', orderVal).data('current-order', orderVal);
    });
    updateTickVisibility();
  }

  // The inverse of applyOrders() — reads each tile's CURRENT order value
  // back out into a plain array, in DOM order, for saving to localStorage.
  function captureOrders() {
    return $('.tile').map(function () {
      return parseInt($(this).data('current-order'), 10);
    }).get();
  }

  // Shows/hides each tile's checkmark badge based on whether its current
  // position matches its original ("correct") position.
  function updateTickVisibility() {
    $('.tile').each(function () {
      const current = parseInt($(this).data('current-order'), 10);
      const correct = parseInt($(this).data('correct-order'), 10);
      // .toggleClass(name, condition) is jQuery shorthand: adds the class
      // if `condition` is true, removes it if false — one call instead of
      // an if/else with separate .addClass()/.removeClass() branches.
      $(this).find('.tick-mark').toggleClass('is-hidden', current !== correct);
    });
  }

  function removeTicks() {
    $('.tick-mark').addClass('is-hidden');
  }

  function checkWinCondition() {
    let hasWon = true;
    $('.tile').each(function () {
      const current = parseInt($(this).data('current-order'), 10);
      const correct = parseInt($(this).data('correct-order'), 10);
      if (current !== correct) {
        hasWon = false;
        // Returning `false` from a jQuery .each() callback stops the loop
        // early (jQuery's equivalent of `break` in a normal for-loop) —
        // once ANY tile is found out of place, there's no need to keep
        // checking the rest.
        return false;
      }
    });
    return hasWon;
  }

  function persistProgress(completed) {
    saveProgress(GAME_ID, { orders: captureOrders(), seconds: totalSeconds, revealed }, { completed });
  }

  let revealed = false; // true once the player has given up and seen the answer, for today

  createTiles();

  const shell = initShell({
    gameId: GAME_ID,
    title: 'GLYMPZ',
    emoji: '🟥',
    // Same single-tile crop shown on this game's hub tile — see
    // games/glympz/row-icon.js and games-registry.js.
    emojiImage: getTileIconDataURL(2),
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`) instead of the shared global blue every game used before.
    accentColor: { bg: '#6F9BDB', ink: '#14285A', rim: 'rgba(20, 40, 90, 0.30)' },
    instructions: `<p>Move image clips across the grid to form the picture</p><p>When a clip is in the right place you will see a small tick ${TICK_IMG}</p><p>1 clip is always in the correct position at the start</p><p>You are against the clock, so step to it</p>`,
    formatScore: formatTime,
  });

  // --- Reveal solution (same feature/styling as games/slydz/index.js and
  // games/quadz/index.js — see their fuller comments for the full
  // reasoning) — a deliberately more understated control than Play, since
  // it ENDS today's round rather than just assisting: a plain text-style
  // button below the grid, and a custom confirm panel styled/positioned
  // like the shared shell.js start/end panels instead of the browser's
  // native confirm() dialog. GLYMPZ has no help feature to go alongside it
  // (there's nothing to hint at beyond "which tiles are already right,"
  // which the tick marks already show), so this is the only extra control.
  const $revealBtn = $('<button>', {
    class: 'reveal-btn is-hidden',
    type: 'button',
    text: 'Reveal solution',
  }).appendTo('#game-root');

  function showRevealButton() {
    $revealBtn.removeClass('is-hidden');
  }

  function hideRevealButton() {
    $revealBtn.addClass('is-hidden');
  }

  // Reuses the shell's own overlay/panel classes directly (rather than a
  // separate near-identical copy of the same rules) so this dialog can
  // never visually drift out of sync with the start banner again — same
  // positioning, same title-centering, same button shape. Text block reuses
  // .shell-overlay__instructions' styling (same left-aligned multi-
  // paragraph block the start-banner instructions use) — NOT
  // .shell-end-screen__message, which is now a single-line-only truncated
  // element for the redesigned end-of-game panel and would clip this
  // multi-sentence explainer.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title">Reveal today's solution?</p>
          <p>You won't be able to complete GLYMPZ yourself today.</p>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="glympz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="glympz-reveal-confirm">Reveal Solution</button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  $revealConfirm.find('#glympz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
  });
  $revealConfirm.find('#glympz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    revealSolution();
  });

  $revealBtn.on('click', () => {
    if (locked) return;
    $revealConfirm.removeClass('is-hidden');
  });

  // Locked until Play Now / Resume is pressed — otherwise tiles are
  // draggable underneath the start banner.
  locked = true;

  // Shared by both the real "player actually solved it" path and the dev
  // "Solve puzzle" shortcut below — everything that needs to happen once
  // the puzzle is complete, in one place, so both paths stay in sync.
  function handleWin() {
    locked = true;
    stopTimer();
    removeTicks();
    hideRevealButton();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
    // A meaningful PB needs a real previous best to have beaten — not the
    // player's first-ever play, and not a previous best of exactly 0 (see
    // end-panel-content.js's scenario-priority comment).
    const hasMeaningfulBest = result.previousBest !== null && result.previousBest !== 0;
    const isNewBest = hasMeaningfulBest && result.isNewBest;
    saveTodayOutcome(GAME_ID, {
      revealed: false, usedHelp: false, failed: false,
      isNewBest: result.isNewBest, isTie: result.isTie,
      panelOutcome: undefined, panelIsNewBest: isNewBest,
    });
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest,
      animateTarget: document.getElementById('grid-container'),
      shareText: `🟥 GLYMPZ 🟩 — solved in ${formatTime(totalSeconds)}!`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Reachable only via the player's own confirmed choice to give up (see
  // the $revealConfirm wiring above) — reveals the actual solution, locks
  // the board same as a real finish, but records it as a NON-win (no
  // submitScore(), no celebrate/confetti) and shows a "better luck
  // tomorrow" message instead of a congratulations, same spirit as
  // games/slydz's/games/quadz's revealSolution().
  function revealSolution() {
    locked = true;
    stopTimer();
    hideRevealButton();
    revealed = true;
    applyOrders(Array.from({ length: totalTiles }, (_, i) => i + 1)); // every tile's own "home" order — same restore solvePuzzle() uses below
    removeTicks();
    persistProgress(true);
    // No submitScore() call on this path (see comment above) — isNewBest/
    // isTie are always false here, since giving up never sets a best.
    saveTodayOutcome(GAME_ID, {
      revealed: true, usedHelp: false, failed: false, isNewBest: false, isTie: false,
      panelOutcome: 'reveal', panelIsNewBest: false,
    });
    shell.showEndScreen({
      outcome: 'reveal',
      shareText: `🟥 GLYMPZ 🟩 — couldn't solve it today!`,
      // No `celebrate` here — giving up is explicitly not a celebration moment.
    });
  }

  // Testing shortcut, wired into the dev panel below: instantly arranges every
  // tile into its correct spot and ends the game, same as a real win.
  function solvePuzzle() {
    shell.hideStartBanner();
    applyOrders(Array.from({ length: totalTiles }, (_, i) => i + 1)); // [1, 2, 3, ..., 36] — i.e. every tile's "home" order, so the puzzle is instantly solved
    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }] });

  enableTileDragSwap({
    container: document.getElementById('game-root'),
    tileSelector: '.tile',
    isLocked: () => locked,
    canSwap: () => true, // unlike SOLVZ, any tile here can swap with any other tile — there's no "type" distinction
    onSwap: (a, b) => {
      const $a = $(a), $b = $(b);
      const aPos = parseInt($a.data('current-order'), 10);
      const bPos = parseInt($b.data('current-order'), 10);
      // Swaps the two tiles' CSS `order` (their on-screen position) — note
      // this is the opposite of SOLVZ, which swaps the tiles' TEXT while
      // leaving their position fixed. GLYMPZ swaps POSITION while each
      // tile's own background-image slice (set once in createTiles(), never
      // touched again) stays fixed to that specific tile element.
      $a.css('order', bPos).data('current-order', bPos);
      $b.css('order', aPos).data('current-order', aPos);

      // Briefly adds a CSS class that triggers a small "pop" animation
      // (defined in style.css), then removes it 200ms later so the class
      // is ready to reapply (and re-trigger the animation) on the next
      // swap.
      $a.addClass('tile-swapped');
      $b.addClass('tile-swapped');
      setTimeout(() => { $a.removeClass('tile-swapped'); $b.removeClass('tile-swapped'); }, 200);

      updateTickVisibility();

      if (checkWinCondition()) {
        handleWin();
      } else {
        persistProgress(false);
      }
    },
  });

  // Same three-way status branch as SOLVZ — see the matching comment in
  // games/solvz/index.js for the full explanation of what each status means.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyOrders(data.orders);
    totalSeconds = data.seconds;
    revealed = data.revealed || false; // `|| false` covers old saves from before this field existed
    updateClockDisplay();
    removeTicks();
    // No `celebrate` on this branch either way — this only runs when
    // revisiting a day already finished in an EARLIER session, not on the
    // actual moment of winning/revealing, so it shouldn't replay confetti.
    if (revealed) {
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: `🟥 GLYMPZ 🟩 — couldn't solve it today!`,
      });
    } else {
      // isNewBest falls back to false if this day was completed before
      // panelIsNewBest existed — no stored record of whether it was a
      // meaningful PB at the time.
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🟥 GLYMPZ 🟩 — solved in ${formatTime(totalSeconds)}!`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyOrders(data.orders);
    totalSeconds = data.seconds;
    updateClockDisplay();
    shell.showStartBanner(() => {
      locked = false;
      showRevealButton();
      startTimer();
    }, { label: 'Resume' });
  } else {
    shuffleGrid();
    shell.showStartBanner(() => {
      locked = false;
      showRevealButton();
      totalSeconds = 0;
      updateClockDisplay();
      startTimer();
      persistProgress(false);
    });
  }

});
