// SPOKZ — a six-pointed star: a fixed center letter, 6 spokes of 3 circles
// each. Drag letters from the 2-row tray below to fill all 18 spoke circles
// so all 6 spokes spell real 4-letter words (center letter + that spoke's 3
// circles, read outward). Same "any dictionary word wins" rule as QUADZ/
// SLYDZ (see checkWord() below) — today's own 6 curated words are ONE
// solution, not the only one; a different real word still wins, just shown
// in amber instead of green (see updateValidity()).
//
// The reveal engine's parallel-batch technique and the reveal-lock styling
// are ported from QUADZ's computeRevealPlan()/playRevealBatches(),
// generalized from QUADZ's fixed 16-cell grid to SPOKZ's 36 draggable
// cells (18 spoke + 18 tray). Help, unlike QUADZ/SLYDZ's own calculated
// hint, is a fixed static rules panel — no per-board search here.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { watchFitToStage } from '../../shared/core/fit-to-stage.js';
import { PUZZLES_366 } from './puzzles.js'; // the original 366-day plain (non-themed) set — kept for later, not currently used (see buildDailyPuzzle() below)
import { THEMED_DAYS } from './themed-days.js';
import { ALL_WORDS } from './words.js';
import { getSpokzIconDataURL } from './tile-icon.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';
import { requireStandalone } from '../../shared/core/install-gate.js';

await requireStandalone();

hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

const GAME_ID = 'spokz';

// A Set gives O(1) "is this word valid?" lookups — same dictionary QUADZ
// ships (see games/spokz/words.js's own header comment).
const ALL_WORDS_SET = new Set(ALL_WORDS);
function checkWord(word) {
  return ALL_WORDS_SET.has(word);
}

