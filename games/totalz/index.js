// TOTALZ — a daily numbers puzzle (Countdown-numbers-round style). Six
// numbers (2 "large" from 25/50/75/100, 4 "small" from 2-9) and a 3-digit
// target. Build a running total by tapping a number, then an operator, then
// another number, repeated — plus two unary operators (x²/√x) that can
// transform either the running total directly, or the NEXT number about to
// be combined in (armed before tapping it, e.g. "− √25 (5)"). Every day's
// target is constructed (not randomly picked) so it's always reachable, and
// independently verified to genuinely need at least `minRequired` of the 6
// numbers — see tools/totalz-generation/ for how days.json was built.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

const GAME_ID = 'totalz';

// Loaded once, up front, via top-level await (valid inside a <script
// type="module">) — same pattern MOJEEZ/VALUZ use for their own JSON data.
let days = [];
try {
  const res = await fetch(new URL('./days.json', import.meta.url));
  days = await res.json();
} catch (err) {
  console.warn('TOTALZ: failed to load days.json', err);
}

// Real players always get today's actual day-of-year match. A `?day=NNN`
// query param overrides that — dev-only convenience for jumping to any
// authored day regardless of the real date (see MOJEEZ's index.js for the
// same pattern).
const todayDayOfYear = dayOfYear();
const previewDayParam = new URLSearchParams(window.location.search).get('day');
const previewDay = previewDayParam !== null ? Number(previewDayParam) : null;

const activeDayData =
  (previewDay !== null && days.find((d) => d.day === previewDay)) ||
  days.find((d) => d.day === todayDayOfYear) ||
  days[0] ||
  null;

// True whenever what's on screen isn't actually today's real puzzle — in
// that case this run must never touch the real daily-lock/best-score
// storage, same guard MOJEEZ/VALUZ use for their own preview override.
const isPreviewOnly = !activeDayData || activeDayData.day !== todayDayOfYear;

// hidePageLoadingIndicator() runs AFTER the days.json fetch above, not as
// the very first statement — same fix MOJEEZ/VALUZ/WARPZ all needed: calling
// it first only covers the JS module graph finishing, not this game's own
// data fetch, which on a slow/cold connection would tear the spinner down
// right as the real network wait begins.
hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

const OPERATORS = [
  { key: '+', label: '+', kind: 'binary' },
  { key: '-', label: '−', kind: 'binary' },
  { key: '*', label: '×', kind: 'binary' },
  { key: '/', label: '÷', kind: 'binary' },
  { key: 'sq', label: 'x²', kind: 'unary' },
  { key: 'rt', label: '√x', kind: 'unary' },
];

