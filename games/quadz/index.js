// QUADZ — a 5x5 grid where only the inner 4x4 (16 tiles) hold letters.
// Drag tiles to swap letters until all 4 ROWS and all 4 COLUMNS
// simultaneously spell real words. The final arrangement doesn't have to
// match the day's starting words — any valid word in ALL_WORDS counts,
// same "any dictionary word wins" rule as SLYDZ (see games/slydz/index.js).
//
// The remaining 9 cells of the 5x5 grid aren't letters at all: the 5th
// column (rows 0-3) and 5th row (cols 0-3) are validity indicators — a
// checkmark that grows in when that row/column becomes a real word, and
// shrinks back out if it stops being one — and the very last cell (row 4,
// col 4) is an invisible spacer, kept in the grid purely so the 5x5 layout
// math stays simple. See style.css for exactly how those are styled.
//
// Unlike SLYDZ (which generates its own daily puzzles at runtime from a
// seeded PRNG), QUADZ's 366 daily puzzles were hand-curated externally
// (see tools/wordgrid-curation/) — no word repeated within 7 days of
// itself, no word used more than 20 times total, every word manually
// vetted for commonness. puzzles.js and words.js are both auto-generated
// from that curation output (see tools/wordgrid-curation/export-to-game.js)
// — don't hand-edit either file.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { PUZZLES_366 } from './puzzles.js';
import { ALL_WORDS } from './words.js';
import { getTileIconDataURL } from './tile-icon.js';
import { hidePageLoadingIndicator } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();

const GAME_ID = 'quadz';
const LETTER_SIZE = 4; // the inner 4x4 block of actual letter tiles

// A Set gives O(1) "is this word valid?" lookups — see games/slydz/index.js
// for the fuller explanation of why this matters (~5,469 entries here).
const ALL_WORDS_SET = new Set(ALL_WORDS);

function checkWord(word) {
  return ALL_WORDS_SET.has(word);
}

// A 16-letter array is indexed row-major: letters[r * 4 + c].
function rowWord(letters16, r) {
  return letters16.slice(r * LETTER_SIZE, r * LETTER_SIZE + LETTER_SIZE).join('');
}

function colWord(letters16, c) {
  const out = [];
  for (let r = 0; r < LETTER_SIZE; r++) out.push(letters16[r * LETTER_SIZE + c]);
  return out.join('');
}

// --- Help feature's solver ---
// Deliberately kept separate from updateGridValidity() further down: that
// function runs after EVERY swap (cheap — 8 Set lookups), while everything
// below only ever runs when the player explicitly asks for help, since a
// real search is far more expensive.
//
// SLYDZ's equivalent search (see games/slydz/index.js's
// canFormFromCounts()) only has to ask "can the leftover LETTERS be split
// into N more words?" — its rows never share letters with each other, so
// it's a pure multiset question. QUADZ can't use that shortcut: every
// tile belongs to a row AND a column at once, so "can this be completed?"
// is really "does a valid PLACEMENT of the leftover letters into the
// leftover CELLS exist?" — a small crossword-style fill, not just a
// letter-count check.
//
// The search below fills the grid's free cells (those NOT part of any
// currently-valid row/column — moving those would break something already
// solved) one at a time. At each free cell, instead of trying all 26
// letters blindly, it narrows to the intersection of "letters that could
// still complete this cell's row" and "...this cell's column" and "letters
// actually left in the free-cell pool" — the same kind of constraint
// propagation a crossword solver uses, and what keeps this fast in
// practice (validated empirically across the real 366-puzzle set: worst
// case observed was under 10ms and a few hundred search steps, comfortably
// below anything a player would notice).

// Words matching a partial pattern — `positions` is a 4-length array where
// each entry is either a known letter (must match exactly) or `null`
// (anything goes there). Used both for the initial candidate list per row/
// column (from whatever's currently locked) and to re-narrow that list as
// the search commits to more letters.
function patternFilter(words, positions) {
  return words.filter((w) => positions.every((ch, i) => ch === null || w[i] === ch));
}

