// NEYBUZ — a 5x5 grid of number tiles (1-5). Drag tiles to swap until no
// tile touches another tile that's the same number or exactly one away from
// it (up/down/left/right; diagonals don't count). Every fresh puzzle starts
// with exactly one tile already correct, chosen so a solution is always
// reachable from there — see generateDailyPuzzle() below.
//
// Ported from a standalone prototype (built and extensively stress-tested
// separately before this integration) — the solver/reveal engine here is
// the same tested logic, just wired into the shared shell/timer/best-score/
// dev-panel/drag-swap framework every other game uses.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';
import { requireStandalone } from '../../shared/core/install-gate.js';
import { getToolMode } from '../../shared/core/tool-mode.js';
import { getNeybuzIconDataURL } from './tile-icon.js';

await requireStandalone();

hidePageLoadingIndicator();
stripReloadParam();

const GAME_ID = 'neybuz';
const N = 5;
const TOTAL_TILES = N * N;

// --- Curated daily distributions, one set per difficulty tier ---
// Picked from an exhaustive sweep of all 5x5 distributions (23,751 total,
// 1,940 actually solvable) computed separately: quartile boundaries by
// solved-layout count were hardest 1-914, hard 914-9,284, medium
// 9,284-68,544, easy 68,544-2,838,528. Six representative distributions
// spread across each band, hand-picked to avoid any zero counts (a value
// missing entirely from the board looks like a mistake, not a puzzle).
const TIER_NAMES = ['easy', 'medium', 'hard', 'hardest'];
const CURATED_DISTS = {
  easy: [[5, 5, 2, 7, 6], [3, 7, 3, 5, 7], [4, 6, 2, 6, 7], [10, 1, 4, 3, 7], [7, 3, 4, 2, 9], [7, 5, 1, 5, 7]],
  medium: [[5, 7, 3, 2, 8], [10, 1, 7, 5, 2], [1, 10, 1, 6, 7], [7, 2, 4, 5, 7], [10, 3, 4, 2, 6], [5, 5, 2, 7, 6]],
  hard: [[10, 2, 8, 3, 2], [1, 8, 3, 6, 7], [3, 10, 1, 4, 7], [4, 3, 7, 3, 8], [3, 9, 2, 5, 6], [5, 7, 3, 2, 8]],
  hardest: [[1, 10, 2, 9, 3], [4, 6, 7, 1, 7], [5, 4, 9, 1, 6], [6, 1, 8, 4, 6], [10, 1, 3, 9, 2], [4, 6, 6, 2, 7]],
};

// --- Core rule + solver (same tested logic as the standalone prototype) ---

function idx(r, c) { return r * N + c; }
function violates(a, b) { return a === b || Math.abs(a - b) === 1; }

const ALLOWED = {};
for (let a = 1; a <= 5; a++) {
  ALLOWED[a] = {};
  for (let b = 1; b <= 5; b++) ALLOWED[a][b] = Math.abs(a - b) >= 2;
}

function neighborsOf(i) {
  const r = Math.floor(i / N), c = i % N;
  const res = [];
  if (r > 0) res.push(idx(r - 1, c));
  if (r < N - 1) res.push(idx(r + 1, c));
  if (c > 0) res.push(idx(r, c - 1));
  if (c < N - 1) res.push(idx(r, c + 1));
  return res;
}

function computeGoodMask(board) {
  const good = new Array(TOTAL_TILES);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(r, c);
      const v = board[i];
      const neigh = [];
      if (r > 0) neigh.push(board[idx(r - 1, c)]);
      if (r < N - 1) neigh.push(board[idx(r + 1, c)]);
      if (c > 0) neigh.push(board[idx(r, c - 1)]);
      if (c < N - 1) neigh.push(board[idx(r, c + 1)]);
      good[i] = !neigh.some((n) => violates(v, n));
    }
  }
  return good;
}

// fixed: array of 25, value or null (null = free cell to fill). pool:
// counts[1..5] of values available for the null cells. Backtracking search,
// most-constrained-value-first — same solver used throughout calibration
// (typically a few ms, worst case a few hundred ms even on a fresh board).
function solveWithFixed(fixed, pool, nodeCap) {
  const working = fixed.slice();
  const rem = pool.slice();
  let nodes = 0;
  let timedOut = false;

  const freeCells = [];
  for (let i = 0; i < TOTAL_TILES; i++) if (fixed[i] === null) freeCells.push(i);
  const neighCache = freeCells.map(neighborsOf);

  function backtrack(pos) {
    nodes++;
    if (nodes > nodeCap) { timedOut = true; return false; }
    if (pos === freeCells.length) return true;
    const cellIdx = freeCells[pos];
    const neigh = neighCache[pos];

    const candidates = [];
    for (let v = 1; v <= 5; v++) if (rem[v - 1] > 0) candidates.push(v);
    candidates.sort((x, y) => rem[y - 1] - rem[x - 1]);

    for (const v of candidates) {
      let ok = true;
      for (const n of neigh) {
        const nv = working[n];
        if (nv !== null && nv !== undefined && !ALLOWED[nv][v]) { ok = false; break; }
      }
      if (!ok) continue;
      working[cellIdx] = v;
      rem[v - 1]--;
      if (backtrack(pos + 1)) return true;
      rem[v - 1]++;
      working[cellIdx] = null;
      if (timedOut) return false;
    }
    return false;
  }

  const found = backtrack(0);
  return { found, timedOut, nodes, board: found ? working.slice() : null };
}

