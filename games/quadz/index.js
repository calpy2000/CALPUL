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
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { PUZZLES_366 } from './puzzles.js';
import { ALL_WORDS } from './words.js';
import { getTileIconDataURL } from './tile-icon.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

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

  // True if ANY single row or column of this 16-letter arrangement already
  // spells a valid word — used only when building each day's puzzle, to
  // make sure the starting scramble doesn't hand the player a free tick on
  // day one. A lone pre-solved row/column isn't just a mild head start: the
  // tick that lights up for it makes testers believe THAT word is part of
  // the actual daily answer, when it's really just shuffle coincidence (the
  // real answer word for that row/column is whatever's in PUZZLES_366,
  // which the shuffle has almost certainly scattered elsewhere). Subsumes
  // the old fully-solved-only check, since a fully solved grid trivially
  // has every row pre-solved too.
  function hasAnyPreSolvedLine(letters16) {
    for (let r = 0; r < LETTER_SIZE; r++) if (checkWord(rowWord(letters16, r))) return true;
    for (let c = 0; c < LETTER_SIZE; c++) if (checkWord(colWord(letters16, c))) return true;
    return false;
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
    } while (hasAnyPreSolvedLine(shuffled));

    return { rows, answerLetters, startLetters: shuffled };
  }

  const todayDayOfYear = dayOfYear();
  const puzzle = buildDailyPuzzle(todayDayOfYear);

  // A debugging aid, same spirit as SLYDZ's — prints ONE guaranteed-valid
  // solution to the console (not necessarily the only one).
  console.log(`🧩 QUADZ Daily Puzzle (Day ${todayDayOfYear} of 366):`);
  console.log('One valid solution:', puzzle.rows.join(' / '));

  // Today's own 8-word canonical answer — the 4 stored ACROSS words plus
  // the 4 DOWN words read off puzzle.answerLetters's own (unshuffled)
  // arrangement, i.e. exactly what "Reveal solution" shows. Computed once
  // since the puzzle itself never changes mid-round — used by the help
  // popover's "words found from this solution" line below (see
  // getFoundSolutionWords()), which is a stricter question than
  // checkWord()'s "any dictionary word wins": a row/column can be validly
  // formed with a real word that ISN'T one of these 8, since QUADZ accepts
  // any dictionary word, not just the curated one for that line.
  const SOLUTION_WORDS = [
    ...puzzle.rows,
    colWord(puzzle.answerLetters, 0),
    colWord(puzzle.answerLetters, 1),
    colWord(puzzle.answerLetters, 2),
    colWord(puzzle.answerLetters, 3),
  ];

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
  let rowRevealed = false; // true once the player has used the "Reveal row 1" assist, for today
  let colRevealed = false; // true once the player has used the "Reveal column 1" assist, for today

  // --- Persistence (supports resume-in-progress) ---
  function persistProgress(completed) {
    saveProgress(GAME_ID, { letters: captureLetters(), seconds: totalSeconds, usedHelp, revealed, rowRevealed, colRevealed }, { completed });
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

  // A plain container, not a single <p> — computeHelpMessage() below now
  // builds its "eligible" html as several separate <p> sentences (see
  // .help-popover p's margin-bottom in style.css) so the gap BETWEEN
  // sentences can be a deliberate half-line-height, distinct from the
  // tighter line-height governing wrapped lines within any one sentence.
  const $helpPopover = $('<div>', {
    class: 'help-popover is-hidden',
    html: '<div id="quadz-help-text"></div>',
  }).appendTo('.shell-header');
  const $helpText = $helpPopover.find('#quadz-help-text');

  // Of the rows/columns CURRENTLY sitting valid on the board, which happen
  // to also be one of today's own 8 SOLUTION_WORDS specifically (rather
  // than just some other valid dictionary word)? remainingSolutionWords is
  // consumed as matches are found so a word occurring twice in the
  // solution can't be credited twice from a single occurrence on the
  // board.
  function getFoundSolutionWords() {
    const remainingSolutionWords = SOLUTION_WORDS.slice();
    const letters16 = captureLetters();
    const found = [];

    function tryMatch(word) {
      const idx = remainingSolutionWords.indexOf(word);
      if (idx === -1) return;
      found.push(word);
      remainingSolutionWords.splice(idx, 1);
    }

    for (let r = 0; r < LETTER_SIZE; r++) if (rowValid[r]) tryMatch(rowWord(letters16, r));
    for (let c = 0; c < LETTER_SIZE; c++) if (colValid[c]) tryMatch(colWord(letters16, c));

    return found;
  }

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

    const foundSolutionWords = getFoundSolutionWords();
    const foundCountHtml = `<strong>${foundSolutionWords.length}</strong>`;
    const foundWordOrWords = foundSolutionWords.length === 1 ? 'word' : 'words';
    // Zero found gets a full stop and no dangling "found 0 words ...:"
    // colon with nothing after it — the list (bolded, one per matched
    // word) only appears once there's actually something to show.
    const foundSentence = foundSolutionWords.length > 0
      ? `So far you have found ${foundCountHtml} ${foundWordOrWords} from this solution:<br>${foundSolutionWords.map((w) => `<strong>${w}</strong>`).join(', ')}`
      : `So far you have found ${foundCountHtml} ${foundWordOrWords} from this solution.`;

    return {
      eligible: true,
      // Each sentence is its own <p> rather than one block joined by <br>s
      // — see .help-popover p's margin-bottom (style.css) for the actual
      // gap between them. Keeps that gap independent of line-height, which
      // still (and only) governs the tighter spacing WITHIN a sentence
      // that happens to wrap to more than one line inside the popover's
      // fixed width.
      html: `<p><strong>${validCount}</strong> words formed.</p>`
        + `<p>The remaining letters ${verdict} be used to make up ${remaining} more ${wordOrWords}.</p>`
        + `<p>There is at least one solution to the puzzle and one of these is our solution for today.</p>`
        + `<p>${foundSentence}</p>`,
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

  // Closes the popover on a click/tap anywhere else on the page — e.g. the
  // grid, header, footer — not just by re-clicking the help toggle itself.
  // Bound on `document` rather than the popover/toggle, so it naturally
  // only fires once the click has bubbled past anything that should NOT
  // close it; excluding clicks that land inside the toggle button or the
  // popover itself is what stops this from immediately closing the
  // popover on the very same click that just opened it.
  document.addEventListener('click', (e) => {
    if (!helpOn) return;
    if ($helpToggle[0].contains(e.target) || $helpPopover[0].contains(e.target)) return;
    turnOffHelp();
  });

  // Only shown while a round is actually being played.
  function showHelpToggle() {
    $helpToggle.removeClass('is-hidden');
  }

  function hideHelpToggle() {
    $helpToggle.addClass('is-hidden');
    turnOffHelp();
  }

  // --- Reveal slide & swap animation ---
  // QUADZ never introduces new letters — every letter a reveal needs is
  // already sitting somewhere else among the same 16 tiles. So instead of
  // silently overwriting cells, a reveal finds where each needed letter
  // currently lives and animates it sliding there while the tile that was
  // occupying that cell slides out to swap into the spot just vacated —
  // the same two-tile exchange the player performs by dragging, just
  // triggered automatically. Validated as a standalone prototype (an
  // Artifact demo) before landing here — see revealRow1()/revealCol1()/
  // revealSolution() below for how the three reveal buttons each call
  // into this.

  // For a set of target cells, works out which swaps get each one holding
  // its required letter. Built as a sequence of BATCHES rather than one
  // flat list: within a batch, every swap uses two cells untouched by any
  // OTHER swap in that same batch, so the whole batch can slide in
  // parallel — which is the common case (a needed letter almost always
  // exists somewhere outside the target set). A cell only needs a second
  // batch when the only remaining copy of its letter is trapped inside
  // another still-wrong target cell (e.g. every full-solution reveal,
  // where the entire grid is the target set, so "outside" is empty and
  // this can chain into a genuine multi-step cycle) — the while loop
  // below just keeps building batches until nothing's left to fix, which
  // for row/column reveals (4 of 16 cells) resolves in a single batch in
  // practice, and for a full-solution reveal takes as many batches as the
  // underlying permutation's longest cycle requires.
  //
  // isSettled(cell)'s role in the source search below is load-bearing, not
  // cosmetic: QUADZ's daily words repeat letters constantly (this file's
  // own SLYDZ-comparison note above already flags how common that is), so
  // a swap's source must never be pulled from a cell that already holds
  // its own true final-answer letter — even though its letter happens to
  // match what some other cell needs. Stealing it would silently corrupt
  // an already-correct cell.
  //
  // Two bugs were found and fixed here, in order:
  // (1) A stress test of 20,000 random scrambles against the daily
  //     SHOW/LIVE/ORAL/TELL puzzle failed on over 60% of single-reveal
  //     trials before "already correct" cells were excluded from the
  //     source search at all — a cell within the CURRENT reveal's own
  //     target set could get raided to satisfy another cell in that same
  //     set. Fixed by excluding cells matching their own targetMap entry.
  // (2) That fix alone still broke a REAL sequence a tester hit live:
  //     reveal row 1 (correct), then reveal column 1 — the column reveal
  //     doesn't know or care that a cell OUTSIDE its own target set was
  //     already correctly settled by the earlier row reveal, so it happily
  //     stole a letter from it. "Settled" now checks against the FULL
  //     daily answer (fullAnswer), not just the current call's own narrow
  //     targetMap, so a cell fixed by any EARLIER reveal — or correct by
  //     sheer luck — is permanently off-limits to every LATER reveal too,
  //     not just to itself. Re-stress-tested 20,000 trials each for row1,
  //     col1, and full alone, plus 20,000 row1-then-col1 sequences
  //     checking row1 survives the second reveal: 0 failures across all of
  //     it. Re-run that kind of check before ever touching this function
  //     again. Letter-count conservation guarantees a valid unsettled
  //     source always exists, so this exclusion never leaves a cell
  //     unresolved.
  function computeRevealPlan(currentLetters16, targetIndices, targetLetters, fullAnswer) {
    const working = currentLetters16.slice();
    const targetMap = new Map();
    targetIndices.forEach((cell, k) => targetMap.set(cell, targetLetters[k]));
    const isSettled = (cell) => working[cell] === fullAnswer[cell];

    const batches = [];
    let guard = 0; // 16 cells can never need more than 16 passes to settle; this just stops a logic error from hanging the page
    while (targetIndices.some((cell) => working[cell] !== targetMap.get(cell)) && guard++ < 16) {
      const usedThisBatch = new Set();
      const batch = [];
      targetIndices.forEach((cell) => {
        if (usedThisBatch.has(cell) || working[cell] === targetMap.get(cell)) return;
        const need = targetMap.get(cell);
        // Prefer a source outside the whole target set (keeps this cell's
        // swap independent of every other target cell's swap); only fall
        // back to a not-yet-finalized target cell if nothing outside has
        // the letter. Either way, a settled cell is never eligible.
        let source = -1;
        for (let c = 0; c < 16; c++) {
          if (c === cell || usedThisBatch.has(c) || targetMap.has(c) || isSettled(c)) continue;
          if (working[c] === need) { source = c; break; }
        }
        if (source === -1) {
          for (let c = 0; c < 16; c++) {
            if (c === cell || usedThisBatch.has(c) || isSettled(c)) continue;
            if (working[c] === need) { source = c; break; }
          }
        }
        if (source === -1) return; // letter count guarantee means this shouldn't happen; leave for the next pass rather than throw
        batch.push([cell, source]);
        usedThisBatch.add(cell);
        usedThisBatch.add(source);
        [working[cell], working[source]] = [working[source], working[cell]];
      });
      batches.push(batch);
    }
    return batches;
  }

  function tileElAt(i) {
    const r = Math.floor(i / LETTER_SIZE), c = i % LETTER_SIZE;
    return document.querySelector(`.letter-tile[data-row="${r}"][data-col="${c}"]`);
  }

  const SLIDE_MS = 1000;
  const SLIDE_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)'; // slow start (pick up) -> fast middle -> slow finish (place)

  // Swaps textContent instantly, then uses a transform to make each tile
  // LOOK like it hasn't moved yet (still sitting at its old screen position
  // even though it now shows its new letter), then animates that transform
  // back to zero — so what the eye sees is the LETTER traveling smoothly
  // between the two real cells, even though neither DOM element ever
  // changes which grid cell (data-row/data-col) it belongs to. Standard
  // FLIP technique; the double rAF is what makes the browser register the
  // "invert" transform as a real starting point before animating away from it.
  function slideExchange(elA, elB) {
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();
    const dx = rectB.left - rectA.left;
    const dy = rectB.top - rectA.top;
    const letterA = elA.textContent;
    const letterB = elB.textContent;

    elA.textContent = letterB;
    elB.textContent = letterA;

    [[elA, dx, dy], [elB, -dx, -dy]].forEach(([el, tx, ty]) => {
      el.style.zIndex = '5';
      el.style.transition = 'none';
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      [elA, elB].forEach((el) => {
        el.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;
        el.style.transform = 'translate(0, 0)';
      });
    }));

    setTimeout(() => {
      [elA, elB].forEach((el) => {
        el.style.zIndex = '';
        el.style.transition = '';
        el.style.transform = '';
      });
    }, SLIDE_MS + 60);
  }

  // Plays each batch's swaps in parallel, waits for the slide to finish,
  // then moves on to the next batch — batches only ever chain when a
  // reveal's target set can't resolve in one parallel pass (see
  // computeRevealPlan() above). onDone runs once every batch has played.
  function playRevealBatches(batches, onDone) {
    let i = 0;
    function playNext() {
      if (i >= batches.length) { onDone(); return; }
      batches[i++].forEach(([a, b]) => slideExchange(tileElAt(a), tileElAt(b)));
      setTimeout(playNext, SLIDE_MS + 80);
    }
    playNext();
  }

  // --- Reveal assists (QUADZ-only) — three deliberately understated,
  // stacked text-style buttons below the board rather than header pills,
  // forming a difficulty ladder alongside Help: Help (free, never touches
  // the board) -> Reveal Row 1 -> Reveal Column 1 -> Reveal full solution
  // (the only one of the three that ENDS today's round — the two partial
  // reveals let the player keep playing afterwards). Built once, appended
  // straight into #game-root (the game's own play area) — shown/hidden on
  // the same schedule as the help toggle, except a partial reveal already
  // used today stays hidden even while the others are shown (see
  // showRevealButtons()).
  const $revealActions = $('<div>', { class: 'reveal-actions' }).appendTo('#game-root');
  const $revealRowBtn = $('<button>', {
    class: 'reveal-btn is-hidden',
    type: 'button',
    text: 'Reveal row 1',
  }).appendTo($revealActions);
  const $revealColBtn = $('<button>', {
    class: 'reveal-btn is-hidden',
    type: 'button',
    text: 'Reveal column 1',
  }).appendTo($revealActions);
  const $revealBtn = $('<button>', {
    class: 'reveal-btn is-hidden',
    type: 'button',
    text: 'Reveal full solution',
  }).appendTo($revealActions);

  function showRevealButtons() {
    if (!rowRevealed) $revealRowBtn.removeClass('is-hidden');
    if (!colRevealed) $revealColBtn.removeClass('is-hidden');
    $revealBtn.removeClass('is-hidden');
  }

  function hideRevealButtons() {
    $revealRowBtn.addClass('is-hidden');
    $revealColBtn.addClass('is-hidden');
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
  //
  // Shared by all three reveal buttons (openRevealConfirm() below fills in
  // the title/body/confirm-label per target) rather than three near-
  // identical panels, since the explanation of WHY a reveal might disturb
  // the board already-placed is the same regardless of how much is being
  // revealed — only the row/column-specific wording and the "this ends
  // today's round" sentence (full solution only) differ.
  // Text block reuses .shell-overlay__instructions' styling (same
  // left-aligned multi-paragraph block the start-banner instructions use) —
  // NOT .shell-end-screen__message, which is now a single-line-only
  // truncated element for the redesigned end-of-game panel and would clip
  // this multi-sentence explainer.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title reveal-confirm__title"></p>
          <div class="reveal-confirm__body"></div>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="quadz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="quadz-reveal-confirm"></button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  // Same explanation for all three targets: QUADZ always accepts any
  // dictionary word, not just the curated daily solution (see checkWord()
  // above), so a row/column the player already solved a different way is a
  // real, common scenario — not an edge case worth burying in fine print.
  const REVEAL_EXPLAINER = '<p>For QUADZ there is always a daily solution, with 4 words across and 4 words down.</p>'
    + '<p>This solution may not be the only way to solve QUADZ, and may not contain any of the valid words you\'ve already found — revealing some or all of it may replace those words.</p>';

  let pendingRevealTarget = null; // 'row' | 'col' | 'full', set while the confirm panel is open

  function openRevealConfirm(target) {
    pendingRevealTarget = target;
    const titles = { row: 'Reveal Row 1?', col: 'Reveal Column 1?', full: "Reveal today's solution?" };
    const confirmLabels = { row: 'Reveal Row 1', col: 'Reveal Column 1', full: 'Reveal Solution' };
    // Only the full reveal ends the round — that's the one warning worth
    // calling out on top of the shared explainer above.
    const endingNote = target === 'full' ? '<p>You won\'t be able to complete QUADZ yourself today.</p>' : '';
    $revealConfirm.find('.reveal-confirm__title').text(titles[target]);
    $revealConfirm.find('.reveal-confirm__body').html(REVEAL_EXPLAINER + endingNote);
    $revealConfirm.find('#quadz-reveal-confirm').text(confirmLabels[target]);
    $revealConfirm.removeClass('is-hidden');
  }

  $revealConfirm.find('#quadz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    pendingRevealTarget = null;
  });
  $revealConfirm.find('#quadz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    if (pendingRevealTarget === 'row') revealRow1();
    else if (pendingRevealTarget === 'col') revealCol1();
    else if (pendingRevealTarget === 'full') revealSolution();
    pendingRevealTarget = null;
  });

  $revealRowBtn.on('click', () => {
    if (locked || rowRevealed) return;
    openRevealConfirm('row');
  });
  $revealColBtn.on('click', () => {
    if (locked || colRevealed) return;
    openRevealConfirm('col');
  });
  $revealBtn.on('click', () => {
    if (locked) return;
    openRevealConfirm('full');
  });

  // Reveals just the day's answer for Row 1 (indices 0-3 of answerLetters)
  // or Column 1 (indices 0, 4, 8, 12 — see colWord()'s same stride) by
  // sliding each needed letter in from wherever it currently sits (see the
  // slide & swap engine above) rather than silently overwriting cells, so
  // any different word the player already built elsewhere visibly trades
  // places instead of just vanishing. `locked` goes true only for the
  // ~1s the tiles are sliding — dragging or firing another reveal mid-
  // animation would fight the transforms these swaps are driving — then
  // false again since a partial reveal doesn't end the round: the player
  // keeps playing, same as if they'd solved that line themselves, so a win
  // right after one still goes through the normal handleWin() path.
  function revealRow1() {
    rowRevealed = true;
    $revealRowBtn.addClass('is-hidden');
    locked = true;
    const targetIndices = [0, 1, 2, 3];
    const targetLetters = puzzle.answerLetters.slice(0, LETTER_SIZE);
    const batches = computeRevealPlan(captureLetters(), targetIndices, targetLetters, puzzle.answerLetters);
    playRevealBatches(batches, () => {
      locked = false;
      if (updateGridValidity()) {
        handleWin();
      } else {
        persistProgress(false);
      }
    });
  }

  function revealCol1() {
    colRevealed = true;
    $revealColBtn.addClass('is-hidden');
    locked = true;
    const targetIndices = [0, LETTER_SIZE, LETTER_SIZE * 2, LETTER_SIZE * 3];
    const targetLetters = targetIndices.map((i) => puzzle.answerLetters[i]);
    const batches = computeRevealPlan(captureLetters(), targetIndices, targetLetters, puzzle.answerLetters);
    playRevealBatches(batches, () => {
      locked = false;
      if (updateGridValidity()) {
        handleWin();
      } else {
        persistProgress(false);
      }
    });
  }

  // Locked until Play Now / Resume is pressed.
  let locked = true;

  // Shared by both a real player win and the dev "Solve puzzle" shortcut
  // below — see games/slydz/index.js's handleWin() for the same pattern.
  function handleWin() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButtons();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
    // A meaningful PB needs a real previous best to have beaten — not the
    // player's first-ever play, and not a previous best of exactly 0 (see
    // end-panel-content.js's scenario-priority comment).
    const hasMeaningfulBest = result.previousBest !== null && result.previousBest !== 0;
    const isNewBest = hasMeaningfulBest && result.isNewBest;
    saveTodayOutcome(GAME_ID, {
      revealed: false, usedHelp, failed: false,
      isNewBest: result.isNewBest, isTie: result.isTie,
      panelOutcome: undefined, panelIsNewBest: isNewBest,
    });
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest,
      shareText: `🔢 QUADZ - solved in ${formatTime(totalSeconds)}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Reachable only via the player's own confirmed choice to give up (see
  // the $revealBtn click handler above) — reveals the actual solution via
  // the same slide & swap engine as the two partial reveals (a full-grid
  // reveal is just that engine's target set being all 16 cells, which can
  // take more than one batch if the underlying letter permutation has a
  // longer cycle — see computeRevealPlan() above), locks the board same as
  // a real finish, but records it as a NON-win (no submitScore(), no
  // celebrate/confetti) and shows a "better luck tomorrow" message instead
  // of a congratulations, same spirit as MUVEEZ's handleLoss() (see
  // games/muveez/index.js). Locking and stopping the timer happen up front
  // rather than after the slide, same as before — giving up should feel
  // immediate, only the reveal itself plays out.
  function revealSolution() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButtons();
    revealed = true;
    const targetIndices = Array.from({ length: 16 }, (_, i) => i);
    const batches = computeRevealPlan(captureLetters(), targetIndices, puzzle.answerLetters, puzzle.answerLetters);
    playRevealBatches(batches, () => {
      updateGridValidity();
      persistProgress(true);
      // No submitScore() call on this path — isNewBest/isTie are always false,
      // since giving up never sets a best. usedHelp still reflects whatever
      // the player actually did before giving up.
      saveTodayOutcome(GAME_ID, {
        revealed: true, usedHelp, failed: false, isNewBest: false, isTie: false,
        panelOutcome: 'reveal', panelIsNewBest: false,
      });
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: `🔢 QUADZ - did not solve today`,
        // No `celebrate` here — giving up is explicitly not a celebration moment.
      });
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
        outcome: 'reveal',
        shareText: `🔢 QUADZ - did not solve today`,
      });
    } else {
      // isNewBest falls back to false if this day was completed before
      // panelIsNewBest existed — no stored record of whether it was a
      // meaningful PB at the time.
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🔢 QUADZ - solved in ${formatTime(totalSeconds)}`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false;
    rowRevealed = data.rowRevealed || false;
    colRevealed = data.colRevealed || false;
    updateTimerDisplay();
    updateGridValidity();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButtons();
      startTimer();
    }, { label: 'Resume' });
  } else {
    applyLetters(puzzle.startLetters);
    updateGridValidity(); // initializes the tick cells to their (guaranteed all-false) starting state
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButtons();
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

});
