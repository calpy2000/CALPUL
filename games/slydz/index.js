// SLYDZ — a 5x5 grid of letter tiles. Drag tiles to swap letters until all
// five ROWS spell real words. The final arrangement doesn't have to match
// the day's starting words — any valid word in the dictionary counts for
// each row, same as the original standalone WYRDZ prototype this is based
// on (see 3 Calvin Projects/2 WYRDZ). Unlike that prototype, this version
// is a one-play-per-day puzzle (no countdown clock, no replay) using the
// shared daily-lock/resume/best-score framework, and its starting letters
// are the same for every player on a given day.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { ALL_WORDS, COMMON_WORDS } from './words.js';
import { getTileDataURL } from './tile-icon.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

const GAME_ID = 'slydz';

// A Set gives O(1) "is this word valid?" lookups (ALL_WORDS.includes(...)
// would have to scan up to ~12,900 entries every single time — a Set hashes
// them once, up front, so every later .has() check is effectively
// instant). Built once, at module load, since ALL_WORDS itself never
// changes.
const ALL_WORDS_SET = new Set(ALL_WORDS);

// The two source lists don't perfectly agree with each other — a handful of
// COMMON_WORDS entries (e.g. "DIRTY") aren't actually present in ALL_WORDS,
// a pre-existing inconsistency in the original word lists this was built
// from. That matters here specifically: every STARTING word picked below is
// relied on to also validate successfully (both for the "at least one
// solution is guaranteed" promise, and for the "Solve puzzle" dev
// shortcut), so starting words are only ever chosen from this filtered,
// guaranteed-to-validate subset — rather than from COMMON_WORDS directly.
const STARTING_WORD_POOL = COMMON_WORDS.filter((word) => ALL_WORDS_SET.has(word));

// --- Letter-count helpers for the "help" feature's word-finding search ---
// (module scope, not inside $(function(){}) below, since none of this
// touches the DOM — it's pure data, computed once regardless of how many
// times a player toggles help on).

// Turns a string into a 26-length array counting how many of each letter
// (A-Z) it contains — e.g. "ABBA" -> A:2, B:2, everything else 0. This
// "letter-frequency vector" representation is what makes the checks below
// fast: comparing two 26-number arrays is far cheaper than comparing
// strings letter-by-letter or generating anagrams.
function letterCounts(str) {
  const counts = new Array(26).fill(0);
  for (let i = 0; i < str.length; i++) {
    counts[str.charCodeAt(i) - 65]++; // 'A'.charCodeAt(0) === 65
  }
  return counts;
}

// True if `need` could be spelled using letters taken from `have` — i.e.
// every letter's count in `need` is at most its count in `have`. This is
// the "is this word makeable from these leftover letters?" test.
function fitsWithin(need, have) {
  for (let i = 0; i < 26; i++) {
    if (need[i] > have[i]) return false;
  }
  return true;
}

// Returns a NEW counts array with `used`'s letters removed from `have` —
// used when "spending" a word's letters out of the remaining pool during
// the recursive search below.
function subtractCounts(have, used) {
  const result = have.slice();
  for (let i = 0; i < 26; i++) result[i] -= used[i];
  return result;
}

// Every dictionary word's letter-frequency vector, precomputed once. The
// help feature's search below always works from a (much smaller) filtered
// copy of this list — see computeHelpMessage() — never the raw ~12,900
// entries directly at every step, which would be far too slow.
const WORD_LETTER_COUNTS = ALL_WORDS.map((word) => ({ word, counts: letterCounts(word) }));