$(function () {

  if (!activeDayData) {
    $('#board').html('<p style="text-align:center; padding: 40px 16px;">No puzzle available today — check back soon.</p>');
    hidePageLoadingIndicator();
    return;
  }

  // --- Pure game-state helpers (state machine only — no DOM here) ---

  let numbers, used, committed, pendingLeft, pendingLeftIdx, pendingOp, pendingTransform;
  let locked = true; // unlocked once Play Now / Resume is pressed
  let revealed = false;
  let totalSeconds = 0;
  let timerInterval = null;

  const target = activeDayData.target;
  const minRequired = activeDayData.minRequired;
  const knownSolutionTrail = activeDayData.trail;

  function resetPuzzleState() {
    numbers = activeDayData.numbers.slice();
    used = numbers.map(() => false);
    committed = [];
    pendingLeft = null;
    pendingLeftIdx = null;
    pendingOp = null;
    pendingTransform = null;
  }
  resetPuzzleState();

  function applyBinary(a, opKey, b) {
    switch (opKey) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
    }
  }

  function binaryValid(a, opKey, b) {
    const r = applyBinary(a, opKey, b);
    if (!Number.isInteger(r) || r <= 0) return false;
    if (opKey === '/' && a % b !== 0) return false;
    return true;
  }

  function opSymbol(opKey) {
    return OPERATORS.find((o) => o.key === opKey).label;
  }

  // Applies a unary transform to a NUMBER (as opposed to the running
  // total) — lets "√25" or "3²" be used as the right-hand operand of a
  // binary step, e.g. "27 − √25 (5) = 22". Returns null if undefined
  // (rooting a non-perfect-square).
  function transformValue(n, transformKey) {
    if (!transformKey) return n;
    if (transformKey === 'sq') return n * n;
    if (transformKey === 'rt') return Number.isInteger(Math.sqrt(n)) ? Math.sqrt(n) : null;
  }

  function operandDisplay(rawNumber, transformKey, effectiveValue) {
    if (!transformKey) return `${rawNumber}`;
    if (transformKey === 'sq') return `${rawNumber}² (${effectiveValue})`;
    return `√${rawNumber} (${effectiveValue})`;
  }

  function currentValue() {
    if (committed.length) return committed[committed.length - 1].resultAfter;
    return pendingLeft;
  }

  function phase() {
    if (pendingOp !== null) return 'need_second';
    if (currentValue() === null) return 'need_first';
    return 'need_operator';
  }

  function anyValidNumberFor(opKey) {
    const base = currentValue();
    return numbers.some((v, i) => !used[i] && binaryValid(base, opKey, v));
  }

  function pickNumber(idx) {
    const value = numbers[idx];
    const ph = phase();
    if (ph === 'need_first') {
      used[idx] = true;
      pendingLeft = value;
      pendingLeftIdx = idx;
    } else if (ph === 'need_second') {
      const effective = transformValue(value, pendingTransform);
      if (effective === null) return;
      const isFirst = committed.length === 0;
      const base = isFirst ? pendingLeft : committed[committed.length - 1].resultAfter;
      if (!binaryValid(base, pendingOp, effective)) return;
      const result = applyBinary(base, pendingOp, effective);
      const operand = operandDisplay(value, pendingTransform, effective);
      const text = isFirst
        ? `${base} ${opSymbol(pendingOp)} ${operand}`
        : `${opSymbol(pendingOp)} ${operand}`;
      used[idx] = true;
      committed.push({ text, resultAfter: result });
      pendingLeft = null;
      pendingLeftIdx = null;
      pendingOp = null;
      pendingTransform = null;
    }
  }

  function pickOperator(opKey, kind) {
    const ph = phase();
    if (kind === 'binary') {
      if (ph !== 'need_operator') return;
      pendingOp = opKey;
      pendingTransform = null;
    } else if (ph === 'need_second') {
      // arm/disarm a transform to apply to the NEXT number picked, rather
      // than to the running total — tapping the same one again disarms it,
      // tapping the other one swaps which transform is armed.
      pendingTransform = pendingTransform === opKey ? null : opKey;
    } else if (ph === 'need_operator') {
      const base = currentValue();
      let result;
      let text;
      const isFirst = committed.length === 0;
      if (opKey === 'sq') {
        result = base * base;
        text = isFirst ? `${base}²` : `²`;
      } else {
        if (!Number.isInteger(Math.sqrt(base))) return;
        result = Math.sqrt(base);
        text = isFirst ? `√${base}` : `√`;
      }
      committed.push({ text, resultAfter: result });
      pendingLeft = null;
      pendingLeftIdx = null;
    }
  }

  // --- Timer ---

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

  function persistProgress(completed) {
    saveProgress(GAME_ID, {
      committed, used, pendingLeft, pendingLeftIdx, pendingOp, pendingTransform,
      seconds: totalSeconds, revealed,
    }, { completed });
  }

  // --- Rendering ---

  function render() {
    $('#totalz-target-value').text(target);
    $('#totalz-min-required').text(`needs ${minRequired}+ numbers`);

    const cur = currentValue();
    const $delta = $('#totalz-delta');
    if (cur === null) {
      $delta.text('').removeClass('is-match');
    } else if (cur === target) {
      $delta.text('MATCH!').addClass('is-match');
    } else {
      $delta.text(`${Math.abs(target - cur)} away`).removeClass('is-match');
    }

    const $ledger = $('#totalz-ledger').empty();
    const hasRows = committed.length > 0 || pendingLeft !== null;
    if (!hasRows) {
      $ledger.html('<div class="totalz-ledger__empty">tap a number to begin</div>');
    } else {
      committed.forEach((line) => {
        const $row = $('<div>', { class: 'totalz-line' + (line.resultAfter === target ? ' is-solved' : '') })
          .html(`<span class="totalz-line__expr">${line.text} =</span><span class="totalz-line__result">${line.resultAfter}</span>`);
        $ledger.append($row);
      });
      if (pendingLeft !== null && !committed.length) {
        $ledger.append(`<div class="totalz-line totalz-line--ghost"><span class="totalz-line__expr">${pendingLeft} …</span><span></span></div>`);
      }
    }
    const lastLine = $ledger.children().last();
    if (lastLine.length) lastLine[0].scrollIntoView({ block: 'nearest' });
    // Reset button pinned to the bottom of the panel, right-aligned to
    // match the result column above it (same row padding as .totalz-line,
    // so its right edge lines up without a hand-picked offset) — only
    // shown once there's actually something to reset, and hidden once the
    // round is over (locked covers both "not started yet" and "already
    // won/revealed", same as the row-tap hint this replaced did).
    if (hasRows && !locked) {
      const $resetRow = $('<div>', { class: 'totalz-ledger__reset-row' });
      $('<button>', { class: 'totalz-ledger__reset-btn', type: 'button', text: 'reset' })
        .on('click', () => {
          resetPuzzleState();
          persistProgress(false);
          render();
        })
        .appendTo($resetRow);
      $ledger.append($resetRow);
    }

    const ph = phase();
    const $prompt = $('#totalz-prompt');
    if (locked) {
      $prompt.text('');
    } else {
      $prompt.html(ph === 'need_first' ? 'tap a <b>number</b> to start'
        : ph === 'need_second'
          ? (pendingTransform
              ? `tap a <b>number</b> to apply ${opSymbol(pendingTransform)}`
              : 'tap a <b>number</b> — or arm <b>√x / x²</b> to transform it first')
          : 'tap an <b>operator</b> to continue');
    }

    const $numberRow = $('#totalz-number-row').empty();
    numbers.forEach((v, i) => {
      let enabled = !locked && (ph === 'need_first' || ph === 'need_second') && !used[i];
      if (enabled && ph === 'need_second') {
        const effective = transformValue(v, pendingTransform);
        enabled = effective !== null && binaryValid(cur, pendingOp, effective);
      }
      const $tile = $('<div>', { class: 'totalz-tile' + (enabled ? '' : ' is-disabled') + (used[i] ? ' is-used' : ''), text: v });
      if (enabled) $tile.on('click', () => { pickNumber(i); afterMove(); });
      $numberRow.append($tile);
    });

    const $operatorRow = $('#totalz-operator-row').empty();
    OPERATORS.forEach((op) => {
      let enabled = !locked && (ph === 'need_operator' || ph === 'need_second');
      let armed = false;
      if (!locked && ph === 'need_operator') {
        if (op.kind === 'binary') enabled = anyValidNumberFor(op.key);
        if (op.key === 'rt') enabled = Number.isInteger(Math.sqrt(cur));
        // repeated squaring blows past Number.MAX_SAFE_INTEGER fast — cap
        // it so results stay exact and displayable.
        if (op.key === 'sq') enabled = cur * cur <= 999999;
      } else if (!locked && ph === 'need_second') {
        if (op.kind === 'binary') enabled = false;
        else {
          armed = pendingTransform === op.key;
          enabled = armed || numbers.some((v, i) => !used[i] && transformValue(v, op.key) !== null && binaryValid(cur, pendingOp, transformValue(v, op.key)));
        }
      }
      const $tile = $('<div>', { class: 'totalz-tile' + (enabled ? '' : ' is-disabled') + (armed ? ' is-armed' : ''), text: op.label });
      if (enabled) $tile.on('click', () => { pickOperator(op.key, op.kind); afterMove(); });
      $operatorRow.append($tile);
    });
  }

  // Runs after every player-initiated move — re-renders, then checks
  // whether that move just hit the target (kept OUT of pickNumber/
  // pickOperator themselves so revealSolution() can replay the same
  // functions without accidentally re-triggering a "win").
  function afterMove() {
    persistProgress(false);
    render();
    if (currentValue() === target) handleWin();
  }

  // --- Shell integration ---

  const shell = initShell({
    gameId: GAME_ID,
    title: 'TOTALZ',
    // Same equals-sign-in-a-circle badge shown on this game's hub tile —
    // see .hub__tile-badge in style.css and games-registry.js's `accent`
    // field (same pattern SOLVZ uses for its own ➕ badge).
    emojiBadge: { glyph: '🟰', accent: '#8ED9A0' },
    accentColor: { bg: '#A9D0F5', ink: '#1D4E78', rim: 'rgba(25, 60, 95, 0.30)' },
    instructions: '<p>Use the six numbers to make the TARGET</p><p>Use any number once</p><p>Use <span class="totalz-instr-ops">+&nbsp;&nbsp;&nbsp;−&nbsp;&nbsp;&nbsp;×&nbsp;&nbsp;&nbsp;÷&nbsp;&nbsp;&nbsp;x²&nbsp;&nbsp;&nbsp;√x</span> <br> as many times as you want</p>',
    formatScore: formatTime,
  });

  // --- Reveal solution (same feature/styling as games/glympz/index.js and
  // games/quadz/index.js — a deliberately understated text-link trigger
  // below the keypad, plus a custom confirm panel reusing shell.js's own
  // overlay/panel classes instead of the browser's native confirm()). ---
  const $revealBtn = $('<button>', {
    class: 'reveal-btn is-hidden',
    type: 'button',
    text: 'Reveal solution',
  }).appendTo('#game-root');

  function showRevealButton() { $revealBtn.removeClass('is-hidden'); }
  function hideRevealButton() { $revealBtn.addClass('is-hidden'); }

  const $revealConfirm = $('<div>', {
    class: 'shell-overlay reveal-confirm is-hidden',
    html: `
      <div class="shell-overlay__panel reveal-confirm__panel">
        <div class="shell-overlay__instructions">
          <p class="shell-end-screen__title">Reveal today's solution?</p>
          <p>You won't be able to complete TOTALZ yourself today.</p>
        </div>
        <div class="reveal-confirm__actions">
          <button class="shell-btn" type="button" id="totalz-reveal-cancel">Cancel</button>
          <button class="shell-btn shell-btn--danger" type="button" id="totalz-reveal-confirm">Reveal Solution</button>
        </div>
      </div>
    `,
  }).appendTo('#game-stage');

  $revealConfirm.find('#totalz-reveal-cancel').on('click', () => {
    $revealConfirm.addClass('is-hidden');
  });
  $revealConfirm.find('#totalz-reveal-confirm').on('click', () => {
    $revealConfirm.addClass('is-hidden');
    revealSolution();
  });
  $revealBtn.on('click', () => {
    if (locked) return;
    $revealConfirm.removeClass('is-hidden');
  });

  // --- Win / reveal endings ---

  function handleWin() {
    locked = true;
    stopTimer();
    hideRevealButton();
    render();
    persistProgress(true);
    const result = submitScore(GAME_ID, totalSeconds, { higherIsBetter: false });
    saveTodayScore(GAME_ID, totalSeconds);
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
      animateTarget: document.getElementById('totalz-ledger'),
      shareText: `🟰 TOTALZ - solved in ${formatTime(totalSeconds)}`,
      celebrate: true,
      score: totalSeconds,
    });
  }

  // Replays the day's known-correct trail through the same pickNumber/
  // pickOperator functions the player uses (guaranteed to land exactly on
  // target, since that trail is exactly how this target was constructed —
  // see totalz-generation's offline generator), so the ledger ends up
  // showing a real, valid solution rather than some separate hardcoded
  // display. Shared by the actual reveal-and-give-up path and the dev
  // "Solve puzzle" shortcut below (which simulates a genuine WIN, not a
  // reveal).
  function replayKnownTrail() {
    resetPuzzleState();
    for (const step of knownSolutionTrail) {
      if (step.type === 'first') {
        pickNumber(numbers.indexOf(step.raw));
        if (step.transform) pickOperator(step.transform, 'unary');
      } else if (step.type === 'binary') {
        pickOperator(step.op, 'binary');
        if (step.transform) pickOperator(step.transform, 'unary');
        pickNumber(numbers.indexOf(step.raw));
      } else if (step.type === 'unary') {
        pickOperator(step.transform, 'unary');
      }
    }
  }

  // Reachable only via the player's own confirmed choice to give up.
  function revealSolution() {
    locked = true;
    stopTimer();
    hideRevealButton();
    revealed = true;
    replayKnownTrail();
    render();
    persistProgress(true);
    // No submitScore() call on this path — giving up never sets a best.
    saveTodayOutcome(GAME_ID, {
      revealed: true, usedHelp: false, failed: false, isNewBest: false, isTie: false,
      panelOutcome: 'reveal', panelIsNewBest: false,
    });
    shell.showEndScreen({
      outcome: 'reveal',
      shareText: '🟰 TOTALZ - did not solve today',
    });
  }

  // Testing shortcut, wired into the dev panel below: instantly plays the
  // known-correct trail and ends the game as a genuine WIN, same as a real
  // solve (unlike revealSolution() above, which ends as a give-up).
  function solvePuzzle() {
    shell.hideStartBanner();
    locked = false;
    replayKnownTrail();
    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }] });

  // Same three-way daily-status branch as every other game — see
  // games/solvz/index.js for the fuller explanation of what each status
  // means, and games/glympz/index.js/games/quadz/index.js for the
  // additional `revealed` sub-branch within 'completed'.
  if (!isPreviewOnly && shell.status.status === 'completed') {
    const { data } = shell.status.record;
    committed = data.committed || [];
    used = data.used || numbers.map(() => false);
    pendingLeft = data.pendingLeft ?? null;
    pendingLeftIdx = data.pendingLeftIdx ?? null;
    pendingOp = data.pendingOp ?? null;
    pendingTransform = data.pendingTransform ?? null;
    totalSeconds = data.seconds || 0;
    revealed = data.revealed || false;
    updateClockDisplay();
    render();
    if (revealed) {
      shell.showEndScreen({
        outcome: 'reveal',
        shareText: '🟰 TOTALZ - did not solve today',
      });
    } else {
      const storedOutcome = getTodayOutcome(GAME_ID);
      shell.showEndScreen({
        scoreText: formatTime(totalSeconds),
        isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
        shareText: `🟰 TOTALZ - solved in ${formatTime(totalSeconds)}`,
      });
    }
  } else if (!isPreviewOnly && shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    committed = data.committed || [];
    used = data.used || numbers.map(() => false);
    pendingLeft = data.pendingLeft ?? null;
    pendingLeftIdx = data.pendingLeftIdx ?? null;
    pendingOp = data.pendingOp ?? null;
    pendingTransform = data.pendingTransform ?? null;
    totalSeconds = data.seconds || 0;
    updateClockDisplay();
    render();
    shell.showStartBanner(() => {
      locked = false;
      showRevealButton();
      startTimer();
      render();
    }, { label: 'Resume' });
  } else {
    render();
    shell.showStartBanner(() => {
      locked = false;
      showRevealButton();
      totalSeconds = 0;
      updateClockDisplay();
      startTimer();
      persistProgress(false);
      render();
    });
  }

});