function checkSolvable(board, good) {
  const fixed = board.map((v, i) => (good[i] ? v : null));
  const pool = [0, 0, 0, 0, 0];
  for (let i = 0; i < TOTAL_TILES; i++) if (!good[i]) pool[board[i] - 1]++;
  return solveWithFixed(fixed, pool, 6000000).found;
}

function isSolvableBoard(board) {
  const good = computeGoodMask(board);
  if (good.every(Boolean)) return true;
  return checkSolvable(board, good);
}

// Derives a fresh valid completion from the LIVE board on every call — every
// currently-green cell's value goes in verbatim (never a fixed answer key),
// and the solver fills the rest. This is what makes the reveal engine safe
// even though this puzzle (unlike QUADZ/SLYDZ) has no single canonical
// answer — see findCycles()'s own comment below for the fuller story.
function deriveFullAnswer(board) {
  const good = computeGoodMask(board);
  const fixed = board.map((v, i) => (good[i] ? v : null));
  const pool = [0, 0, 0, 0, 0];
  for (let i = 0; i < TOTAL_TILES; i++) if (!good[i]) pool[board[i] - 1]++;
  const res = solveWithFixed(fixed, pool, 6000000);
  return res.found ? res.board : null;
}

function getRedIndices(board) {
  const good = computeGoodMask(board);
  const red = [];
  for (let i = 0; i < TOTAL_TILES; i++) if (!good[i]) red.push(i);
  return red;
}

// --- Reveal engine ---
//
// A direct port of QUADZ/SLYDZ's own reveal algorithm (raid whatever cell
// currently holds a needed value) turned out to be unsafe here: QUADZ/SLYDZ
// correctness is purely POSITIONAL (a letter either matches the one fixed
// target for that cell or it doesn't), so dumping a leftover value onto some
// unrelated cell is always harmless there. NEYBUZ's correctness is
// RELATIONAL (depends on neighbors), so that same leftover value can land
// next to an already-green tile and break it as a side effect.
//
// The fix that held up under stress testing: decompose the red-cell
// current-value -> fullAnswer permutation into disjoint CYCLES. Resolving a
// whole cycle only ever touches cells inside it, and leaves every one of
// them at its own exact fullAnswer value — safe by construction, since
// fullAnswer is already a complete, self-consistent board.
//
// A second thing testing caught: reaching a cell's exact correct value
// isn't the same as that cell turning green — green also needs every one of
// ITS neighbors to already be correct. So candidate reveals are scored by
// the ACTUAL resulting green-tile increase (computed by simulating each
// candidate), not by how many cells got touched.
function shuffleArr(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findCycles(redPositions, fullAnswer, currentBoard) {
  const byNeeded = {};
  redPositions.forEach((p) => { const v = fullAnswer[p]; (byNeeded[v] = byNeeded[v] || []).push(p); });
  Object.keys(byNeeded).forEach((k) => { byNeeded[k] = shuffleArr(byNeeded[k]); });
  const usedNeeded = {};
  const f = {};
  // prefer a position that already needs its own current value — gives it a
  // trivial 1-cycle, so it's never touched at all
  shuffleArr(redPositions).forEach((p) => {
    const v = currentBoard[p];
    if (byNeeded[v] && byNeeded[v].indexOf(p) !== -1 && !usedNeeded[p]) { f[p] = p; usedNeeded[p] = true; }
  });
  shuffleArr(redPositions).forEach((p) => {
    if (f[p] !== undefined) return;
    const v = currentBoard[p];
    const candidates = byNeeded[v] || [];
    for (const cand of candidates) {
      if (!usedNeeded[cand]) { f[p] = cand; usedNeeded[cand] = true; break; }
    }
  });
  const visited = {};
  const cycles = [];
  redPositions.forEach((start) => {
    if (visited[start]) return;
    const cycle = [];
    let cur = start;
    while (!visited[cur]) { visited[cur] = true; cycle.push(cur); cur = f[cur]; }
    cycles.push(cycle);
  });
  return cycles.filter((c) => c.length > 1);
}

function applyCyclesToArray(board, cycles) {
  const out = board.slice();
  cycles.forEach((cycle) => {
    for (let k = 1; k < cycle.length; k++) {
      const t = out[cycle[0]]; out[cycle[0]] = out[cycle[k]]; out[cycle[k]] = t;
    }
  });
  return out;
}

// Exhaustive subset search over the available cycles (always few enough —
// at most 24 red cells, cycles only get smaller from there — to make 2^n
// combinations cheap). Keeps only combinations that leave the board
// solvable afterward, scored against the ACTUAL resulting green-tile gain.
function chooseSafeCycleSet(board, cycles, targetCount) {
  const n = cycles.length;
  const beforeGreen = computeGoodMask(board).filter(Boolean).length;
  let best = null;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(cycles[i]);
    const hypothetical = applyCyclesToArray(board, subset);
    if (!isSolvableBoard(hypothetical)) continue;
    const gain = computeGoodMask(hypothetical).filter(Boolean).length - beforeGreen;
    const score = Math.abs(gain - targetCount) - (gain >= targetCount ? 0.5 : 0);
    if (best === null || score < best.score) best = { subset, gain, score };
  }
  return best || { subset: [], gain: 0, score: Infinity };
}