// Returns { canForm, eligible: true } — the actual constraint search
// described above. `letters16` is the CURRENT grid (from captureLetters()),
// `rowValid`/`colValid` are this moment's validity flags (from the same
// tracking updateGridValidity() already maintains).
function canCompleteRemainingCells(letters16, rowValid, colValid) {
  const locked = new Array(16).fill(false);
  for (let r = 0; r < LETTER_SIZE; r++) {
    for (let c = 0; c < LETTER_SIZE; c++) {
      if (rowValid[r] || colValid[c]) locked[r * LETTER_SIZE + c] = true;
    }
  }
  const freeCells = [];
  for (let i = 0; i < 16; i++) if (!locked[i]) freeCells.push(i);

  // Quick fail: a not-yet-valid row/column with NO free cells at all can
  // never change — every one of its letters is pinned by some other
  // already-solved row/column, so there's no way to fix it without
  // breaking one of those.
  for (let r = 0; r < LETTER_SIZE; r++) {
    if (rowValid[r]) continue;
    if (!Array.from({ length: LETTER_SIZE }, (_, c) => c).some((c) => !locked[r * LETTER_SIZE + c])) {
      return { canForm: false };
    }
  }
  for (let c = 0; c < LETTER_SIZE; c++) {
    if (colValid[c]) continue;
    if (!Array.from({ length: LETTER_SIZE }, (_, r) => r).some((r) => !locked[r * LETTER_SIZE + c])) {
      return { canForm: false };
    }
  }

  const freeLetterCounts = new Array(26).fill(0);
  freeCells.forEach((i) => { freeLetterCounts[letters16[i].charCodeAt(0) - 65]++; });

  const rowKnown = [];
  const colKnown = [];
  for (let r = 0; r < LETTER_SIZE; r++) {
    rowKnown.push([0, 1, 2, 3].map((c) => (locked[r * LETTER_SIZE + c] ? letters16[r * LETTER_SIZE + c] : null)));
  }
  for (let c = 0; c < LETTER_SIZE; c++) {
    colKnown.push([0, 1, 2, 3].map((r) => (locked[r * LETTER_SIZE + c] ? letters16[r * LETTER_SIZE + c] : null)));
  }

  const rowCandidates = [];
  const colCandidates = [];
  for (let r = 0; r < LETTER_SIZE; r++) {
    rowCandidates.push(rowValid[r] ? [rowWord(letters16, r)] : patternFilter(ALL_WORDS, rowKnown[r]));
  }
  for (let c = 0; c < LETTER_SIZE; c++) {
    colCandidates.push(colValid[c] ? [colWord(letters16, c)] : patternFilter(ALL_WORDS, colKnown[c]));
  }
  if (rowCandidates.some((list) => list.length === 0) || colCandidates.some((list) => list.length === 0)) {
    return { canForm: false };
  }

  // A generous but finite cap — purely a safety net in case some future
  // puzzle state turns out far more expensive than anything in testing;
  // never actually hit in the validated worst case (a few hundred steps).
  const STEP_LIMIT = 200000;
  let steps = 0;

  function backtrack(idx, remainingCounts, rowCands, colCands, rowKnownNow, colKnownNow) {
    steps++;
    if (steps > STEP_LIMIT) return 'LIMIT';
    if (idx === freeCells.length) return true;

    const cellIndex = freeCells[idx];
    const r = Math.floor(cellIndex / LETTER_SIZE);
    const c = cellIndex % LETTER_SIZE;

    const fromRow = new Set(rowCands[r].map((w) => w[c]));
    const fromCol = new Set(colCands[c].map((w) => w[r]));

    for (const letter of fromRow) {
      if (!fromCol.has(letter)) continue;
      const code = letter.charCodeAt(0) - 65;
      if (remainingCounts[code] <= 0) continue;

      const newCounts = remainingCounts.slice();
      newCounts[code]--;

      const newRowKnown = rowKnownNow.slice();
      newRowKnown[r] = newRowKnown[r].slice();
      newRowKnown[r][c] = letter;
      const newColKnown = colKnownNow.slice();
      newColKnown[c] = newColKnown[c].slice();
      newColKnown[c][r] = letter;

      const newRowCands = rowCands.slice();
      newRowCands[r] = rowValid[r] ? rowCands[r] : patternFilter(rowCands[r], newRowKnown[r]);
      const newColCands = colCands.slice();
      newColCands[c] = colValid[c] ? colCands[c] : patternFilter(colCands[c], newColKnown[c]);

      if (newRowCands[r].length === 0 || newColCands[c].length === 0) continue;

      const result = backtrack(idx + 1, newCounts, newRowCands, newColCands, newRowKnown, newColKnown);
      if (result === true || result === 'LIMIT') return result;
    }
    return false;
  }

  const result = backtrack(0, freeLetterCounts, rowCandidates, colCandidates, rowKnown, colKnown);
  return { canForm: result === true };
}