$(function () {

  const SIZE = 5; // 5x5 grid: 5 rows, 5 columns
  const TOTAL_TILES = SIZE * SIZE;
  const $grid = $('#grid');

  // --- Seeded PRNG — same technique as SOLVZ's daily puzzle generator (see
  // the longer explanation in games/solvz/index.js) — deterministic,
  // "random-looking" numbers so every player gets the identical puzzle on
  // the same calendar day, with zero server/network involved. ---
  function seededPseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  function getSeededInt(min, max, seed) {
    return Math.floor(seededPseudoRandom(seed) * (max - min + 1)) + min;
  }

  // A Fisher-Yates shuffle (see the fuller explanation of this exact
  // algorithm in games/glympz/index.js's shuffleGrid()) — but driven by
  // getSeededInt() instead of Math.random(), so the SAME seed always
  // produces the SAME shuffled order. Returns a new array; doesn't modify
  // the one passed in (.slice() makes a copy first).
  function seededShuffle(array, seed) {
    const result = array.slice();
    let s = seed;
    for (let i = result.length - 1; i > 0; i--) {
      const j = getSeededInt(0, i, s++);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Checks whether a specific row's 5 letters currently spell a real word.
  // `letters` is an array of 5 single-character strings — .join('') glues
  // them back into one 5-letter string to look up.
  function checkRow(letters) {
    return ALL_WORDS_SET.has(letters.join(''));
  }

  // Checks whether ALL 5 rows of a full 25-letter arrangement are
  // simultaneously valid words — used only when building each day's puzzle,
  // to make sure the STARTING scramble isn't accidentally already solved
  // (see generateDailyPuzzle() below).
  function allRowsValid(letters25) {
    for (let r = 0; r < SIZE; r++) {
      const row = letters25.slice(r * SIZE, r * SIZE + SIZE);
      if (!checkRow(row)) return false;
    }
    return true;
  }

  // Builds one day's puzzle:
  //   1. Deterministically pick 5 DISTINCT words from COMMON_WORDS — this
  //      guarantees at least one valid solution exists (simply putting
  //      those 5 words back in their original rows), matching the
  //      "starting point comes from real words, so we know an answer
  //      exists" requirement.
  //   2. Concatenate their 25 letters into one array — this is
  //      `answerLetters`, ALSO used later by the "Solve puzzle" dev
  //      shortcut, since restoring this exact order is guaranteed to win.
  //   3. Deterministically shuffle those 25 letters into the scrambled
  //      starting arrangement the player actually sees.
  function generateDailyPuzzle(day) {
    // `day * 733` (733 is prime) gives each day its own starting point in
    // the pseudo-random sequence — a different multiplier than SOLVZ's
    // `day * 997`, so the two games' "randomness" doesn't happen to line up
    // day for day (not that it would matter functionally, just avoids any
    // odd coincidental pattern between them).
    let seed = day * 733;
    const usedIndices = new Set();
    const words = [];
    while (words.length < SIZE) {
      const idx = getSeededInt(0, STARTING_WORD_POOL.length - 1, seed++);
      if (usedIndices.has(idx)) continue; // skip a repeat pick, try the next seeded index instead — keeps the 5 starting words distinct
      usedIndices.add(idx);
      words.push(STARTING_WORD_POOL[idx]);
    }

    const answerLetters = words.join('').split('');

    // Keeps re-shuffling (from a freshly-advanced seed each time) until the
    // scrambled starting arrangement is NOT already fully solved — an
    // extremely unlikely coincidence, but cheap to guard against, the same
    // way GLYMPZ's shuffleGrid() re-rolls until exactly one tile lands
    // correctly rather than leaving it to chance.
    let shuffled;
    let shuffleSeed = seed;
    do {
      shuffled = seededShuffle(answerLetters, shuffleSeed);
      shuffleSeed += 1000; // jump well ahead in the seed sequence for the next attempt, if one's ever needed
    } while (allRowsValid(shuffled));

    return { words, answerLetters, startLetters: shuffled };
  }

  // Precomputes all 366 days' puzzles up front (enough for a leap year) —
  // same approach as SOLVZ, and cheap here too: each day is only a handful
  // of Set lookups and a 25-item shuffle.
  const PUZZLES_366 = [];
  for (let day = 1; day <= 366; day++) {
    PUZZLES_366.push(generateDailyPuzzle(day));
  }

  const todayDayOfYear = dayOfYear();
  const puzzle = PUZZLES_366[todayDayOfYear - 1];

  // A debugging aid, same spirit as SOLVZ's logSolution() — prints ONE
  // guaranteed-valid solution to the console. It's not necessarily the ONLY
  // solution (any dictionary word works per row), just a reliable one to
  // check against.
  console.log(`🔤 SLYDZ Daily Puzzle (Day ${todayDayOfYear} of 366):`);
  console.log('One valid solution:', puzzle.words.join(' / '));

  // Builds the 25 tile <div>s, empty of text for now — applyLetters()
  // (called further down, once we know whether to show a fresh puzzle or a
  // resumed/completed one) fills in the actual letters.
  function buildGrid() {
    for (let i = 0; i < TOTAL_TILES; i++) {
      const row = Math.floor(i / SIZE) + 1;
      const col = (i % SIZE) + 1;
      $('<div>', {
        class: `tile row${row}`,
        'data-row': row,
        'data-col': col,
        'data-index': i,
      }).appendTo($grid);
    }
  }
  buildGrid();

  // Writes a 25-letter array into the 25 tiles, in DOM order.
  function applyLetters(letters) {
    $('.tile').each(function (i) {
      $(this).text(letters[i]);
    });
  }

  // The inverse — reads the CURRENT text of every tile back into a plain
  // array, for saving progress.
  function captureLetters() {
    return $('.tile').map(function () { return $(this).text(); }).get();
  }

  // Reads the 5 letters currently in a given row (1-5), via the data-row
  // attribute buildGrid() set on each tile.
  function getRowLetters(row) {
    return $(`.tile[data-row="${row}"]`).map(function () { return $(this).text(); }).get();
  }

  // Re-checks every row after each swap: highlights any row that currently
  // spells a real word (adding the "valid-word" class to all 5 of that
  // row's tiles), un-highlights any row that no longer does, and returns
  // whether the WHOLE puzzle is solved (all 5 rows valid at once).
  function updateRowValidity() {
    let validCount = 0;
    for (let row = 1; row <= SIZE; row++) {
      const letters = getRowLetters(row);
      const isValid = checkRow(letters);
      $(`.tile[data-row="${row}"]`).toggleClass('valid-word', isValid);
      if (isValid) validCount++;
    }
    return validCount === SIZE;
  }

  // --- Help feature's word-finding search ---
  // Deliberately kept separate from updateRowValidity() above: that
  // function runs after EVERY swap (cheap — 5 Set lookups), while
  // everything below only ever runs when the player explicitly turns help
  // on, since searching for a full alternate solution is much more
  // expensive.
  //
  // Timed empirically (offline, 100 random trials per row-count): with 3
  // rows still unsolved, worst case was ~11ms; with 4 unsolved, ~218ms;
  // with 5 unsolved (nothing solved yet), a worst case over 10 SECONDS —
  // the search space blows up sharply in the last couple of rows. Rather
  // than chase further algorithmic optimization for a case that's rarely
  // useful anyway (telling a player "yes a solution exists" when they
  // haven't solved anything yet isn't much of a hint), help simply isn't
  // offered until at least this many rows are already correct, keeping the
  // worst case comfortably under ~15ms — well below where any UI delay
  // would be noticeable.
  const HELP_MIN_CORRECT_WORDS = 2;

  // Tries to assign `rowsNeeded` non-overlapping words (from `candidates`)
  // to fully consume `poolCounts`, recursively. Stops the instant ONE full
  // assignment is found — we only need one valid answer, not every possible
  // solution, so there's no reason to keep searching once one is found.
  // Returns `null` if no assignment is possible, or an ARRAY of the actual
  // words used if one is — the caller logs that list to the console so it
  // can be checked by hand while testing (see computeHelpMessage() below).
  //
  // `memo` is essential, not an optional optimization: without it, choosing
  // word A then word B is explored as a completely separate search branch
  // from choosing word B then word A, even though both leave the exact same
  // letters remaining afterward — for N rows that's an unnecessary N!
  // (factorial) blow-up in the number of branches explored. Caching "have
  // we already solved this exact (remaining letters, rows left) situation
  // before?" collapses all those equivalent orderings down to one
  // computation each. Confirmed necessary by testing: without this, some
  // random letter pools took well over a minute; with it, even the worst
  // cases tested stayed under a second.
  function canFormFromCounts(poolCounts, rowsNeeded, candidates, memo) {
    if (rowsNeeded === 0) return []; // nothing left to assign — success, no words needed at this level

    const key = rowsNeeded + '|' + poolCounts.join(',');
    if (memo.has(key)) return memo.get(key);

    let result = null;
    for (const candidate of candidates) {
      if (fitsWithin(candidate.counts, poolCounts)) {
        const remaining = subtractCounts(poolCounts, candidate.counts);
        const rest = canFormFromCounts(remaining, rowsNeeded - 1, candidates, memo);
        if (rest !== null) {
          // `[candidate.word, ...rest]` builds a NEW array: the current
          // word, followed by every item already inside `rest` "spread"
          // (unpacked) into place. E.g. if candidate.word is "TESTS" and
          // rest is ["ABIDE", "CRANE"], this produces ["TESTS", "ABIDE",
          // "CRANE"] — the `...` (spread syntax) is what unpacks rest's
          // contents rather than nesting it as a single array-within-an-
          // array (which plain `[candidate.word, rest]` would do instead).
          result = [candidate.word, ...rest];
          break; // no need to keep trying other candidates once one path succeeds
        }
      }
    }
    memo.set(key, result);
    return result;
  }

  // The actual entry point, called only when help is switched on (see
  // toggleHelp() below). Counts already-valid rows (easy), then — only if
  // the player has already found enough of them (HELP_MIN_CORRECT_WORDS)
  // and some rows are still unsolved — works out whether the leftover
  // letters from those rows COULD be rearranged into that many valid words
  // at all. Returns { eligible, html }: `eligible` is false (and no search
  // runs at all) if the player hasn't found enough words yet — that also
  // means turning help on in that state doesn't count toward `usedHelp`,
  // since nothing was actually revealed.
  function computeHelpMessage() {
    let validCount = 0;
    const remainingLetters = [];
    // Of the rows CURRENTLY sitting valid, which happen to also be one of
    // today's own 5 puzzle.words specifically (rather than just some other
    // valid dictionary word)? remainingSolutionWords is consumed as matches
    // are found so a word occurring twice in the solution can't be credited
    // twice from a single occurrence on the board — same approach as
    // games/quadz/index.js's getFoundSolutionWords(), just over rows only
    // (SLYDZ has no columns).
    const foundSolutionWords = [];
    const remainingSolutionWords = puzzle.words.slice();
    for (let row = 1; row <= SIZE; row++) {
      const letters = getRowLetters(row);
      if (checkRow(letters)) {
        validCount++;
        const word = letters.join('');
        const idx = remainingSolutionWords.indexOf(word);
        if (idx !== -1) {
          foundSolutionWords.push(word);
          remainingSolutionWords.splice(idx, 1);
        }
      } else {
        // A different job for the same `...` spread syntax used above:
        // here it unpacks `letters` (an array of 5 single characters) into
        // 5 SEPARATE arguments to .push(), equivalent to writing
        // remainingLetters.push(letters[0], letters[1], ..., letters[4])
        // by hand — so the 5 individual letters get appended one at a
        // time, rather than the whole `letters` array being pushed in as
        // one single nested element.
        remainingLetters.push(...letters);
      }
    }

    if (validCount < HELP_MIN_CORRECT_WORDS) {
      return {
        eligible: false,
        html: `Help is only available when you have ${HELP_MIN_CORRECT_WORDS} or more correct words.`,
      };
    }

    const remainingRows = SIZE - validCount;
    let foundWords = []; // vacuously solved (no words needed) if there's nothing left to solve
    if (remainingRows > 0) {
      const poolCounts = letterCounts(remainingLetters.join(''));
      // Narrows the full ~12,900-word dictionary down ONCE to only words
      // that could possibly fit within the leftover letters AT ALL — every
      // step of the recursive search above then only ever searches this
      // much smaller shortlist, not the full dictionary, which is what
      // keeps this fast enough to run on a click instead of on every swap.
      const candidates = WORD_LETTER_COUNTS.filter((entry) => fitsWithin(entry.counts, poolCounts));
      foundWords = canFormFromCounts(poolCounts, remainingRows, candidates, new Map());
    }
    const canForm = foundWords !== null;

    // Testing aid: prints the actual words the search found (not just a
    // yes/no) whenever it succeeds, so it's easy to check by hand that a
    // reported "CAN" is genuinely correct.
    if (canForm && remainingRows > 0) {
      console.log('🔤 SLYDZ help — remaining letters CAN form:', foundWords.join(' / '));
    }

    const wordOrWords = remainingRows === 1 ? 'word' : 'words';
    const verdict = canForm
      ? '<strong class="help-can">CAN</strong>'
      : '<strong class="help-cannot">CANNOT</strong>';

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
        + `<p>The remaining letters ${verdict} be used to make up ${remainingRows} more ${wordOrWords}.</p>`
        + `<p>There is at least one solution to the puzzle and one of these is our solution for today.</p>`
        + `<p>${foundSentence}</p>`,
    };
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

  // --- Persistence (supports resume-in-progress) ---
  function persistProgress(completed) {
    saveProgress(GAME_ID, { letters: captureLetters(), seconds: totalSeconds, usedHelp, revealed }, { completed });
  }

  // `usedHelp`/`revealed` are read by persistProgress() above, but only
  // need to be DECLARED before persistProgress() is ever CALLED (not
  // before they're merely defined) — every call happens later, from event
  // handlers/timers, so declaring them here is safe. The rest of the
  // help-toggle/reveal-solution machinery (their DOM elements and
  // functions) is built further down, after initShell() runs, since the
  // help button attaches to the header that initShell() creates.
  let usedHelp = false;
  let revealed = false; // true once the player has given up and seen the answer, for today

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'SLYDZ',
    emoji: '🔤',
    // Same single 'S' tile shown on this game's hub tile — see
    // games/slydz/tile-icon.js and games-registry.js.
    emojiImage: getTileDataURL('S'),
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`) instead of the shared global blue every game used before.
    accentColor: { bg: '#AD82D6', ink: '#371450', rim: 'rgba(55, 20, 80, 0.30)' },
    instructions: "<p>Drag tiles to swap letters</p><p>Make 5 letter words ACROSS →</p><p>You don't need to make words down</p><p>Use help 💡 if you need it</p>",
    formatScore: formatTime,
  });

  // --- Help toggle (SLYDZ-only — not part of the shared shell) ---
  // Built here, AFTER initShell() above, because it attaches to the shared
  // header — which doesn't exist in the DOM until initShell() creates it.
  //
  // Appended straight into the shared header's own grid — as the header's
  // 3rd child, CSS Grid auto-placement drops it into the empty right-hand
  // column (grid-column 3) that used to hold the timer, before the timer
  // moved to the footer. See the matching .help-toggle rule in this game's
  // own style.css for why this only affects SLYDZ, despite touching a
  // "shared" element.
  let helpOn = false;

  const $helpToggle = $('<button>', {
    class: 'help-toggle is-hidden',
    type: 'button',
    html: '💡 Help',
    'aria-label': 'Toggle help',
  }).appendTo('.shell-header');

  // A plain container, not a single <p> — computeHelpMessage() below builds
  // its "eligible" html as several separate <p> sentences (see .help-popover
  // p's margin-bottom in style.css), same convention as games/quadz/index.js.
  const $helpPopover = $('<div>', {
    class: 'help-popover is-hidden',
    html: '<div id="slydz-help-text"></div>',
  }).appendTo('.shell-header');
  const $helpText = $helpPopover.find('#slydz-help-text');

  // Turning help ON is the only moment computeHelpMessage()'s (potentially
  // non-trivial) search actually runs — turning it back off, or a swap
  // auto-closing it (see turnOffHelp() below), never recomputes anything.
  function toggleHelp() {
    if (helpOn) {
      turnOffHelp();
      return;
    }
    helpOn = true;
    $helpToggle.addClass('is-active');
    // "Destructuring assignment": computeHelpMessage() returns a single
    // object like { eligible: true, html: '...' } — instead of storing
    // that whole object in one variable and then writing
    // result.eligible / result.html everywhere, this pulls both
    // properties straight out into their own separate variables
    // (`eligible` and `html`) in one line, matched up purely by name.
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
  // clicking the toggle again, and (per the design brief) automatically the
  // moment the player moves another tile, so stale help never lingers on
  // screen once the board has changed underneath it.
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

  // Only shown while a round is actually being played — hidden behind the
  // start banner, and hidden again once the puzzle is solved (see the
  // showHelpToggle()/hideHelpToggle() calls further down).
  function showHelpToggle() {
    $helpToggle.removeClass('is-hidden');
  }

  function hideHelpToggle() {
    $helpToggle.addClass('is-hidden');
    turnOffHelp();
  }

  // --- Reveal solution (same feature/styling as games/quadz/index.js —
  // see its fuller comments for the full reasoning) — a deliberately more
  // understated control than Play/Help, since it ENDS today's round rather
  // than just assisting: a plain text-style button below the board, and a
  // custom confirm panel styled/positioned like the shared shell.js start/
  // end panels instead of the browser's native confirm() dialog. ---
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

  // Reuses the shell's own overlay/panel/message classes directly (rather
  // than a separate near-identical copy of the same rules) so this dialog
  // can never visually drift out of sync with the start banner and
  // end-screen again — same positioning, same title-centering, same button
  // shape. Text block reuses .shell-overlay__instructions' styling (same
  // left-aligned multi-paragraph block the start-banner instructions use) —
  // NOT .shell-end-screen__message, which is now a single-line-only
  // truncated element for the redesigned end-of-game panel and would clip
  // this multi-sentence explainer.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title">Reveal today's solution?</p>
          <p>You won't be able to complete SLYDZ yourself today.</p>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="slydz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="slydz-reveal-confirm">Reveal Solution</button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  $revealConfirm.find('#slydz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
  });
  $revealConfirm.find('#slydz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    revealSolution();
  });

  $revealBtn.on('click', () => {
    if (locked) return;
    $revealConfirm.removeClass('is-hidden');
  });

  // Locked until Play Now / Resume is pressed — otherwise tiles are
  // draggable underneath the start banner.
  let locked = true;

  // Shared by both a real player win and the dev "Solve puzzle" shortcut
  // below — see games/glympz/index.js's handleWin() for the same pattern.
  function handleWin() {
    locked = true;
    stopTimer();
    hideHelpToggle();
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
      revealed: false, usedHelp, failed: false,
      isNewBest: result.isNewBest, isTie: result.isTie,
      panelOutcome: undefined, panelIsNewBest: isNewBest,
    });
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest,
      animateTarget: document.getElementById('grid'),
      shareText: `🔤 SLYDZ — solved in ${formatTime(totalSeconds)}!${usedHelp ? ' (with help 💡)' : ''}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Reachable only via the player's own confirmed choice to give up (see
  // the $revealConfirm wiring above) — reveals the actual solution, locks
  // the board same as a real finish, but records it as a NON-win (no
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
    updateRowValidity();
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
      shareText: `🔤 SLYDZ — couldn't solve it today!`,
      // No `celebrate` here — giving up is explicitly not a celebration moment.
    });
  }

  // Testing shortcut: instantly restores the day's guaranteed-valid word
  // arrangement (puzzle.answerLetters) and ends the game, same as a real
  // win.
  function solvePuzzle() {
    shell.hideStartBanner();
    applyLetters(puzzle.answerLetters);
    updateRowValidity();
    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }] });

  enableTileDragSwap({
    container: document.getElementById('game-root'),
    tileSelector: '.tile',
    isLocked: () => locked,
    canSwap: () => true, // any letter tile can swap with any other — no type restriction like SOLVZ's number/operator rule
    onSwap: (a, b) => {
      turnOffHelp(); // per the design brief: moving a tile always closes any open help text

      // Swaps the two tiles' TEXT (like SOLVZ), not their position (like
      // GLYMPZ) — each grid cell has a fixed row, and what matters for word
      // validity is which LETTERS currently sit in that row, not which
      // specific tile element they came from (letters have no per-tile
      // "identity" the way GLYMPZ's photo slices do).
      const $a = $(a), $b = $(b);
      const aText = $a.text();
      const bText = $b.text();
      $a.text(bText);
      $b.text(aText);

      $a.addClass('tile-swapped');
      $b.addClass('tile-swapped');
      setTimeout(() => { $a.removeClass('tile-swapped'); $b.removeClass('tile-swapped'); }, 200);

      const solved = updateRowValidity();
      if (solved) {
        handleWin();
      } else {
        persistProgress(false);
      }
    },
  });

  // Same three-way daily-status branch as SOLVZ/GLYMPZ — see the fuller
  // explanation in games/solvz/index.js.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false; // `|| false` covers old saves from before this field existed
    revealed = data.revealed || false;
    updateTimerDisplay();
    updateRowValidity();
    // No `celebrate` on this branch either way — this only runs when
    // revisiting a day already finished in an EARLIER session, not on the
    // actual moment of winning/revealing, so it shouldn't replay confetti.
    if (revealed) {
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: `🔤 SLYDZ — couldn't solve it today!`,
      });
    } else {
      // isNewBest falls back to false if this day was completed before
      // panelIsNewBest existed — no stored record of whether it was a
      // meaningful PB at the time.
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🔤 SLYDZ — solved in ${formatTime(totalSeconds)}!${usedHelp ? ' (with help 💡)' : ''}`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false;
    updateTimerDisplay();
    updateRowValidity();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButton();
      startTimer();
    }, { label: 'Resume' });
  } else {
    applyLetters(puzzle.startLetters);
    updateRowValidity(); // in case the scramble happens to land a row on a real word already — rare, but should still highlight correctly
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