function cyclesToBatches(cycles) {
  const batches = [];
  cycles.forEach((cycle) => {
    for (let k = 1; k < cycle.length; k++) {
      const bi = k - 1;
      batches[bi] = batches[bi] || [];
      batches[bi].push([cycle[0], cycle[k]]);
    }
  });
  return batches.filter((b) => b);
}

$(function () {

  // --- Seeded PRNG — same technique as SOLVZ/SLYDZ's own daily generator
  // (see the longer explanation in games/solvz/index.js) — deterministic,
  // "random-looking" numbers so every player gets the identical puzzle on
  // the same calendar day, with zero server/network involved. ---
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

  // --- Difficulty schedule across the full 366-day cycle ---
  // 40% easy / 30% medium / 20% hard / 10% hardest, so every player sees
  // the same day -> tier mapping. 366 * [.4,.3,.2,.1] = [146.4,109.8,73.2,
  // 36.6] — rounded to 146/110/73/37, which happens to sum to exactly 366,
  // so no leftover days need special-casing. Built once as a seeded
  // shuffle (fixed seed, NOT day-dependent — this only needs to run once,
  // not per day) of a quota-filled bag, so the tiers land spread through
  // the year rather than clumped in raw quota order (all 146 easy days
  // first, then all medium, ...).
  const TIER_QUOTAS = { easy: 146, medium: 110, hard: 73, hardest: 37 };

  // Days 233-236 (2026-08-21 through 2026-08-24, this build's "today"
  // through 3 days out) are pinned explicitly — easy/easy/medium/hard —
  // rather than left to the shuffle, so testing over the next few days
  // hits a known, deliberately-ramping sequence. Every other day still
  // comes from the seeded shuffle below, just built from the quota MINUS
  // these 4 already-spent days, so the full-year 146/110/73/37 split still
  // holds exactly once these are folded back in.
  const PINNED_DAYS = { 233: 'easy', 234: 'easy', 235: 'medium', 236: 'hard' };

  const TIER_SCHEDULE = (function buildTierSchedule() {
    const quotas = { ...TIER_QUOTAS };
    Object.values(PINNED_DAYS).forEach((tier) => { quotas[tier]--; });
    const bag = [];
    TIER_NAMES.forEach((tier) => { for (let i = 0; i < quotas[tier]; i++) bag.push(tier); });
    const shuffled = seededShuffle(bag, 20260821);

    const schedule = new Array(366);
    let bagIdx = 0;
    for (let day = 1; day <= 366; day++) {
      schedule[day - 1] = PINNED_DAYS[day] || shuffled[bagIdx++];
    }
    return schedule;
  })();

  // Dev-tools only: forces every subsequent generateDailyPuzzle() call to
  // use this tier instead of TIER_SCHEDULE's — see regeneratePuzzle() below
  // and its own "Difficulty" radio group in the Wiring section, which is
  // what actually sets this.
  let tierOverride = null;

  // Builds one day's puzzle: picks a difficulty tier (see TIER_SCHEDULE
  // above) and one curated distribution within it, then keeps re-shuffling
  // (seeded, so this is still fully deterministic) until landing on a
  // start arrangement with exactly one tile already correct AND provably
  // still solvable from there — same "always exactly 1 green, always
  // reachable" guarantee the standalone prototype was built and tested
  // around.
  function generateDailyPuzzle(day) {
    const tier = tierOverride || TIER_SCHEDULE[(day - 1) % 366];
    const options = CURATED_DISTS[tier];
    const dist = options[getSeededInt(0, options.length - 1, day * 991)];

    const bag = [];
    for (let v = 1; v <= 5; v++) for (let k = 0; k < dist[v - 1]; k++) bag.push(v);

    let seed = day * 733;
    let attempt = 0;
    let candidate;
    while (attempt < 5000) {
      candidate = seededShuffle(bag, seed);
      seed += 1009; // prime jump, well ahead in the sequence for the next attempt
      attempt++;
      const good = computeGoodMask(candidate);
      if (good.filter(Boolean).length === 1 && checkSolvable(candidate, good)) break;
    }

    return { tier, dist, startBoard: candidate };
  }

  // Only today's puzzle is ever needed on a given load — generating all 366
  // up front (each one its own rejection-sampling + backtracking search)
  // was taking several seconds on every single page load for no benefit.
  const todayDayOfYear = dayOfYear();
  const puzzle = generateDailyPuzzle(todayDayOfYear);

  console.log(`🟩🟥 NEYBUZ Daily Puzzle (Day ${todayDayOfYear} of 366): tier=${puzzle.tier} dist=[${puzzle.dist.join(',')}]`);
  document.getElementById('difficultyTier').textContent = puzzle.tier;

  // --- Board state + rendering ---

  let board = puzzle.startBoard.slice();
  let selectedIndex = null;
  // The single most recent player-made swap (drag or tap), as an [a, b]
  // index pair, or null when there's nothing to undo. Deliberately just
  // the last one, not a full history — undo consumes it (sets this back to
  // null) rather than popping a stack, so only one step back is ever
  // offered, never a chain of them. Reveals have their own confirm flow
  // and clear this outright (see doReveal() below) rather than being
  // individually undoable. A swap is its own inverse, so undoing is just
  // swap(a, b) again on the same pair. Not persisted — a reload starts
  // this null, same as a genuinely fresh session.
  let lastMove = null;
  // Starts as 'YES' (not null) to match the flip card's own CSS default —
  // .pill-face.yes is the face shown at rotateY(0) with no flips at all.
  // Starting from null looked harmless but wasn't: setPill() only rotates
  // on a CHANGE from the tracked state, so null->'YES' (the very first
  // verdict on every fresh puzzle, which is always solvable by design)
  // still counted as one, landing on an ODD total flip — which the CSS
  // shows as the NO face, regardless of which string was actually passed
  // in. Tracking the true starting face here keeps the flip count (and so
  // the visible face) in sync with the real state from the first call on.
  let pillState = 'YES';
  let pillAngle = 0;

  const $board = $('#board');
  const $pill = $('#pill');

  function buildTiles() {
    $board.empty();
    for (let i = 0; i < TOTAL_TILES; i++) {
      $('<div>', { class: 'tile', 'data-index': i, tabindex: 0 }).appendTo($board);
    }
  }
  buildTiles();

  function formatTime(totalSecs) {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Single source of copy for both the start banner's instructions AND the
  // in-game Help popover further down — deliberately identical in both
  // places (one canonical explanation of the rules/UI, not two texts that
  // can drift apart), so this only ever gets written once.
  const INSTRUCTIONS_HTML =
    '<p>A 5&times;5 grid — each tile has a number.</p>' +
    '<p>Drag and swap tiles so no tile is a neighbour with the <b>same number</b>, or the <b>next number</b> — so a 3 can\'t neighbour a 2 or 4.</p>' +
    '<p>Tiles that fit are <b>green</b>, others <b>red</b> — the borders between tiles also show the fit.</p>' +
    '<p>The <b>YES</b> / <b>NO</b> pill shows if there\'s a path to solve.</p>' +
    '<p>You can use <b>undo</b> to reverse the last move.</p>' +
    '<p>If you get stuck, use the <b>reveals</b>.</p>';

  // Called here, right after the board itself exists, and BEFORE anything
  // below that depends on the DOM chrome it builds — in particular the
  // Help toggle further down appends itself into '.shell-header', which
  // this call is what actually creates.
  const shell = initShell({
    gameId: GAME_ID,
    title: 'NEYBUZ',
    emojiImage: getNeybuzIconDataURL(),
    instructions: INSTRUCTIONS_HTML,
    hubPath: '../../index.html',
    formatScore: formatTime,
    accentColor: { bg: '#D6B8EC', ink: '#3D2654', rim: 'rgba(70, 30, 100, 0.30)' },
  });

  function setPill(newState, animate) {
    if (pillState === newState) return;
    pillState = newState;
    pillAngle += 180;
    $pill.css('transition', animate ? 'transform 1s ease' : 'none');
    $pill.css('transform', `rotateY(${pillAngle}deg)`);
  }

  function render() {
    const tiles = $board.children();
    let satisfied = 0;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        const v = board[i];
        const $tile = tiles.eq(i);
        $tile.text(v);

        const neighbors = [];
        if (r > 0) neighbors.push(board[idx(r - 1, c)]);
        if (r < N - 1) neighbors.push(board[idx(r + 1, c)]);
        if (c > 0) neighbors.push(board[idx(r, c - 1)]);
        if (c < N - 1) neighbors.push(board[idx(r, c + 1)]);

        const bad = neighbors.some((n) => violates(v, n));
        $tile.toggleClass('good', !bad);
        if (!bad) satisfied++;

        const tileEl = $tile[0];
        tileEl.style.borderRightColor = c < N - 1
          ? (violates(v, board[idx(r, c + 1)]) ? 'var(--neybuz-bad-border)' : 'var(--neybuz-good-border)')
          : '#d8dae0';
        tileEl.style.borderBottomColor = r < N - 1
          ? (violates(v, board[idx(r + 1, c)]) ? 'var(--neybuz-bad-border)' : 'var(--neybuz-good-border)')
          : '#d8dae0';
        tileEl.style.borderLeftColor = c > 0
          ? (violates(v, board[idx(r, c - 1)]) ? 'var(--neybuz-bad-border)' : 'var(--neybuz-good-border)')
          : '#d8dae0';
        tileEl.style.borderTopColor = r > 0
          ? (violates(v, board[idx(r - 1, c)]) ? 'var(--neybuz-bad-border)' : 'var(--neybuz-good-border)')
          : '#d8dae0';
      }
    }

    const good = computeGoodMask(board);
    // Skip the pill update mid-reveal: a multi-tile cycle lands as several
    // sequential swaps (see playRevealBatches), and only the FULLY resolved
    // cycle is guaranteed solvable (chooseSafeCycleSet never checks the
    // in-between states) — updating the pill on every intermediate swap can
    // flash a true-but-misleading NO before the last swap lands it back on YES.
    if (!revealAnimating) {
      const verdict = satisfied === TOTAL_TILES ? 'YES' : (checkSolvable(board, good) ? 'YES' : 'NO');
      setPill(verdict, true);
    }

    updateRevealButtons();
    return satisfied;
  }

  function swap(a, b) {
    const t = board[a]; board[a] = board[b]; board[b] = t;
  }

  // --- Reveal buttons + confirm dialog ---

  const $revealBtn1 = $('#revealBtn1');
  const $revealBtn2 = $('#revealBtn2');
  const $revealBtn3 = $('#revealBtn3');
  const $undoBtn = $('#undoBtn');

  let reveal1Used = false;
  let reveal2Used = false;
  let anyRevealUsed = false;
  let revealAnimating = false;
  let revealed = false;

  const SLIDE_MS = 1000;
  const SLIDE_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';

  function tileElAt(i) { return $board.children().eq(i)[0]; }

  function slideExchange(elA, elB) {
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();
    const dx = rectB.left - rectA.left;
    const dy = rectB.top - rectA.top;
    const valA = elA.textContent;
    const valB = elB.textContent;
    elA.textContent = valB;
    elB.textContent = valA;

    [[elA, dx, dy], [elB, -dx, -dy]].forEach(([el, tx, ty]) => {
      el.style.zIndex = '5';
      el.style.transition = 'none';
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        [elA, elB].forEach((el) => {
          el.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;
          el.style.transform = 'translate(0, 0)';
        });
      });
    });

    setTimeout(() => {
      [elA, elB].forEach((el) => {
        el.style.zIndex = '';
        el.style.transition = '';
        el.style.transform = '';
      });
    }, SLIDE_MS + 60);
  }

  function playRevealBatches(batches, onBatchLanded, onAllDone) {
    let i = 0;
    function playNext() {
      if (i >= batches.length) { onAllDone(); return; }
      const batch = batches[i++];
      batch.forEach(([a, b]) => slideExchange(tileElAt(a), tileElAt(b)));
      setTimeout(() => { onBatchLanded(batch); playNext(); }, SLIDE_MS + 80);
    }
    playNext();
  }

  function doReveal(tier) {
    if (revealAnimating) return;
    const redIndices = getRedIndices(board);
    if (redIndices.length === 0) return;

    const fullAnswer = deriveFullAnswer(board);
    if (!fullAnswer) return; // shouldn't happen — the pill guarantees solvability

    // A reveal isn't a single undoable "move" the way a swap is, and
    // undoing back through it could un-green tiles the reveal deliberately
    // protected — simplest safe rule is it just closes the book on
    // whatever came before it.
    lastMove = null;

    let chosen;
    if (tier === 3) {
      chosen = findCycles(redIndices, fullAnswer, board);
    } else {
      let best = { subset: [], gain: -Infinity, score: Infinity };
      for (let attempt = 0; attempt < 40; attempt++) {
        const res = chooseSafeCycleSet(board, findCycles(redIndices, fullAnswer, board), 4);
        if (res.score < best.score) best = res;
        if (best.gain === 4) break;
      }
      chosen = best.subset;
    }
    const batches = cyclesToBatches(chosen);

    if (tier === 1) reveal1Used = true;
    if (tier === 2) reveal2Used = true;
    if (tier === 3) revealed = true;
    anyRevealUsed = true;
    revealAnimating = true;
    clearSelection();
    updateRevealButtons();

    if (batches.length === 0) {
      revealAnimating = false;
      const satisfied = render();
      if (satisfied === TOTAL_TILES) finishRound();
      else persistProgress(false);
      return;
    }

    playRevealBatches(
      batches,
      (batch) => { batch.forEach(([a, b]) => swap(a, b)); render(); },
      () => {
        revealAnimating = false;
        const satisfied = render();
        if (satisfied === TOTAL_TILES) finishRound();
        else persistProgress(false);
      }
    );
  }

  function updateRevealButtons() {
    const solved = getRedIndices(board).length === 0;
    // A free swap has no solvability guard (unlike a reveal), so a player
    // can genuinely swap themselves into a dead end — offering a reveal
    // there would just silently no-op (deriveFullAnswer has nothing to
    // give), which read as "the button doesn't work". Hide instead.
    const unsolvable = !solved && !isSolvableBoard(board);
    $revealBtn1.toggleClass('is-hidden', solved || unsolvable || reveal1Used || locked);
    // sequential: "4 more" only appears once "4" has actually been used
    $revealBtn2.toggleClass('is-hidden', solved || unsolvable || !reveal1Used || reveal2Used || locked);
    $revealBtn3.toggleClass('is-hidden', solved || unsolvable || locked);
    $revealBtn1.prop('disabled', revealAnimating);
    $revealBtn2.prop('disabled', revealAnimating);
    $revealBtn3.prop('disabled', revealAnimating);
    updateUndoButton();
  }

  function updateUndoButton() {
    $undoBtn.toggleClass('is-hidden', locked);
    $undoBtn.prop('disabled', !lastMove || revealAnimating);
  }

  // A swap is its own inverse — undoing is just re-applying the same pair,
  // slid back with the same FLIP-animation technique the reveal engine
  // uses (see slideExchange() above) rather than snapping instantly.
  // Reuses revealAnimating as the general "board mid-animation" lock (it
  // already gates dragging/reveal-buttons/the pill's mid-move flicker —
  // see render()'s own comment — this just piggybacks on that rather than
  // adding a parallel flag for what's the same kind of in-flight state).
  function undoLastMove() {
    if (locked || revealAnimating || !lastMove) return;
    const [a, b] = lastMove;
    lastMove = null; // consumed — this is a one-shot undo, not a stack
    turnOffHelp();
    clearSelection();
    revealAnimating = true;
    updateUndoButton();
    slideExchange(tileElAt(a), tileElAt(b));
    setTimeout(() => {
      swap(a, b);
      revealAnimating = false;
      const satisfied = render();
      if (satisfied === TOTAL_TILES) finishRound();
      else persistProgress(false);
    }, SLIDE_MS + 80);
  }

  // Reuses shell.js's own .shell-overlay/.shell-overlay__panel classes
  // rather than a separate near-identical copy — same pattern SPOKZ/SLYDZ
  // use for their own reveal confirm dialogs.
  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title reveal-confirm__title"></p>
          <div class="reveal-confirm__body"></div>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="neybuz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="neybuz-reveal-confirm"></button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  const REVEAL_COPY = {
    1: { title: 'Reveal 4 tiles?', body: 'Currently green tiles will never be touched.', confirm: 'Reveal 4' },
    2: { title: 'Reveal 4 more tiles?', body: 'Currently green tiles will never be touched.', confirm: 'Reveal 4 more' },
    3: { title: 'Reveal the full solution?', body: 'Currently green tiles stay in place, but this fills in everything else — there won’t be anything left for you to solve today.', confirm: 'Reveal solution' },
  };

  let pendingRevealTier = null;
  function openRevealConfirm(tier) {
    const copy = REVEAL_COPY[tier];
    $revealConfirm.find('.reveal-confirm__title').text(copy.title);
    $revealConfirm.find('.reveal-confirm__body').text(copy.body);
    $revealConfirm.find('#neybuz-reveal-confirm').text(copy.confirm);
    pendingRevealTier = tier;
    $revealConfirm.removeClass('is-hidden');
  }
  $revealConfirm.find('#neybuz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    pendingRevealTier = null;
  });
  $revealConfirm.find('#neybuz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    if (pendingRevealTier !== null) doReveal(pendingRevealTier);
    pendingRevealTier = null;
  });

  $revealBtn1.on('click', () => { if (!locked && !revealAnimating) openRevealConfirm(1); });
  $revealBtn2.on('click', () => { if (!locked && !revealAnimating) openRevealConfirm(2); });
  $revealBtn3.on('click', () => { if (!locked && !revealAnimating) openRevealConfirm(3); });

  // --- Help toggle/popover ---
  // A fixed, static panel (no per-board computed hint) — same "no live
  // search" choice SPOKZ makes for its own Help. The live solvability pill
  // above the board already answers "can this be solved from here"
  // instantly on every move, so this panel just explains what's on screen.
  // Wrapped together in their own positioned container (rather than the
  // popover being appended to #game-stage on its own) — #game-stage is the
  // nearest `position:relative` ancestor .shell-header has, so a popover
  // positioned absolute/top:100% against IT (not against the button)
  // lands at 100% of the whole stage's height, i.e. off the bottom of the
  // page, not just below the button. .help-wrap being position:relative
  // makes the button the actual positioning reference instead.
  const $helpWrap = $('<span>', { class: 'help-wrap' }).appendTo('.shell-header');

  const $helpToggle = $('<button>', {
    class: 'help-toggle is-hidden',
    type: 'button',
    html: '💡 Help',
    'aria-label': 'Toggle help',
  }).appendTo($helpWrap);

  const $helpPopover = $('<div>', {
    class: 'help-popover is-hidden',
    html: INSTRUCTIONS_HTML,
  }).appendTo($helpWrap);

  function turnOffHelp() {
    $helpToggle.removeClass('is-active');
    $helpPopover.addClass('is-hidden');
  }
  $helpToggle.on('click', (e) => {
    e.stopPropagation();
    const nowOpen = $helpPopover.hasClass('is-hidden');
    if (nowOpen) {
      $helpToggle.addClass('is-active');
      $helpPopover.removeClass('is-hidden');
    } else {
      turnOffHelp();
    }
  });
  $(document).on('click', (e) => {
    if ($helpToggle.is(e.target) || $helpToggle.has(e.target).length) return;
    if ($helpPopover.is(e.target) || $helpPopover.has(e.target).length) return;
    turnOffHelp();
  });
  function showHelpToggle() { $helpToggle.removeClass('is-hidden'); }
  function hideHelpToggle() { $helpToggle.addClass('is-hidden'); turnOffHelp(); }

  // --- Timer ---
  let totalSeconds = 0;
  let timerInterval = null;
  function updateTimerDisplay() { shell.timer.setSeconds(totalSeconds); }
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => { totalSeconds++; updateTimerDisplay(); }, 1000);
  }
  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function clearSelection() {
    if (selectedIndex !== null) $board.children().eq(selectedIndex).removeClass('is-selected');
    selectedIndex = null;
  }

  function persistProgress(completed) {
    saveProgress(GAME_ID, {
      board: board.slice(),
      seconds: totalSeconds,
      revealed,
      reveal1Used,
      reveal2Used,
    }, { completed });
  }

  function finishRound() {
    locked = true;
    stopTimer();
    hideHelpToggle();
    updateRevealButtons();
    persistProgress(true);

    if (revealed) {
      saveTodayOutcome(GAME_ID, {
        revealed: true, usedHelp: false, failed: false, isNewBest: false, isTie: false,
        panelOutcome: 'reveal', panelIsNewBest: false,
      });
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: '🟩🟥 NEYBUZ - did not solve today',
      });
      return;
    }

    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
    const isNewBest = result.isNewBest && result.previousBest !== null && result.previousBest !== 0;
    saveTodayOutcome(GAME_ID, {
      revealed: false, usedHelp: false, failed: false, isNewBest, isTie: result.isTie,
      panelOutcome: undefined, panelIsNewBest: isNewBest,
    });
    shell.showEndScreen({
      scoreText: formatTime(totalSeconds),
      isNewBest,
      shareText: `🟩🟥 NEYBUZ - solved in ${formatTime(totalSeconds)}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Testing shortcut: instantly fills in a valid completion from the
  // current board and ends the round as a real win.
  function solvePuzzle() {
    shell.hideStartBanner();
    const fullAnswer = deriveFullAnswer(board);
    if (fullAnswer) board = fullAnswer;
    render();
    finishRound();
  }

  // Testing shortcut: throws away today's puzzle and generates a fresh one
  // pinned to the given tier (see tierOverride/TIER_SCHEDULE above), so
  // every difficulty is reachable on demand instead of waiting for its
  // scheduled day. Mutates `puzzle` in place (it's declared const, but its
  // own properties aren't) rather than reassigning the binding, and resets
  // every piece of round state the same way a genuine fresh start would.
  function regeneratePuzzle(tier) {
    tierOverride = tier;
    const fresh = generateDailyPuzzle(todayDayOfYear);
    puzzle.tier = fresh.tier;
    puzzle.dist = fresh.dist;
    puzzle.startBoard = fresh.startBoard;
    board = fresh.startBoard.slice();
    document.getElementById('difficultyTier').textContent = puzzle.tier;
    lastMove = null;

    revealed = false;
    reveal1Used = false;
    reveal2Used = false;
    revealAnimating = false;
    totalSeconds = 0;
    updateTimerDisplay();

    locked = false;
    shell.hideStartBanner();
    showHelpToggle();
    clearSelection();
    render();
    stopTimer();
    startTimer();
    persistProgress(false);
  }

  // --- Wiring ---
  // (shell itself was already created earlier, right after buildTiles() —
  // see that call's own comment for why it has to happen before the Help
  // toggle further up, which appends into the DOM chrome it builds.)

  let locked = true;

  initToolsPanel([GAME_ID], {
    extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }],
    radioGroups: [{
      label: 'Difficulty',
      name: 'neybuz-difficulty',
      options: TIER_NAMES.map((tier) => ({ value: tier, label: tier })),
      get: () => puzzle.tier,
      set: (tier) => regeneratePuzzle(tier),
    }],
  });

  enableTileDragSwap({
    container: document.getElementById('board'),
    tileSelector: '.tile',
    isLocked: () => locked || revealAnimating,
    canDrag: () => true,
    canSwap: () => true,
    onSwap: (a, b) => {
      turnOffHelp();
      const ai = Number(a.dataset.index);
      const bi = Number(b.dataset.index);
      lastMove = [ai, bi];
      swap(ai, bi);
      const satisfied = render();
      if (satisfied === TOTAL_TILES) finishRound();
      else persistProgress(false);
    },
  });

  $undoBtn.on('click', undoLastMove);

  // Tap-to-select fallback (in addition to drag) — tap one tile, then
  // another, to swap them, same affordance the standalone prototype had.
  $board.on('click', '.tile', function () {
    if (locked || revealAnimating) return;
    const i = Number($(this).data('index'));
    if (selectedIndex === null) {
      selectedIndex = i;
      $(this).addClass('is-selected');
    } else if (selectedIndex === i) {
      clearSelection();
    } else {
      const a = selectedIndex;
      clearSelection();
      turnOffHelp();
      lastMove = [a, i];
      swap(a, i);
      const satisfied = render();
      if (satisfied === TOTAL_TILES) finishRound();
      else persistProgress(false);
    }
  });

  // Same three-way daily-status branch as SLYDZ/SOLVZ/GLYMPZ.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    board = data.board;
    totalSeconds = data.seconds;
    revealed = data.revealed || false;
    reveal1Used = data.reveal1Used || false;
    reveal2Used = data.reveal2Used || false;
    updateTimerDisplay();
    render();
    if (revealed) {
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: '🟩🟥 NEYBUZ - did not solve today',
      });
    } else {
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🟩🟥 NEYBUZ - solved in ${formatTime(totalSeconds)}`,
      });
    }
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    board = data.board;
    totalSeconds = data.seconds;
    revealed = data.revealed || false;
    reveal1Used = data.reveal1Used || false;
    reveal2Used = data.reveal2Used || false;
    updateTimerDisplay();
    render();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      updateRevealButtons();
      startTimer();
    }, { label: 'Resume' });
  } else {
    render();
    shell.showStartBanner(() => {
      locked = false;
      showHelpToggle();
      totalSeconds = 0;
      updateTimerDisplay();
      updateRevealButtons();
      startTimer();
      persistProgress(false);
    });
  }

  // TEMPORARY — live diagnostic for a solvability-pill discrepancy report;
  // remove once resolved. Dev-mode only.
  if (getToolMode() === 'dev') {
    window.__neybuzDebug = {
      getBoard: () => board.slice(),
      checkNow: () => {
        const good = computeGoodMask(board);
        return {
          board: board.slice(),
          good,
          greenCount: good.filter(Boolean).length,
          checkSolvable: checkSolvable(board, good),
          isSolvableBoard: isSolvableBoard(board),
          deriveFullAnswer: deriveFullAnswer(board),
        };
      },
    };
  }
});