$(function () {

  const $grid = $('#grid');

  // --- Seeded PRNG — identical technique to SLYDZ's (see the fuller
  // explanation in games/slydz/index.js), just a different multiplier
  // (751, also prime) so the two games' daily "randomness" doesn't happen
  // to coincide day for day. ---
  function seededPseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  function getSeededInt(min, max, seed) {
    return Math.floor(seededPseudoRandom(seed) * (max - min + 1)) + min;
  }

  function seededShuffle(array, seed) {
    const result = array.slice();
    let s = seed;
    for (let i = result.length - 1; i > 0; i--) {
      const j = getSeededInt(0, i, s++);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // True only if EVERY row and EVERY column of this exact 16-letter
  // arrangement is simultaneously a valid word — used only when building
  // each day's puzzle, to make sure the starting scramble isn't
  // accidentally already solved (see below).
  function isFullySolvedArrangement(letters16) {
    for (let r = 0; r < LETTER_SIZE; r++) if (!checkWord(rowWord(letters16, r))) return false;
    for (let c = 0; c < LETTER_SIZE; c++) if (!checkWord(colWord(letters16, c))) return false;
    return true;
  }

  // Builds one day's puzzle from the curated data: the 4 across words
  // concatenate into the 16 "answer" letters (also used by the "Solve
  // puzzle" dev shortcut, since restoring this exact order is guaranteed to
  // win), then those letters get deterministically shuffled into the
  // scrambled starting arrangement the player actually sees.
  function buildDailyPuzzle(day) {
    const rows = PUZZLES_366[day - 1];
    const answerLetters = rows.join('').split('');

    let seed = day * 751;
    let shuffled;
    do {
      shuffled = seededShuffle(answerLetters, seed);
      seed += 1000; // jump well ahead in the sequence if another attempt is ever needed
    } while (isFullySolvedArrangement(shuffled));

    return { rows, answerLetters, startLetters: shuffled };
  }

  const todayDayOfYear = dayOfYear();
  const puzzle = buildDailyPuzzle(todayDayOfYear);

  // A debugging aid, same spirit as SLYDZ's — prints ONE guaranteed-valid
  // solution to the console (not necessarily the only one).
  console.log(`🧩 QUADZ Daily Puzzle (Day ${todayDayOfYear} of 366):`);
  console.log('One valid solution:', puzzle.rows.join(' / '));

  // Builds all 25 cells of the 5x5 grid, tagging each by role:
  //   rows 0-3, cols 0-3   -> letter tile   (data-row / data-col, 0-indexed)
  //   rows 0-3, col 4      -> row-tick cell (data-tick-row)
  //   row 4,   cols 0-3    -> col-tick cell (data-tick-col)
  //   row 4,   col 4       -> invisible spacer
  function buildGrid() {
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (r < LETTER_SIZE && c < LETTER_SIZE) {
          $('<div>', { class: 'tile letter-tile', 'data-row': r, 'data-col': c }).appendTo($grid);
        } else if (r < LETTER_SIZE && c === LETTER_SIZE) {
          $('<div>', { class: 'tile tick-cell', 'data-tick-row': r }).appendTo($grid);
        } else if (r === LETTER_SIZE && c < LETTER_SIZE) {
          $('<div>', { class: 'tile tick-cell', 'data-tick-col': c }).appendTo($grid);
        } else {
          $('<div>', { class: 'tile tile-hidden' }).appendTo($grid);
        }
      }
    }
  }
  buildGrid();

  // Writes a 16-letter array into the 16 letter tiles, in DOM order — which
  // is row-major (r0c0, r0c1, r0c2, r0c3, r1c0, ...) since buildGrid() above
  // creates them in that same order, so index i always means letters16[i].
  function applyLetters(letters16) {
    $('.letter-tile').each(function (i) { $(this).text(letters16[i]); });
  }

  function captureLetters() {
    return $('.letter-tile').map(function () { return $(this).text(); }).get();
  }

  function getRowLetters(r) {
    return $(`.letter-tile[data-row="${r}"]`).map(function () { return $(this).text(); }).get();
  }

  function getColLetters(c) {
    return $(`.letter-tile[data-col="${c}"]`).map(function () { return $(this).text(); }).get();
  }

  // Tracks each row/column's PREVIOUS validity, so the tick cells only
  // animate on an actual change — not on every single check (a swap
  // usually only affects 2 rows and 2 columns anyway, but even those
  // shouldn't replay the animation if they were already valid/invalid).
  const rowValid = new Array(LETTER_SIZE).fill(false);
  const colValid = new Array(LETTER_SIZE).fill(false);

  // Grows the checkmark in (word just became valid) or shrinks it back out
  // (word just stopped being valid) — see the matching keyframes in
  // style.css. `is-valid` controls the checkmark's actual presence (via
  // ::before content) and is removed only once the shrink animation has had
  // time to finish, so the disappearing checkmark is what's animating
  // rather than an instant pop-out.
  function animateTick($tickEl, isValid) {
    if (isValid) {
      $tickEl.removeClass('tick-disappear').addClass('is-valid tick-appear');
      setTimeout(() => $tickEl.removeClass('tick-appear'), 350);
    } else {
      $tickEl.addClass('tick-disappear');
      setTimeout(() => $tickEl.removeClass('is-valid tick-disappear'), 350);
    }
  }

  // Re-checks every row AND every column after each swap: updates each
  // tick cell (animating only on a state change), and returns whether the
  // WHOLE puzzle is solved (all 4 rows AND all 4 columns valid at once).
  function updateGridValidity() {
    for (let r = 0; r < LETTER_SIZE; r++) {
      const isValid = checkWord(getRowLetters(r).join(''));
      if (isValid !== rowValid[r]) {
        animateTick($(`.tick-cell[data-tick-row="${r}"]`), isValid);
        rowValid[r] = isValid;
      }
    }
    for (let c = 0; c < LETTER_SIZE; c++) {
      const isValid = checkWord(getColLetters(c).join(''));
      if (isValid !== colValid[c]) {
        animateTick($(`.tick-cell[data-tick-col="${c}"]`), isValid);
        colValid[c] = isValid;
      }
    }
    return rowValid.every(Boolean) && colValid.every(Boolean);
  }

  // --- Timer ---
  let totalSeconds = 0;
  let timerInterval = null;

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    shell.timer.setSeconds(totalSeconds);
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      totalSeconds++;
      updateTimerDisplay();
      persistProgress(false);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  // `usedHelp`/`revealed` are read by persistProgress() below, but only
  // need to be DECLARED before persistProgress() is ever CALLED (not
  // before they're merely defined) — see games/slydz/index.js's matching
  // comment for the fuller explanation. The rest of the help-toggle/
  // reveal-solution machinery is built further down, after initShell()
  // runs, since the help button attaches to the header that creates.
  let usedHelp = false;
  let revealed = false; // true once the player has given up and seen the answer, for today

  // --- Persistence (supports resume-in-progress) ---
  function persistProgress(completed) {
    saveProgress(GAME_ID, { letters: captureLetters(), seconds: totalSeconds, usedHelp, revealed }, { completed });
  }

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'QUADZ',
    emoji: '✅',
    // Same single tick-cell tile shown on this game's hub tile — see
    // games/quadz/tile-icon.js and games-registry.js.
    emojiImage: getTileIconDataURL('✓', true),
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`) instead of the shared global blue every game used before.
    accentColor: { bg: '#DFAE55', ink: '#5A3705', rim: 'rgba(90, 55, 5, 0.30)' },
    instructions: '<p>Drag tiles to swap letters</p><p>Make every row AND every column spell a real word to win</p><p>Use help 💡 if you need it</p>',
    formatScore: formatTime,
  });

  // --- Help toggle (QUADZ-only, same UI as SLYDZ's — see the fuller
  // explanation of this DOM-injection pattern in games/slydz/index.js) ---
  const HELP_MIN_CORRECT_WORDS = 2; // counts rows AND columns together, out of 8 total

  let helpOn = false;

  const $helpToggle = $('<button>', {
    class: 'help-toggle is-hidden',
    type: 'button',
    html: '💡 Help',
    'aria-label': 'Toggle help',
  }).appendTo('.shell-header');

  const $helpPopover = $('<div>', {
    class: 'help-popover is-hidden',
    html: '<p id="quadz-help-text"></p>',
  }).appendTo('.shell-header');
  const $helpText = $helpPopover.find('#quadz-help-text');

  // Unlike SLYDZ's search (a pure letter-count question), QUADZ's is a
  // real positional constraint search — see canCompleteRemainingCells()
  // near the top of this file for why, and for how it stays fast.
  function computeHelpMessage() {
    const validCount = rowValid.filter(Boolean).length + colValid.filter(Boolean).length;
    if (validCount < HELP_MIN_CORRECT_WORDS) {
      return {
        eligible: false,
        html: `Help is only available when you have ${HELP_MIN_CORRECT_WORDS} or more correct words.`,
      };
    }

    const remaining = 8 - validCount;
    const { canForm } = canCompleteRemainingCells(captureLetters(), rowValid, colValid);

    const wordOrWords = remaining === 1 ? 'word' : 'words';
    const verdict = canForm
      ? '<strong class="help-can">CAN</strong>'
      : '<strong class="help-cannot">CANNOT</strong>';

    return {
      eligible: true,
      html: `${validCount} words formed - the remaining letters ${verdict} be used to make up ${remaining} more ${wordOrWords} ✅`,
    };
  }

  function toggleHelp() {
    if (helpOn) {
      turnOffHelp();
      return;
    }
    helpOn = true;
    $helpToggle.addClass('is-active');
    const { eligible, html } = computeHelpMessage();
    $helpText.html(html);
    $helpPopover.removeClass('is-hidden');

    // Only counts as "using help" if a real hint was actually shown — being
    // told help isn't available yet doesn't reveal anything about the
    // puzzle, so it shouldn't tag the eventual win as help-assisted.
    if (eligible && !usedHelp) {
      usedHelp = true;
      persistProgress(false); // record the flag immediately, don't wait for the next timer tick
    }
  }

  $helpToggle.on('click', toggleHelp);

  // Closes the popover without recomputing anything — used both by
  // clicking the toggle again, and automatically the moment the player
  // moves another tile, so stale help never lingers on screen once the
  // board has changed underneath it.
  function turnOffHelp() {
    if (!helpOn) return;
    helpOn = false;
    $helpToggle.removeClass('is-active');
    $helpPopover.addClass('is-hidden');
  }

  // Only shown while a round is actually being played.
  function showHelpToggle() {
    $helpToggle.removeClass('is-hidden');
  }

  function hideHelpToggle() {
    $helpToggle.addClass('is-hidden');
    turnOffHelp();
  }

  // --- Reveal solution (QUADZ-only) — a deliberately more understated
  // control than Play/Help, since unlike help this one ENDS today's round
  // rather than just assisting: a plain text-style button below the board
  // rather than a header pill. Built once, appended straight into
  // #game-root (the game's own play area) — shown/hidden on the same
  // schedule as the help toggle.
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

  // A custom confirm panel instead of the native window.confirm() — that
  // popup rendered as a bare OS-styled dialog disconnected from the game
  // (wrong font, wrong colors, could show up anywhere on screen depending
  // on browser/OS). This one is just another absolutely-positioned panel
  // inside #game-stage, directly reusing shell.js's own .shell-overlay/
  // .shell-overlay__panel/.shell-end-screen__message classes (rather than
  // a separate near-identical copy of the same rules) — so it reliably
  // lands centered right over the board like a native dialog would, AND
  // can never visually drift out of sync with the start banner/end-screen
  // the way a fully separate copy of the same CSS eventually did.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-end-screen__message">
          <p class="shell-end-screen__title">Reveal today's solution?</p>
          <p>You won't be able to complete QUADZ yourself today.</p>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="quadz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="quadz-reveal-confirm">Reveal Solution</button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  $revealConfirm.find('#quadz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
  });
  $revealConfirm.find('#quadz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    revealSolution();
  });

  $revealBtn.on('click', () => {
    if (locked) return;
    $revealConfirm.removeClass('is-hidden');
  });

  // Locked until Play Now / Resume is pressed.
  let locked = true;

  // Shared by both a real player win and the dev "Solve puzzle" shortcut
  // below — see games/slydz/index.js's handleWin() for the same pattern.
  function handleWin() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButton();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayOutcome(GAME_ID, { revealed: false, usedHelp, failed: false, isNewBest: result.isNewBest, isTie: result.isTie });
    // A trailing <p> of its own (rather than appended inside the last
    // sentence's own <p>) so it gets the exact same paragraph spacing as
    // every other line, present or not.
    const helpNote = usedHelp ? '<p>(solved with help 💡)</p>' : '';
    const wellDoneMessage = `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p><p>you scored ${formatTime(totalSeconds)}</p><p>see if you can do even better tomorrow</p>${helpNote}`;
    // No previous best at all (first-ever play) or a previous best of
    // exactly 0 would make "new best"/"equaled best" messaging read oddly
    // this early on — fall back to the plain WELL DONE message for both.
    const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
    const message = hasNoMeaningfulBest
      ? wellDoneMessage
      : result.isNewBest
        ? `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p><p>You scored ${formatTime(totalSeconds)}</p><p>That is a new <strong style="color: var(--shell-accent)">PERSONAL BEST</strong></p>${helpNote}`
        : result.isTie
          ? `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p><p>you equaled your best score of ${formatTime(totalSeconds)}</p><p>Let's go for a personal best tomorrow</p>${helpNote}`
          : wellDoneMessage;
    shell.showEndScreen({
      message,
      shareText: `🧩 QUADZ — solved in ${formatTime(totalSeconds)}!${usedHelp ? ' (with help 💡)' : ''}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Reachable only via the player's own confirmed choice to give up (see
  // the $revealBtn click handler above) — reveals the actual solution,
  // locks the board same as a real finish, but records it as a NON-win (no
  // submitScore(), no celebrate/confetti) and shows a "better luck
  // tomorrow" message instead of a congratulations, same spirit as
  // MUVEEZ's handleLoss() (see games/muveez/index.js).
  function revealSolution() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButton();
    revealed = true;
    applyLetters(puzzle.answerLetters);
    updateGridValidity();
    persistProgress(true);
    // No submitScore() call on this path — isNewBest/isTie are always false,
    // since giving up never sets a best. usedHelp still reflects whatever
    // the player actually did before giving up.
    saveTodayOutcome(GAME_ID, { revealed: true, usedHelp, failed: false, isNewBest: false, isTie: false });
    shell.showEndScreen({
      message: `<p class="shell-end-screen__title"><strong>BAD LUCK 😢</strong></p><p>you failed to win the game today</p><p>better luck tomorrow</p>`,
      shareText: `🧩 QUADZ — couldn't solve it today!`,
      // No `celebrate` here — giving up is explicitly not a celebration moment.
    });
  }

  // Testing shortcut: instantly restores the day's guaranteed-valid letter
  // arrangement and ends the game, same as a real win.
  function solvePuzzle() {
    shell.hideStartBanner();
    applyLetters(puzzle.answerLetters);
    updateGridValidity();
    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }] });

  enableTileDragSwap({
    container: document.getElementById('game-root'),
    tileSelector: '.letter-tile', // tick cells and the hidden spacer are never draggable
    isLocked: () => locked,
    canSwap: () => true, // any letter tile can swap with any other
    onSwap: (a, b) => {
      turnOffHelp(); // any move closes stale help so it never lingers on a now-outdated board

      const $a = $(a), $b = $(b);
      const aText = $a.text();
      const bText = $b.text();
      $a.text(bText);
      $b.text(aText);

      $a.addClass('tile-swapped');
      $b.addClass('tile-swapped');
      setTimeout(() => { $a.removeClass('tile-swapped'); $b.removeClass('tile-swapped'); }, 200);

      const solved = updateGridValidity();
      if (solved) {
        handleWin();
      } else {
        persistProgress(false);
      }
    },
  });

  // Same three-way daily-status branch as every other game — see the
  // fuller explanation in games/solvz/index.js.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false; // `|| false` covers old saves from before this field existed
    revealed = data.revealed || false;
    updateTimerDisplay();
    updateGridValidity();
    // No `celebrate` on this branch either way — this only runs when
    // revisiting a day already finished in an EARLIER session, not on the
    // actual moment of winning/revealing, so it shouldn't replay confetti.
    if (revealed) {
      shell.showEndScreen({
        message: `<p class="shell-end-screen__title"><strong>BAD LUCK 😢</strong></p><p>you failed to win the game today</p><p>better luck tomorrow</p>`,
        shareText: `🧩 QUADZ — couldn't solve it today!`,
      });
    } else {
      const helpNote = usedHelp ? '<p>(solved with help 💡)</p>' : '';
      shell.showEndScreen({
        message: `<p>You already solved today's QUADZ in ${formatTime(totalSeconds)}.</p><p>Hope to see you tomorrow.</p>${helpNote}`,
        shareText: `🧩 QUADZ — solved in ${formatTime(totalSeconds)}!${usedHelp ? ' (with help 💡)' : ''}`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false;
    updateTimerDisplay();
    updateGridValidity();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButton();
      startTimer();
    }, { label: 'Resume' });
  } else {
    applyLetters(puzzle.startLetters);
    updateGridValidity(); // in case the scramble happens to land a row/column on a real word already
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButton();
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

});
