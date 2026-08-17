// SOLVZ — drag numbers/operators into a 5x5 equation grid so both marked rows
// and both marked columns sum (or multiply/etc.) correctly.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';
import { requireStandalone } from '../../shared/core/install-gate.js';

await requireStandalone();

hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

const GAME_ID = 'solvz';

// jQuery's $(function () { ... }) is shorthand for "run this once the DOM is
// ready" — equivalent to listening for the browser's 'DOMContentLoaded'
// event. Everything that touches the page's HTML elements lives inside this
// callback. (In practice, since this script is deferred until after parsing
// anyway, the DOM is already ready by the time this runs — this wrapper is
// a jQuery convention carried over from SOLVZ's original, pre-shared-shell
// version, kept here since it doesn't hurt anything.)
$(function () {

  const COLS1 = 5, ROWS1 = 5; // the big equation grid
  const COLS2 = 4, ROWS2 = 3; // the tray of draggable number/operator tiles below it

  // Inline stand-ins for the instructions text — same flat-color square look
  // as the real .tile.number/.tile.operator tiles (see style.css), just
  // sized to sit inline with text instead of filling a full grid cell.
  const NUMBER_TILE_IMG = '<span class="solvz-inline-tile number">5</span>';
  const OPERATOR_TILE_IMG = '<span class="solvz-inline-tile operator">+</span>';

  // Describes what TYPE of tile belongs in each cell of the 5x5 grid, by
  // row then column — this is what buildGrid() (below) reads to decide each
  // tile's CSS class and whether it's draggable. Laid out to match the
  // visual grid:
  //   row 1: [number] [operator] [number] [=] [number]   <- e.g. "4 + 3 = 7"
  //   row 2: [operator]  [blank]  [operator] [blank]  .   <- column operators live here
  //   row 3: [number] [operator] [number] [=] [number]   <- second equation
  //   row 4: [=]         [blank]  [=]        [blank]  .   <- column "=" signs live here
  //   row 5: [number]     .       [number]    .       .   <- column answers land here
  // `null` means "no tile rendered in this cell at all" — not every cell in
  // the 5x5 grid is actually used, since only two rows and two columns form
  // real equations.
  const ROW_TILE_CLASSES = {
    1: ['number', 'operator', 'number', 'equals', 'number'],
    2: ['operator', 'blank', 'operator', 'blank', null],
    3: ['number', 'operator', 'number', 'equals', 'number'],
    4: ['equals', 'blank', 'equals', 'white-blank', null],
    5: ['number', null, 'number', null, null]
  };

  // The 4x3 tray below is simpler: each whole ROW is one type of tile
  // (row 1 = operators, rows 2-3 = numbers).
  const GRID2_ROW_CLASS = {
    1: 'operator',
    2: 'number',
    3: 'number'
  };

  // Applies one of the four arithmetic operators. Accepts a few different
  // symbols for multiply/divide ('x', '×', '*' all mean multiply) since the
  // puzzle data and the on-screen tile characters don't always use the
  // exact same symbol.
  function applyOp(a, op, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case 'x':
      case '×':
      case '*': return a * b;
      case '÷':
      case '/': return b !== 0 ? a / b : NaN; // NaN ("Not a Number") signals an invalid result, e.g. divide by zero
      default: return NaN;
    }
  }

  // --- Daily puzzle generator ---
  // SOLVZ needs the SAME puzzle to appear for every player on a given
  // calendar day (so it behaves like Wordle — everyone's playing the same
  // challenge), without needing a server to hand out puzzles. The trick:
  // generate a "random-looking" number from a fixed formula that always
  // produces the exact same output for the exact same input ("seed") — feed
  // it today's day-of-year as the seed, and everyone's browser independently
  // computes the identical puzzle with zero network requests.

  // A classic "seeded pseudo-random number generator" one-liner: Math.sin()
  // produces wildly different-looking output for nearby inputs, and
  // multiplying by 10000 then keeping only the digits after the decimal
  // point (x - Math.floor(x)) scrambles that further into something that
  // looks statistically random, while remaining 100% deterministic — the
  // same `seed` always produces the exact same result, unlike Math.random()
  // which is different every time. This is NOT cryptographically secure
  // randomness (don't reuse this trick for anything security-sensitive) —
  // it's just "good enough to look shuffled" for a daily puzzle.
  function seededPseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  // Turns the 0-1 output of seededPseudoRandom() into a whole number between
  // min and max (inclusive).
  function getSeededInt(min, max, seed) {
    return Math.floor(seededPseudoRandom(seed) * (max - min + 1)) + min;
  }

  // Rejects puzzles where the same operator (e.g. '+') is used 3+ times
  // among the four slots — keeps each day's puzzle from being e.g. all
  // addition, for a bit of variety.
  function isValidOperatorDistribution(ops) {
    const counts = {};
    for (const op of ops) {
      counts[op] = (counts[op] || 0) + 1; // counts[op] || 0 treats "not seen yet" the same as zero
      if (counts[op] > 2) return false;
    }
    return true;
  }

  // Pre-computes all 366 daily puzzles (enough for a leap year) up front, at
  // page load, rather than generating just today's on demand — this keeps
  // the "which puzzle is today's" lookup (a few lines below) a simple array
  // index, and the whole computation is fast enough (a fraction of a
  // second) that doing all 366 unconditionally isn't a real cost.
  function generate366Solutions() {
    const solutions = [];
    const opsList = ['+', '-', 'x', '÷'];

    for (let day = 1; day <= 366; day++) {
      // Each day gets its own starting seed, so different days produce
      // different (but each individually reproducible) puzzles. The exact
      // multiplier (997, a prime number) isn't meaningful beyond "produces
      // seeds that are spread far apart from each other."
      let seed = day * 997;
      let validPuzzleFound = false;

      // Keeps generating candidate puzzles from this day's seed sequence
      // until one satisfies every constraint below (integer, positive
      // answers; not-too-repetitive operators) — most attempts fail these
      // checks (e.g. dividing two random numbers rarely gives a whole
      // number), so this can loop many times per day, but each attempt is
      // essentially instant.
      while (!validPuzzleFound) {
        // seed++ (post-increment) uses the CURRENT value of seed in this
        // expression, then increases it by 1 for next time — so each of
        // these calls draws a different pseudo-random value from the
        // sequence, deterministically, in a fixed order.
        const r1c1 = getSeededInt(3, 12, seed++);
        const r1c3 = getSeededInt(2, 9, seed++);
        const r3c1 = getSeededInt(2, 8, seed++);
        const r3c3 = getSeededInt(2, 8, seed++);

        const opR1 = opsList[getSeededInt(0, 3, seed++)];
        const opR3 = opsList[getSeededInt(0, 3, seed++)];
        const opC1 = opsList[getSeededInt(0, 3, seed++)];
        const opC3 = opsList[getSeededInt(0, 3, seed++)];

        const ops = [opR1, opR3, opC1, opC3];
        if (!isValidOperatorDistribution(ops)) continue; // `continue` skips straight to the next while-loop attempt

        // Computes what each equation's answer WOULD be, so it can be
        // checked below before committing to this puzzle.
        const ansR1 = applyOp(r1c1, opR1, r1c3);
        const ansR3 = applyOp(r3c1, opR3, r3c3);
        const ansC1 = applyOp(r1c1, opC1, r3c1);
        const ansC3 = applyOp(r1c3, opC3, r3c3);

        // Only accept puzzles where every answer is a positive whole
        // number — e.g. rejects a division that doesn't come out even, or
        // a subtraction that goes negative, which would make for a
        // confusing/ugly puzzle tile.
        if (
          Number.isInteger(ansR1) && ansR1 > 0 &&
          Number.isInteger(ansR3) && ansR3 > 0 &&
          Number.isInteger(ansC1) && ansC1 > 0 &&
          Number.isInteger(ansC3) && ansC3 > 0
        ) {
          // Stored as an object with numeric-looking keys 1/2/3 (grouping
          // operators / starting numbers / answers) — an unusual shape, but
          // it's what contentFor() and logSolution() below expect to read
          // from. `String(...)` converts the numbers to text since that's
          // what ends up as each tile's displayed text content.
          solutions.push({
            1: ops,
            2: [String(r1c1), String(r1c3), String(r3c1), String(r3c3)],
            3: [String(ansR1), String(ansR3), String(ansC1), String(ansC3)]
          });
          validPuzzleFound = true;
        }
        // If the checks above failed, the while loop just tries again with
        // the seed values that got consumed already — never resetting back
        // to the start, so it keeps working through a "fresh" sequence of
        // pseudo-random numbers each attempt.
      }
    }
    return solutions;
  }

  const SOLUTIONS_366 = generate366Solutions();
  // dayOfYear() (see shared/core/date-utils.js) returns 1 for Jan 1st, so
  // subtract 1 to get a 0-based array index for SOLUTIONS_366.
  const todayDayOfYear = dayOfYear();
  const activeSolutionIndex = todayDayOfYear - 1;
  const GRID2_TILE_VALUES = SOLUTIONS_366[activeSolutionIndex];

  // A second, independent implementation of "apply an operator" — used only
  // for the console.log verification message below, working on the
  // already-stringified values stored in a solution object (hence the
  // parseFloat() calls to turn them back into numbers first). Kept separate
  // from applyOp() above mainly because this one existed already in SOLVZ's
  // original pre-shared-shell code and there was no strong reason to merge
  // them.
  function computeOp(a, op, b) {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    switch (op) {
      case '+': return numA + numB;
      case '-': return numA - numB;
      case 'x':
      case '×':
      case '*': return numA * numB;
      case '÷':
      case '/': return numB !== 0 ? numA / numB : 0;
      default: return 0;
    }
  }

  // Prints today's full solution to the browser DevTools console (F12) —
  // purely a testing/debugging aid, so you (or anyone testing) can peek at
  // the answer without having to solve the puzzle by hand every time.
  function logSolution(sol) {
    const ops = sol[1];
    const nums = sol[2].concat(sol[3]); // .concat() joins the two arrays (starting numbers + answers) into one

    const r1c1 = nums[0], r1c3 = nums[1], r3c1 = nums[2], r3c3 = nums[3];
    const ansR1 = nums[4], ansR3 = nums[5], ansC1 = nums[6], ansC3 = nums[7];
    const opR1 = ops[0], opR3 = ops[1], opC1 = ops[2], opC3 = ops[3];

    const todayStr = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    // A template literal spanning multiple lines — anything between the
    // backticks, including the actual line breaks, becomes part of the
    // string. This is what lets console.log print a nicely multi-line
    // summary in one call.
    console.log(`🧩 SOLVZ Daily Puzzle (${todayStr} | Day ${todayDayOfYear} of 366):
row 1: ${r1c1} ${opR1} ${r1c3} = ${ansR1} (${computeOp(r1c1, opR1, r1c3)})
row 3: ${r3c1} ${opR3} ${r3c3} = ${ansR3} (${computeOp(r3c1, opR3, r3c3)})
col 1: ${r1c1} ${opC1} ${r3c1} = ${ansC1} (${computeOp(r1c1, opC1, r3c1)})
col 3: ${r1c3} ${opC3} ${r3c3} = ${ansC3} (${computeOp(r1c3, opC3, r3c3)})`);
  }

  logSolution(GRID2_TILE_VALUES);

  // Decides what text a given cell should START with when the grid is first
  // built (before any tiles are dragged): grid 1's cells are all blank
  // except the fixed "=" signs; grid 2's cells show the actual shuffled-in
  // puzzle numbers/operators the player will drag from.
  function contentFor(gridId, row, col, typeClass) {
    if (gridId === 1) return typeClass === 'equals' ? '=' : '';
    if (gridId === 2) return GRID2_TILE_VALUES[row][col - 1];
    return '';
  }

  function isDraggableType(typeClass) {
    return typeClass === 'number' || typeClass === 'operator';
  }

  // Builds one grid's worth of tile <div>s and appends them to $grid. This
  // is done in JavaScript (rather than writing every tile out by hand in
  // index.html) because which cells exist, what type they are, and what
  // text they start with all depend on ROW_TILE_CLASSES/GRID2_TILE_VALUES
  // above — hand-writing ~32 near-identical <div>s would be extremely easy
  // to get subtly wrong and hard to keep in sync with those data
  // structures.
  function buildGrid($grid, cols, rows, gridId) {
    const count = cols * rows;
    for (let i = 0; i < count; i++) {
      // Converts a flat index (0, 1, 2, ...) into a (row, col) position,
      // both 1-based to match how ROW_TILE_CLASSES/GRID2_TILE_VALUES are
      // indexed above. Math.floor(i / cols) is "how many full rows have we
      // completed so far"; i % cols ("modulo" — the remainder after
      // dividing) is "how far into the current row are we."
      const row = Math.floor(i / cols) + 1;
      const col = (i % cols) + 1;

      const classes = ['tile'];
      let typeClass = null;

      if (gridId === 1) {
        classes.push(`row${row}`);
        typeClass = ROW_TILE_CLASSES[row][col - 1];
        if (typeClass) classes.push(typeClass);
      } else {
        typeClass = GRID2_ROW_CLASS[row];
        classes.push(typeClass);
      }

      // jQuery's $('<div>', {...}) creates a new <div> element and sets all
      // the given attributes/properties on it in one call — `class` sets
      // the CSS class list, the `data-*` keys become data-* HTML attributes
      // (readable later as e.g. $(tile).data('row')), and `text` sets its
      // text content. .appendTo($grid) then inserts it into the grid
      // container. This chain of jQuery methods is roughly equivalent to
      // several lines of plain document.createElement() + setAttribute()
      // calls — jQuery bundles them into one expression.
      $('<div>', {
        class: classes.join(' '),
        'data-grid': gridId,
        'data-row': row,
        'data-col': col,
        'data-index': i,
        text: contentFor(gridId, row, col, typeClass)
      }).appendTo($grid);
    }
  }

  buildGrid($('#grid1'), COLS1, ROWS1, 1);
  buildGrid($('#grid2'), COLS2, ROWS2, 2);

  // Checks whether "aStr opStr bStr = cStr" is currently a TRUE equation,
  // reading straight from whatever text happens to be in those tiles right
  // now (which is however the player has arranged them so far).
  function evaluateEquation(aStr, opStr, bStr, cStr) {
    if (!aStr || !opStr || !bStr || !cStr) return false; // any blank tile (still unfilled) means "not solved yet"
    const a = parseFloat(aStr), b = parseFloat(bStr), c = parseFloat(cStr);
    if (isNaN(a) || isNaN(b) || isNaN(c)) return false; // e.g. an operator tile sitting where a number should be

    let result;
    switch (opStr) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case 'x':
      case '×':
      case '*': result = a * b; break;
      case '÷':
      case '/':
        if (b === 0) return false;
        result = a / b;
        break;
      default: return false;
    }
    // Comparing floating-point numbers for exact equality is unreliable
    // (division especially can produce tiny rounding errors, e.g.
    // 0.1 + 0.2 !== 0.3 in JavaScript) — checking the difference is smaller
    // than a tiny threshold (0.000001) instead avoids false negatives from
    // that.
    return Math.abs(result - c) < 0.000001;
  }

  // Looks up whatever text is CURRENTLY showing in the grid-1 tile at
  // (row, col) — this reads live from the DOM rather than from any saved
  // puzzle data, since it needs to reflect the player's current (possibly
  // wrong, possibly mid-drag) arrangement.
  function getGrid1TileText(row, col) {
    return $(`#grid1 .tile[data-row="${row}"][data-col="${col}"]`).text().trim();
  }

  // The inverse of getGrid1TileText() — used only by the dev-panel's "Solve
  // puzzle" shortcut (below) to write today's actual solution straight into
  // grid 1, rather than requiring it be dragged in tile by tile.
  function setGrid1TileText(row, col, text) {
    $(`#grid1 .tile[data-row="${row}"][data-col="${col}"]`).text(text);
  }

  // Checks all four equations (two rows, two columns) at once — the puzzle
  // counts as solved only when every single one currently evaluates to
  // true.
  function checkBoardState() {
    const isRow1Valid = evaluateEquation(getGrid1TileText(1, 1), getGrid1TileText(1, 2), getGrid1TileText(1, 3), getGrid1TileText(1, 5));
    const isRow3Valid = evaluateEquation(getGrid1TileText(3, 1), getGrid1TileText(3, 2), getGrid1TileText(3, 3), getGrid1TileText(3, 5));
    const isCol1Valid = evaluateEquation(getGrid1TileText(1, 1), getGrid1TileText(2, 1), getGrid1TileText(3, 1), getGrid1TileText(5, 1));
    const isCol3Valid = evaluateEquation(getGrid1TileText(1, 3), getGrid1TileText(2, 3), getGrid1TileText(3, 3), getGrid1TileText(5, 3));
    return isRow1Valid && isRow3Valid && isCol1Valid && isCol3Valid;
  }

  // --- Timer ---
  let totalSeconds = 0;
  let timerInterval = null; // holds the id returned by setInterval, so it can later be cancelled with clearInterval

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Pushes the current totalSeconds value out to the shared flip-clock
  // widget in the header (see shared/core/flip-timer.js) — this file never
  // touches that widget's DOM directly, only calls the function shell.js
  // handed back.
  function updateTimerDisplay() {
    shell.timer.setSeconds(totalSeconds);
  }

  function startTimer() {
    clearInterval(timerInterval); // guards against accidentally starting a second overlapping timer if this is somehow called twice
    // setInterval runs its callback repeatedly, forever, every 1000ms (one
    // second) until clearInterval() is called on the id it returns.
    timerInterval = setInterval(() => {
      totalSeconds++;
      updateTimerDisplay();
      persistProgress(false); // saves progress every tick, so a page refresh mid-game never loses more than ~1 second of elapsed time
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  // --- Persistence (supports resume-in-progress) ---

  // Reads the current text of every .tile on the page, in DOM order, into a
  // plain array — this is the "snapshot" of exactly how the player has
  // arranged things so far. jQuery's .map() here transforms the matched set
  // of elements into a new set of values (one per element, via the given
  // function), and .get() converts that jQuery-wrapped result into a plain
  // JavaScript array.
  function captureTileTexts() {
    return $('.tile').map(function () { return $(this).text(); }).get();
  }

  // The inverse of captureTileTexts() — given a previously-saved array,
  // writes each value back into the matching tile (same DOM order as when
  // it was captured, which is guaranteed since buildGrid() always creates
  // tiles in the same fixed order on every page load).
  function applyTileTexts(texts) {
    $('.tile').each(function (i) {
      if (texts[i] !== undefined) $(this).text(texts[i]);
    });
  }

  // Wraps game-storage.js's saveProgress() with this game's specific data
  // shape (tile arrangement + elapsed time) so the rest of the file can
  // just call persistProgress(true/false) without repeating that shape
  // every time.
  function persistProgress(completed) {
    saveProgress(GAME_ID, { tileTexts: captureTileTexts(), seconds: totalSeconds }, { completed });
  }

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  // See shared/core/shell.js for the full explanation of what this call
  // does and what it returns. `shell` (the returned object) is used
  // throughout the rest of this file — e.g. shell.timer, shell.status,
  // shell.showEndScreen(...).
  const shell = initShell({
    gameId: GAME_ID,
    title: 'SOLVZ',
    // Same plus-sign-in-a-circle badge shown on this game's hub tile — see
    // .hub__tile-badge in style.css and games-registry.js's `accent` field.
    emojiBadge: { glyph: '➕', accent: '#F2803A' },
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`) instead of the shared global blue every game used before.
    accentColor: { bg: '#E59A63', ink: '#78370F', rim: 'rgba(120, 55, 15, 0.30)' },
    instructions: `<p>Drag numbers ${NUMBER_TILE_IMG} and operators ${OPERATOR_TILE_IMG} from the bottom grid to the top grid</p><p>Both rows ➡️ and columns ⬇️ need to SUM to win</p>`,
    formatScore: formatTime,
  });

  // Locked until Play Now / Resume is pressed — otherwise tiles are
  // draggable underneath the start banner.
  let locked = true;

  // Shared by both a real drag-triggered win (onSwap, below) and the
  // dev-panel's "Solve puzzle" shortcut (also below) — pulled out to its own
  // function so neither path can drift out of sync with the other.
  function handleWin() {
    locked = true;
    stopTimer();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
    // A meaningful PB needs a real previous best to have beaten — not the
    // player's first-ever play, and not a previous best of exactly 0 (see
    // end-panel-content.js's scenario-priority comment).
    const hasMeaningfulBest = result.previousBest !== null && result.previousBest !== 0;
    const isNewBest = hasMeaningfulBest && result.isNewBest;
    // SOLVZ has no reveal/help/fail concept — a win is the only way it ever
    // ends — so this only ever carries isNewBest/isTie for the feedback page.
    saveTodayOutcome(GAME_ID, {
      revealed: false, usedHelp: false, failed: false,
      isNewBest: result.isNewBest, isTie: result.isTie,
      panelOutcome: undefined, panelIsNewBest: isNewBest,
    });
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest,
      animateTarget: document.getElementById('board'),
      shareText: `➗ SOLVZ - got it in ${formatTime(totalSeconds)}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Dev-only shortcut, matching the spirit of GLYMPZ/SLYDZ/QUADZ's own
  // "Solve puzzle" — writes today's actual answer straight into grid 1
  // (rather than requiring every number/operator be dragged in by hand) and
  // then runs the exact same win path a real solve would.
  function solvePuzzle() {
    shell.hideStartBanner();
    const [opR1, opR3, opC1, opC3] = GRID2_TILE_VALUES[1];
    const [r1c1, r1c3, r3c1, r3c3] = GRID2_TILE_VALUES[2];
    const [ansR1, ansR3, ansC1, ansC3] = GRID2_TILE_VALUES[3];

    setGrid1TileText(1, 1, r1c1);
    setGrid1TileText(1, 2, opR1);
    setGrid1TileText(1, 3, r1c3);
    setGrid1TileText(1, 5, ansR1);
    setGrid1TileText(2, 1, opC1);
    setGrid1TileText(2, 3, opC3);
    setGrid1TileText(3, 1, r3c1);
    setGrid1TileText(3, 2, opR3);
    setGrid1TileText(3, 3, r3c3);
    setGrid1TileText(3, 5, ansR3);
    setGrid1TileText(5, 1, ansC1);
    setGrid1TileText(5, 3, ansC3);

    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }] });

  // Wires up drag-and-drop for every tile on the page — see
  // shared/input/dom-tile-drag.js for how this actually detects drags; this
  // call just supplies SOLVZ-specific rules: which tiles can swap with which
  // (canSwap), whether dragging is currently allowed at all (isLocked), and
  // what "swap" actually means for this game (onSwap — swap the two tiles'
  // TEXT, not their position, since SOLVZ's grid cells stay in fixed
  // positions and only their contents move).
  enableTileDragSwap({
    container: document.getElementById('game-root'),
    tileSelector: '.tile',
    isLocked: () => locked,
    // Only allows swapping a number-tile with another number-tile, or an
    // operator-tile with another operator-tile — e.g. you can't drag a "+"
    // onto a number slot.
    canSwap: (a, b) =>
      ($(a).hasClass('number') && $(b).hasClass('number')) ||
      ($(a).hasClass('operator') && $(b).hasClass('operator')),
    onSwap: (a, b) => {
      const aText = $(a).text();
      const bText = $(b).text();
      $(a).text(bText);
      $(b).text(aText);

      if (checkBoardState()) {
        handleWin();
      } else {
        persistProgress(false);
      }
    },
  });

  // Decides what to show based on today's saved status (see
  // shared/core/daily-lock.js for what these three values mean). This is
  // the branch that makes the "resume where you left off" / "one play per
  // day" behavior actually happen.
  if (shell.status.status === 'completed') {
    // Already solved today — restore the exact final tile arrangement and
    // time, then show the end screen immediately (no banner, no dragging).
    const { data } = shell.status.record;
    applyTileTexts(data.tileTexts);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    // isNewBest falls back to false if this day was completed before
    // panelIsNewBest existed — no stored record of whether it was a
    // meaningful PB at the time.
    const storedOutcome = getTodayOutcome(GAME_ID);
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
      shareText: `➗ SOLVZ - got it in ${formatTime(totalSeconds)}`,
    });
  } else if (shell.status.status === 'in-progress') {
    // Mid-solve from earlier today — restore the saved arrangement/time,
    // then show the banner again with a "Resume" button rather than jumping
    // straight back into dragging (see shell.js's showStartBanner label
    // option).
    const { data } = shell.status.record;
    applyTileTexts(data.tileTexts);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    shell.showStartBanner(() => {
      locked = false;
      startTimer();
    }, { label: 'Resume' });
  } else {
    // Never played today — grid already shows today's tray contents from
    // buildGrid() above, so just show the normal "Play Now" banner and
    // start the game fresh once clicked.
    shell.showStartBanner(() => {
      locked = false;
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

});