$(function () {

  const $star = $('#star');
  const $tray = $('#tray');
  const $centerCircle = $('#centerCircle');

  // --- Seeded PRNG — same Math.sin trick used across every GAME HUB daily
  // game, its own multiplier (733, prime) so this game's tray shuffle
  // doesn't coincide with any other game's "randomness". ---
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

  // THEMED_DAYS's index 0 is pinned to this real calendar day-of-year
  // (2026-08-20, verified against shared/core/date-utils.js's own
  // dayOfYear() logic — don't hand-recompute this by arithmetic, it's
  // easy to get off by one against leap-year/timezone edge cases).
  // Everything from here on cycles through the 8 curated days repeatedly
  // (day 239 wraps back to index 0 again) rather than falling back to
  // PUZZLES_366's plain set — only 8 themed days exist so far, so cycling
  // keeps every future day showing real curated content instead of hitting
  // undefined puzzle data once the 8 run out. Revisit once more themed
  // days exist.
  const THEMED_START_DAY = 231;

  // Builds one day's puzzle from THEMED_DAYS: each entry's 6 words already
  // all share their first letter (that's the day's center letter), so
  // nothing needs deriving beyond splitting each into its 3-letter spoke
  // suffix and shuffling the pooled 18 letters into the tray's starting
  // order.
  function buildDailyPuzzle(day) {
    const themedIndex = (((day - THEMED_START_DAY) % THEMED_DAYS.length) + THEMED_DAYS.length) % THEMED_DAYS.length;
    const themedDay = THEMED_DAYS[themedIndex];
    const words = themedDay.words;
    const centerLetter = words[0][0];
    const spokeSuffixes = words.map((w) => w.slice(1).split(''));
    const trayLetters = [];
    spokeSuffixes.forEach((suf) => trayLetters.push(...suf));
    const startTray = seededShuffle(trayLetters, day * 733);
    return { words, centerLetter, spokeSuffixes, startTray, clue: themedDay.clue, poolType: themedDay.poolType };
  }

  const todayDayOfYear = dayOfYear();
  const puzzle = buildDailyPuzzle(todayDayOfYear);
  // `let`, not `const` — the dev-tools "preview a pool type" shortcuts
  // (see previewThemedDay() below) reassign these to jump straight to any
  // of THEMED_DAYS's 8 entries without a page reload. Every other place in
  // this file that reads them still just reads a plain variable, so
  // nothing downstream needs to know previewing happened.
  let CENTER_LETTER = puzzle.centerLetter;
  let SPOKE_SUFFIXES = puzzle.spokeSuffixes; // [['A','R','S'], ...] inner->outer per spoke
  let SOLUTION = puzzle.words; // today's own 6-word canonical answer

  // A debugging aid, same spirit as QUADZ/SLYDZ's own — prints today's
  // guaranteed-valid solution to the console.
  console.log(`🧭 SPOKZ Daily Puzzle (Day ${todayDayOfYear}, theme: ${puzzle.poolType}):`);
  console.log('Solution:', SOLUTION.join(' / '));

  // --- Build the star: 6 spokes at 60-degree steps, 3 circles each, inner
  // to outer, positioned with plain trig as percentages of the square
  // .star container — stays a true star at any screen size with zero JS
  // re-measurement needed. Validated as a standalone Artifact prototype
  // before landing here. ---
  const SPOKE_ANGLES_DEG = [-90, -30, 30, 90, 150, 210]; // 12, 2, 4, 6, 8, 10 o'clock
  const POS_RADII_PCT = [15.5, 29, 42.5]; // inner -> outer, % of container width/height
  const TILE_PCT = 12.5;

  function buildStar() {
    // left/top are the tile's TOP-LEFT corner (x/y minus half the tile's
    // own size), not its center + a centering transform — deliberately, so
    // the shared drag module is free to use `transform` purely for the
    // drag offset without fighting a permanent centering transform on the
    // same property (see shared/input/dom-tile-drag.js).
    const half = TILE_PCT / 2;
    SPOKE_ANGLES_DEG.forEach((angleDeg, i) => {
      const angle = (angleDeg * Math.PI) / 180;
      for (let p = 0; p < 3; p++) {
        const r = POS_RADII_PCT[p];
        const x = 50 + r * Math.cos(angle);
        const y = 50 + r * Math.sin(angle);
        $('<div>', { class: 'tile spoke-tile', 'data-spoke': i, 'data-pos': p })
          .css({ left: (x - half) + '%', top: (y - half) + '%' })
          .appendTo($star);
      }
    });
  }
  buildStar();
  $centerCircle.text(CENTER_LETTER);

  function buildTray(letters) {
    $tray.empty();
    letters.forEach((letter, i) => {
      $('<div>', { class: 'tile tray-tile', 'data-tray-index': i, text: letter }).appendTo($tray);
    });
  }
  buildTray(puzzle.startTray);

  function spokeTileEl(i, p) {
    return document.querySelector(`.spoke-tile[data-spoke="${i}"][data-pos="${p}"]`);
  }
  function allSpokeTileEls() {
    const out = [];
    for (let i = 0; i < 6; i++) for (let p = 0; p < 3; p++) out.push(spokeTileEl(i, p));
    return out;
  }
  function allTrayTileEls() {
    return $tray.find('.tray-tile').toArray();
  }
  function getSpokeLetters(i) {
    return [0, 1, 2].map((p) => spokeTileEl(i, p).textContent);
  }

  // --- Validity ---
  const spokeValid = new Array(6).fill(false);

  // Checks all 6 spokes: toggles is-filled/is-valid/is-amber/is-invalid/
  // is-locked on each spoke's 3 tiles, and returns whether the WHOLE
  // puzzle is solved (all 6 spokes spelling ANY real word, unchanged "any
  // word wins" rule — spokeValid[i] still just means "is a real word",
  // exactly as before; is-valid vs is-amber is a purely cosmetic split of
  // that same true case, not a stricter win condition). is-invalid (all 3
  // circles full, real word or not) only ever applies once a spoke is
  // fully filled — a half-filled spoke isn't "wrong" yet, just incomplete.
  //
  // is-locked (green only, not amber) is what actually drives canDrag/
  // canSwap below — once a spoke spells one of TODAY'S own solution words,
  // its 3 tiles lock permanently for the rest of the round, the same way a
  // revealed spoke always has (revealing a spoke always plants exactly its
  // SOLUTION word, so it's always green too — one shared lock rule covers
  // both "solved it myself" and "gave up and revealed it" with no separate
  // reveal-specific tracking needed). Re-deriving this fresh every call
  // (rather than a separate persisted flag) is safe specifically because
  // it's self-reinforcing: once locked, canDrag/canSwap refuse to let that
  // spoke's letters change again, so a locked spoke can never stop being
  // green later.
  function updateValidity() {
    let win = true;
    for (let i = 0; i < 6; i++) {
      const letters = getSpokeLetters(i);
      const filled = letters.every((l) => l !== '');
      const word = CENTER_LETTER + letters.join('');
      const isRealWord = filled && checkWord(word);
      const isSolutionWord = isRealWord && SOLUTION.includes(word);
      const isAmberWord = isRealWord && !isSolutionWord;
      const isInvalidFull = filled && !isRealWord;
      spokeValid[i] = isRealWord;
      for (let p = 0; p < 3; p++) {
        const el = spokeTileEl(i, p);
        el.classList.toggle('is-filled', letters[p] !== '');
        el.classList.toggle('is-valid', isSolutionWord);
        el.classList.toggle('is-amber', isAmberWord);
        el.classList.toggle('is-invalid', isInvalidFull);
        el.classList.toggle('is-locked', isSolutionWord);
      }
      if (!isRealWord) win = false;
    }
    return win;
  }

  // `usedHelp`/`revealed`/`firstRevealUsed`/`secondRevealUsed` are read
  // by persistProgress() below, but only need to be DECLARED before
  // persistProgress() is ever CALLED (not before they're merely defined) —
  // see games/quadz/index.js's matching comment.
  let usedHelp = false;
  let revealed = false; // true once the player has given up and seen the answer, for today
  let firstRevealUsed = false; // true once the player has used the "Reveal a word" assist, for today
  let secondRevealUsed = false; // true once the player has used the "Reveal another word" assist, for today

  // --- Persistence (supports resume-in-progress) ---
  function captureLetters() {
    const spokes = [];
    for (let i = 0; i < 6; i++) spokes.push(getSpokeLetters(i));
    return { spokes, tray: allTrayTileEls().map((el) => el.textContent) };
  }
  function applyLetters(data) {
    for (let i = 0; i < 6; i++) for (let p = 0; p < 3; p++) spokeTileEl(i, p).textContent = data.spokes[i][p];
    const trayEls = allTrayTileEls();
    trayEls.forEach((el, idx) => { el.textContent = data.tray[idx] !== undefined ? data.tray[idx] : ''; });
  }
  function persistProgress(completed) {
    saveProgress(GAME_ID, { letters: captureLetters(), seconds: totalSeconds, usedHelp, revealed, firstRevealUsed, secondRevealUsed }, { completed });
  }

  // Locked until Play Now / Resume is pressed.
  let locked = true;

  function doSwap(a, b) {
    turnOffHelp(); // any move closes stale help so it never lingers on a now-outdated board
    const aText = a.textContent, bText = b.textContent;
    a.textContent = bText; b.textContent = aText;
    // Only pop the tile(s) that actually GAIN a letter, not the one(s) that
    // lose one — dragging a tray letter onto an empty spoke should read as
    // "filling an empty slot" (the tray circle just quietly goes blank),
    // not as two circles trading places. A genuine swap (both sides
    // already had a letter, and end up with a different one) still pops
    // both, since that IS two things changing at once.
    if (bText !== '') a.classList.add('tile-swapped');
    if (aText !== '') b.classList.add('tile-swapped');
    setTimeout(() => { a.classList.remove('tile-swapped'); b.classList.remove('tile-swapped'); }, 200);
    const solved = updateValidity();
    if (solved) {
      handleWin();
    } else {
      persistProgress(false);
    }
  }

  enableTileDragSwap({
    container: document.getElementById('game-root'),
    tileSelector: '.tile', // matches both spoke-tile and tray-tile; the center circle isn't a .tile and is never draggable
    isLocked: () => locked,
    // A locked spoke's tiles can't be picked up (canDrag) AND can't be
    // dropped onto either (canSwap checks the DROP TARGET `b`) — without
    // that second check, some other tile could still be dragged ONTO a
    // "locked" cell and silently overwrite its letter, even though the
    // locked tile itself could never be picked up to start that drag.
    // is-locked (see updateValidity()) only ever lands on spoke tiles —
    // tray tiles never carry it — so no separate spoke-tile check is
    // needed here, just the class itself.
    canDrag: (tile) => !tile.classList.contains('is-locked'),
    canSwap: (a, b) => !b.classList.contains('is-locked'),
    onSwap: doSwap,
  });

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

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'SPOKZ',
    emojiImage: getSpokzIconDataURL(),
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`), same convention as every other game.
    accentColor: { bg: '#F2E27A', ink: '#4A3D0D', rim: 'rgba(74, 61, 13, 0.30)' },
    instructions: '<p>Drag letters from the bottom to fill the SPOKZ</p>'
      + '<p>This makes 6 4-letter words</p>'
      + '<p>Each word starts with the same centre letter</p>'
      + '<p>The 6 words read outwards from the centre</p>'
      + '<p>Each day there is a <strong>CLUE</strong> that links the 6 words</p>'
      + '<p>Use help 💡 or reveals if you need it</p>',
    formatScore: formatTime,
  });

  // "Clue" banner — sits directly under the header (shell.js inserts
  // .shell-header right before #game-stage as siblings inside .shell, so
  // this just slots in between them). Pulls today's actual clue text from
  // THEMED_DAYS via puzzle.clue, set above.
  //
  // Two separate spans (not one string) — .clue-banner lays them out as a
  // flex row in style.css, which is what gives "Clue:" a fixed left label
  // while the description text hangs-indents under itself (not back to the
  // left margin) if it wraps to a second line.
  const $clueBanner = $('<p>', { class: 'clue-banner' }).insertAfter('.shell-header');
  $('<span>', { class: 'clue-label', text: 'Clue:' }).appendTo($clueBanner);
  $('<span>', { class: 'clue-text', text: puzzle.clue }).appendTo($clueBanner);

  // SPOKZ is the one grid game with TWO stacked pieces of content (the
  // star AND the tray below it) that both need to fit above the footer
  // without scrolling — same problem VALUZ/MOJEEZ solved via --fit-scale
  // (see shared/core/fit-to-stage.js and style.css's own comment on it).
  watchFitToStage(document.getElementById('game-stage'), document.getElementById('game-root'));

  // --- Help toggle — a purely static rules/legend panel now (no per-board
  // calculation, no eligibility gate — the button works identically no
  // matter how much of the board is filled in). Same DOM-injection pattern
  // QUADZ/SLYDZ use for their own (dynamic) help toggle, just with fixed
  // content built once here rather than recomputed on every open. Opening
  // it no longer sets usedHelp — it's instructions, not a hint about
  // today's specific puzzle, so it shouldn't tag a win as help-assisted
  // the way QUADZ/SLYDZ's own calculated hints do. ---
  let helpOn = false;

  const $helpToggle = $('<button>', {
    class: 'help-toggle is-hidden',
    type: 'button',
    html: '💡 Help',
    'aria-label': 'Toggle help',
  }).appendTo('.shell-header');

  // Each "mini row" is a literal 4-circle miniature of a real spoke
  // (center-style circle + 3 outer circles) reusing the exact same color
  // tokens the real board's is-valid/is-amber/is-invalid classes use (see
  // style.css) — so these examples are guaranteed to always match
  // whatever the live tiles actually look like, not a separately
  // hand-picked set of colors that could drift out of sync.
  function miniRow(word, stateClass) {
    const letters = word.split('');
    let html = `<div class="help-mini-row"><div class="help-mini-tile help-mini-tile--center">${letters[0]}</div>`;
    for (let i = 1; i < letters.length; i++) {
      html += `<div class="help-mini-tile help-mini-tile--${stateClass}">${letters[i]}</div>`;
    }
    return html + '</div>';
  }

  const HELP_HTML = '<p>Drag Letters from the bottom to fill the SPOKZ</p>'
    + '<p>This makes 6 4-letter words</p>'
    + '<p>Each word starts with the same centre letter</p>'
    + '<p>The 6 words read outwards from the centre</p>'
    + '<p>The 6 words are all linked by the clue provided</p>'
    + `<p>When you spell a word in today's solution it will turn green</p>${miniRow('GOOD', 'green')}`
    + `<p>When you spell a real word that is not today's solution it will turn amber</p>${miniRow('WORD', 'amber')}`
    + `<p>When you spell a word that is not recognised it will turn red</p>${miniRow('WXYZ', 'red')}`
    + `<p>If you get stuck try the <u>reveal</u> options</p>`;

  const $helpPopover = $('<div>', {
    class: 'help-popover is-hidden',
    html: `<div id="spokz-help-text">${HELP_HTML}</div>`,
  }).appendTo('.shell-header');

  function toggleHelp() {
    if (helpOn) {
      turnOffHelp();
      return;
    }
    helpOn = true;
    $helpToggle.addClass('is-active');
    $helpPopover.removeClass('is-hidden');
  }
  $helpToggle.on('click', toggleHelp);

  function turnOffHelp() {
    if (!helpOn) return;
    helpOn = false;
    $helpToggle.removeClass('is-active');
    $helpPopover.addClass('is-hidden');
  }

  document.addEventListener('click', (e) => {
    if (!helpOn) return;
    if ($helpToggle[0].contains(e.target) || $helpPopover[0].contains(e.target)) return;
    turnOffHelp();
  });

  function showHelpToggle() {
    $helpToggle.removeClass('is-hidden');
  }
  function hideHelpToggle() {
    $helpToggle.addClass('is-hidden');
    turnOffHelp();
  }

  // --- Reset — a pill button positioned INSIDE .star's own coordinate
  // system (same left/top-percentage approach buildStar() uses for every
  // spoke tile), pinned to the star's right edge at the same height as the
  // lowest spoke tile (the outermost circle of the spoke pointing straight
  // down, POS_RADII_PCT's own last value) — anchoring it to that same
  // percentage grid is what keeps it correctly aligned at any screen size,
  // rather than guessing a fixed offset from the gap between elements.
  // Sends every letter currently sitting in an UNLOCKED spoke circle back
  // to the tray, leaving any locked spoke (is-locked — see
  // updateValidity()) completely untouched — a reset can't undo a correct
  // (green) spoke or a reveal, same as dragging can't. Doesn't touch the
  // timer: this is a "clean up my own mess" convenience, not a give-up/
  // restart action. Styled to match
  // TOTALZ's own reset button (games/totalz/style.css's
  // .totalz-ledger__reset-btn) — same pill shape/padding/weight, just
  // reskinned to SPOKZ's own accent instead of TOTALZ's blue. */
  const $resetBtn = $('<button>', {
    class: 'reset-btn is-hidden',
    type: 'button',
    text: 'reset',
    'aria-label': 'Return unlocked letters to the tray',
  }).appendTo($star);
  $resetBtn.css({ top: (50 + POS_RADII_PCT[2]) + '%', right: '0%' });

  function resetBoard() {
    if (locked) return;
    turnOffHelp();
    const returningLetters = [];
    for (let i = 0; i < 6; i++) {
      if (spokeTileEl(i, 0).classList.contains('is-locked')) continue;
      for (let p = 0; p < 3; p++) {
        const el = spokeTileEl(i, p);
        if (el.textContent !== '') {
          returningLetters.push(el.textContent);
          el.textContent = '';
        }
      }
    }
    if (returningLetters.length === 0) return; // nothing to do
    const emptyTraySlots = allTrayTileEls().filter((el) => el.textContent === '');
    returningLetters.forEach((letter, idx) => {
      const slot = emptyTraySlots[idx];
      if (slot) { slot.textContent = letter; slot.classList.add('tile-swapped'); setTimeout(() => slot.classList.remove('tile-swapped'), 200); }
    });
    updateValidity();
    persistProgress(false);
  }
  $resetBtn.on('click', resetBoard);

  function showResetButton() {
    $resetBtn.removeClass('is-hidden');
  }
  function hideResetButton() {
    $resetBtn.addClass('is-hidden');
  }

  // --- Reveal slide & swap engine (parallel-batch, ported from QUADZ's
  // computeRevealPlan()/playRevealBatches() — see that file's fuller
  // comments) — target cells that can move without needing each other's
  // own letter are grouped into one "batch" and animated simultaneously,
  // so a reveal shows every letter sliding into place at once rather than
  // one at a time. A second batch only ever kicks in when a genuine
  // letter-cycle forces it. ---
  const SLIDE_MS = 1000;
  const SLIDE_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)'; // slow start (pick up) -> fast middle -> slow finish (place)

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

  // Works out which of the 36 tiles (18 spoke + 18 tray) still need to
  // change to satisfy the given targets, then groups the required swaps
  // into "batches" that can each slide in parallel. A spoke cell counts as
  // permanently "settled" the moment it holds ITS OWN correct final
  // letter — never raided as a swap source for a DIFFERENT target, even if
  // its letter happens to match what that target needs (same fix QUADZ's
  // computeRevealPlan() needed for repeated letters). Tray cells are never
  // "settled" this way — their final state is blank, which doesn't
  // protect one that's currently holding a real letter.
  function computeRevealPlan(targets) {
    const allEls = [...allSpokeTileEls(), ...allTrayTileEls()];
    const spokeCount = 18; // indices below this are spoke cells
    const working = allEls.map((el) => el.textContent);
    const elIndex = new Map(allEls.map((el, i) => [el, i]));
    const targetMap = new Map();
    targets.forEach(({ el, letter }) => targetMap.set(elIndex.get(el), letter));
    const targetIndices = [...targetMap.keys()];

    function isSettled(idx) {
      if (idx >= spokeCount) return false;
      const i = Math.floor(idx / 3), p = idx % 3;
      return working[idx] === SPOKE_SUFFIXES[i][p];
    }

    const batches = [];
    let guard = 0; // allEls.length cells can never need more passes than that; just stops a logic error from hanging the page
    while (targetIndices.some((idx) => working[idx] !== targetMap.get(idx)) && guard++ < allEls.length) {
      const usedThisBatch = new Set();
      const batch = [];
      targetIndices.forEach((idx) => {
        if (usedThisBatch.has(idx) || working[idx] === targetMap.get(idx)) return;
        const need = targetMap.get(idx);
        let source = -1;
        for (let c = 0; c < allEls.length; c++) {
          if (c === idx || usedThisBatch.has(c) || targetMap.has(c) || isSettled(c)) continue;
          if (working[c] === need) { source = c; break; }
        }
        if (source === -1) {
          for (let c = 0; c < allEls.length; c++) {
            if (c === idx || usedThisBatch.has(c) || isSettled(c)) continue;
            if (working[c] === need) { source = c; break; }
          }
        }
        if (source === -1) return; // letter-count conservation means this shouldn't happen; leave for the next pass rather than throw
        batch.push([idx, source]);
        usedThisBatch.add(idx); usedThisBatch.add(source);
        [working[idx], working[source]] = [working[source], working[idx]];
      });
      batches.push(batch);
    }
    return { batches, allEls };
  }

  function playRevealPlan({ batches, allEls }, onDone) {
    let i = 0;
    function playNext() {
      if (i >= batches.length) { onDone(); return; }
      batches[i++].forEach(([a, b]) => slideExchange(allEls[a], allEls[b]));
      setTimeout(playNext, SLIDE_MS + 80);
    }
    playNext();
  }

  // --- Reveal assists — Help (free, never touches the board) -> Reveal a
  // word -> Reveal another word -> Reveal full solution (the only one that
  // ENDS today's round — the two partial reveals let the player keep
  // playing afterwards). The two partial reveals no longer target fixed
  // spoke positions (the old "Reveal 1st word"/"Reveal 2nd word" always
  // meant spoke 0/spoke 1, which was wasted if the player had already
  // solved that spoke themselves) — pickUnsolvedSpoke() below picks
  // whichever spoke is still unsolved at the moment each button is used,
  // so every reveal always does something useful. ---
  const $revealActions = $('<div>', { class: 'reveal-actions' }).appendTo('#game-root');
  const $revealFirstBtn = $('<button>', { class: 'reveal-btn is-hidden', type: 'button', text: 'Reveal a word' }).appendTo($revealActions);
  const $revealSecondBtn = $('<button>', { class: 'reveal-btn is-hidden', type: 'button', text: 'Reveal another word' }).appendTo($revealActions);
  const $revealBtn = $('<button>', { class: 'reveal-btn is-hidden', type: 'button', text: 'Reveal full solution' }).appendTo($revealActions);

  // The first spoke (in spoke-index order) that ISN'T already locked (see
  // updateValidity() — is-locked means it's already spelling one of
  // today's own solution words, whether the player found it themselves or
  // it was revealed earlier) — i.e. the next spoke a partial reveal should
  // target. Returns null only if every spoke is already solved, which
  // shouldn't normally be reachable (the reveal buttons hide on a win).
  function pickUnsolvedSpoke() {
    for (let i = 0; i < 6; i++) {
      if (!spokeTileEl(i, 0).classList.contains('is-locked')) return i;
    }
    return null;
  }

  function showRevealButtons() {
    if (!firstRevealUsed) $revealFirstBtn.removeClass('is-hidden');
    if (!secondRevealUsed) $revealSecondBtn.removeClass('is-hidden');
    $revealBtn.removeClass('is-hidden');
  }
  function hideRevealButtons() {
    $revealFirstBtn.addClass('is-hidden');
    $revealSecondBtn.addClass('is-hidden');
    $revealBtn.addClass('is-hidden');
  }

  // Same custom confirm panel as QUADZ/SLYDZ — reuses shell.js's own
  // .shell-overlay/.shell-overlay__panel/.shell-end-screen__message classes
  // rather than a separate near-identical copy, so it can never visually
  // drift out of sync with the start banner/end-screen.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title reveal-confirm__title"></p>
          <div class="reveal-confirm__body"></div>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="spokz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="spokz-reveal-confirm"></button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  const REVEAL_EXPLAINER = '<p>For SPOKZ there is always a daily solution: 6 words, one per spoke, all starting with the center letter.</p>'
    + '<p>This solution may not be the only way to solve the puzzle, and may not contain any of the valid words you\'ve already found — revealing may replace those.</p>';

  let pendingRevealTarget = null; // 'first' | 'second' | 'full', set while the confirm panel is open — 'first'/'second' just track which BUTTON was pressed, not which spoke; the spoke itself is picked fresh (via pickUnsolvedSpoke()) once the reveal is confirmed

  function openRevealConfirm(target) {
    pendingRevealTarget = target;
    const titles = { first: 'Reveal a word?', second: 'Reveal another word?', full: "Reveal today's solution?" };
    const confirmLabels = { first: 'Reveal word', second: 'Reveal word', full: 'Reveal Solution' };
    const endingNote = target === 'full' ? '<p>You won\'t be able to complete SPOKZ yourself today.</p>' : '';
    $revealConfirm.find('.reveal-confirm__title').text(titles[target]);
    $revealConfirm.find('.reveal-confirm__body').html(REVEAL_EXPLAINER + endingNote);
    $revealConfirm.find('#spokz-reveal-confirm').text(confirmLabels[target]);
    $revealConfirm.removeClass('is-hidden');
  }

  $revealConfirm.find('#spokz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    pendingRevealTarget = null;
  });
  $revealConfirm.find('#spokz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    if (pendingRevealTarget === 'first' || pendingRevealTarget === 'second') {
      const spokeIndex = pickUnsolvedSpoke();
      if (spokeIndex !== null) revealSpokeWord(spokeIndex, pendingRevealTarget);
    } else if (pendingRevealTarget === 'full') {
      revealSolution();
    }
    pendingRevealTarget = null;
  });

  $revealFirstBtn.on('click', () => {
    if (locked || firstRevealUsed) return;
    openRevealConfirm('first');
  });
  $revealSecondBtn.on('click', () => {
    if (locked || secondRevealUsed) return;
    openRevealConfirm('second');
  });
  $revealBtn.on('click', () => {
    if (locked) return;
    openRevealConfirm('full');
  });

  // Reveals one spoke's own 3 letters, sliding each in from wherever it
  // currently sits. `locked` goes true only for the ~1s the tiles are
  // sliding — a partial reveal doesn't end the round, so a win right after
  // one still goes through the normal handleWin() path. `which` is just
  // 'first'/'second' — which reveal-button this use counts against, not
  // which spoke (the spoke index `i` is picked by the caller).
  function revealSpokeWord(i, which) {
    if (which === 'first') { firstRevealUsed = true; $revealFirstBtn.addClass('is-hidden'); }
    else { secondRevealUsed = true; $revealSecondBtn.addClass('is-hidden'); }
    locked = true;
    const targets = [0, 1, 2].map((p) => ({ el: spokeTileEl(i, p), letter: SPOKE_SUFFIXES[i][p] }));
    playRevealPlan(computeRevealPlan(targets), () => {
      locked = false;
      if (updateValidity()) {
        handleWin();
      } else {
        persistProgress(false);
      }
    });
  }

  // Reachable only via the player's own confirmed choice to give up —
  // reveals the full daily solution, locks the board same as a real
  // finish, but records it as a NON-win (no submitScore(), no celebrate),
  // same spirit as QUADZ/SLYDZ's own revealSolution().
  function revealSolution() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButtons();
    hideResetButton();
    revealed = true;
    const targets = [];
    for (let i = 0; i < 6; i++) for (let p = 0; p < 3; p++) targets.push({ el: spokeTileEl(i, p), letter: SPOKE_SUFFIXES[i][p] });
    playRevealPlan(computeRevealPlan(targets), () => {
      updateValidity();
      persistProgress(true);
      saveTodayOutcome(GAME_ID, {
        revealed: true, usedHelp, failed: false, isNewBest: false, isTie: false,
        panelOutcome: 'reveal', panelIsNewBest: false,
      });
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: `🧭 SPOKZ - did not solve today`,
      });
    });
  }

  // Restarts the win-spin animation from scratch, even if .star already
  // has the class from an earlier win this same page session. A CSS
  // animation doesn't replay just because its trigger class gets added
  // again while already present — removing it, forcing a synchronous
  // layout reflow (reading offsetWidth — a no-op value, but the ACT of
  // reading it is what forces the browser to apply the removal before the
  // next line re-adds the class, rather than batching both class changes
  // into a single invisible no-op), then re-adding it is the standard way
  // to force a genuine restart.
  function playWinSpin() {
    $star.removeClass('is-win-spinning');
    void $star[0].offsetWidth;
    $star.addClass('is-win-spinning');
  }

  // Shared by both a real player win and the dev "Solve puzzle" shortcut.
  function handleWin() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    hideRevealButtons();
    hideResetButton();
    // The whole wheel does one fast-to-slow full rotation the instant the
    // puzzle is solved — see style.css's .star.is-win-spinning. Only ever
    // triggered on an actual live win (never on the 'completed' resume
    // branch below), same rule celebrate/confetti follows. playWinSpin()
    // (not a plain addClass) is what makes this replay correctly on a
    // SECOND win in the same page session (e.g. the dev "Preview: <pool
    // type>" shortcuts) — the class was already left on .star from the
    // first win, and re-adding an already-present class doesn't restart a
    // CSS animation, so it silently only ever played once per page load
    // without the remove+reflow+re-add dance below.
    playWinSpin();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
    // A meaningful PB needs a real previous best to have beaten — not the
    // player's first-ever play, and not a previous best of exactly 0.
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
      shareText: `🧭 SPOKZ - solved in ${formatTime(totalSeconds)}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Testing shortcut: instantly restores today's guaranteed-valid
  // arrangement and ends the game, same as a real win.
  function solvePuzzle() {
    shell.hideStartBanner();
    for (let i = 0; i < 6; i++) for (let p = 0; p < 3; p++) spokeTileEl(i, p).textContent = SPOKE_SUFFIXES[i][p];
    allTrayTileEls().forEach((el) => { el.textContent = ''; });
    updateValidity();
    handleWin();
  }

  // Dev-only: jump straight to any of THEMED_DAYS's 8 pool types without
  // waiting for the real calendar cycle. Rebuilds every puzzle-derived
  // variable in place (CENTER_LETTER/SPOKE_SUFFIXES/SOLUTION are all `let`
  // for exactly this reason — see where they're first declared above) and
  // resets the board/timer/flags to a fresh start. Same caveat as every
  // other dev shortcut in this codebase
  // (e.g. "Solve puzzle" above): normal gameplay actions taken afterward
  // (dragging, help, reveal, winning) still persist through the real
  // GAME_ID storage key exactly like a real session would — this is a
  // dev tool for eyeballing each mechanic, not a sandboxed preview with
  // no side effects.
  function previewThemedDay(index) {
    const themedDay = THEMED_DAYS[index];
    shell.hideStartBanner();
    // .shell-end-screen has no public hide() in shell.js's own returned
    // API (only showEndScreen) — reaching for its class directly is the
    // only way to dismiss a currently-showing end screen from outside
    // shell.js itself, acceptable for a dev-only shortcut.
    document.querySelector('.shell-end-screen')?.classList.add('is-hidden');
    $star.removeClass('is-win-spinning'); // clean slate — playWinSpin() re-adds it fresh on the NEXT win, however this preview round ends

    turnOffHelp();
    hideRevealButtons(); // re-shown below once the fresh flags are in place
    stopTimer();

    CENTER_LETTER = themedDay.words[0][0];
    SPOKE_SUFFIXES = themedDay.words.map((w) => w.slice(1).split(''));
    SOLUTION = themedDay.words;

    $centerCircle.text(CENTER_LETTER);
    $clueBanner.find('.clue-text').text(themedDay.clue);

    allSpokeTileEls().forEach((el) => {
      el.textContent = '';
      el.classList.remove('is-filled', 'is-valid', 'is-amber', 'is-invalid', 'is-locked');
    });
    const trayLetters = [];
    SPOKE_SUFFIXES.forEach((suf) => trayLetters.push(...suf));
    buildTray(seededShuffle(trayLetters, index * 911));

    usedHelp = false;
    revealed = false;
    firstRevealUsed = false;
    secondRevealUsed = false;
    for (let i = 0; i < 6; i++) spokeValid[i] = false;

    totalSeconds = 0;
    updateTimerDisplay();
    locked = false;
    startTimer();
    showHelpToggle();
    showRevealButtons();
  }

  initToolsPanel([GAME_ID], {
    extraActions: [
      { label: 'Solve puzzle', onClick: solvePuzzle },
      ...THEMED_DAYS.map((day, i) => ({ label: `Preview: ${day.poolType}`, onClick: () => previewThemedDay(i) })),
    ],
  });

  // Same three-way daily-status branch as every other game — see the
  // fuller explanation in games/solvz/index.js.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false; // `|| false` covers old saves from before this field existed
    revealed = data.revealed || false;
    firstRevealUsed = data.firstRevealUsed || false;
    secondRevealUsed = data.secondRevealUsed || false;
    updateTimerDisplay();
    updateValidity();
    // No `celebrate`/win-spin on this branch either way — this only runs
    // when revisiting a day already finished in an EARLIER session, not on
    // the actual moment of winning/revealing.
    if (revealed) {
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: `🧭 SPOKZ - did not solve today`,
      });
    } else {
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🧭 SPOKZ - solved in ${formatTime(totalSeconds)}`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyLetters(data.letters);
    totalSeconds = data.seconds;
    usedHelp = data.usedHelp || false;
    firstRevealUsed = data.firstRevealUsed || false;
    secondRevealUsed = data.secondRevealUsed || false;
    updateTimerDisplay();
    updateValidity();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButtons();
      showResetButton();
      startTimer();
    }, { label: 'Resume' });
  } else {
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      showRevealButtons();
      showResetButton();
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

});
