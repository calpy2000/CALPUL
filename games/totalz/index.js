// TOTALZ — a daily numbers puzzle. Six numbers (2 "large" from 25/50/75/100,
// 4 "small" from 2-9) and a 3-digit target. Type a bracketed expression
// using the six numbers (real operator precedence — × ÷ bind tighter than
// + −, explicit ( ) grouping) and press Enter to fold it into the running
// total, repeated until the total hits the target. Every day's target is
// constructed (not randomly picked) so it's always reachable, and
// independently verified to genuinely need at least `minRequired` of the 6
// numbers — see tools/totalz-generation/ for how days.json was built.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';
import { requireStandalone } from '../../shared/core/install-gate.js';

await requireStandalone();

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

  let numbers;
  let brUsed, brWorkingValue, brStream, brLedger, brPendingTransform;
  let locked = true; // unlocked once Play Now / Resume is pressed
  let revealed = false;
  let totalSeconds = 0;
  let timerInterval = null;

  const target = activeDayData.target;
  const minRequired = activeDayData.minRequired;
  const knownSolutionTrail = activeDayData.trail;

  $('#board').addClass('totalz-board--brackets');

  function resetPuzzleState() {
    numbers = activeDayData.numbers.slice();
    brUsed = numbers.map(() => false);
    brWorkingValue = null;
    brStream = [];
    brLedger = [];
    brPendingTransform = null;
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
  // total) — lets "√25" or "3²" be used as an operand within the typed
  // expression, e.g. "27 − √25". Returns null if undefined (rooting a
  // non-perfect-square).
  function transformValue(n, transformKey) {
    if (!transformKey) return n;
    if (transformKey === 'sq') return n * n;
    if (transformKey === 'rt') return Number.isInteger(Math.sqrt(n)) ? Math.sqrt(n) : null;
  }

  function currentValue() {
    return brWorkingValue;
  }

  // --- Bracket input model ---
  //
  // Everything typed since the last Enter is treated as ONE continuous
  // expression — parsed with real operator precedence (× ÷ bind tighter
  // than + −) and explicit brackets, not left-to-right reduction. Enter
  // re-parses the whole thing (the prior running total, brWorkingValue,
  // prepended as if it were the first token) and, if it parses cleanly
  // end-to-end, collapses it into the new running total and starts a fresh
  // stream. Uses applyBinary/binaryValid above — every intermediate value
  // must stay a positive integer, division exact, at every level including
  // inside brackets.
  //
  // Every brDoX() function below is a RAW mutator with no side effects (no
  // persist/render/win-check) — replayKnownTrailBrackets() (used by both
  // the reveal and dev "Solve puzzle" paths) needs to drive these directly
  // without accidentally triggering a live win/persist mid-replay. Real
  // taps call the matching brDoX() then afterMove() themselves (see
  // renderBrackets() below).

  function brParseFactor(toks, pos) {
    const t = toks[pos];
    if (!t) return null;
    if (t.t === 'num') return { value: t.value, pos: pos + 1 };
    if (t.t === 'lp') {
      const inner = brParseExpr(toks, pos + 1);
      if (!inner) return null;
      const close = toks[inner.pos];
      if (!close || close.t !== 'rp') return null;
      let value = inner.value;
      // A transform tapped on a completed "(...)" group lives on its
      // closing-paren token (see brDoTapTransform) — applied here to the
      // group's own computed value, same as a bare number's transform is
      // applied to its raw value. Null (e.g. rooting a non-perfect-square
      // group result) fails this parse, same as any other invalid step —
      // in practice the button that would produce this is greyed out
      // before it can be tapped, so this is a safety net, not the path.
      if (close.transform) {
        const tv = transformValue(value, close.transform);
        if (tv === null) return null;
        value = tv;
      }
      return { value, pos: inner.pos + 1 };
    }
    return null;
  }

  function brParseTerm(toks, pos) {
    const left = brParseFactor(toks, pos);
    if (!left) return null;
    let val = left.value;
    let p = left.pos;
    while (toks[p] && toks[p].t === 'op' && (toks[p].k === '*' || toks[p].k === '/')) {
      const opk = toks[p].k;
      const right = brParseFactor(toks, p + 1);
      if (!right) return null;
      if (!binaryValid(val, opk, right.value)) return null;
      val = applyBinary(val, opk, right.value);
      p = right.pos;
    }
    return { value: val, pos: p };
  }

  function brParseExpr(toks, pos) {
    const left = brParseTerm(toks, pos);
    if (!left) return null;
    let val = left.value;
    let p = left.pos;
    while (toks[p] && toks[p].t === 'op' && (toks[p].k === '+' || toks[p].k === '-')) {
      const opk = toks[p].k;
      const right = brParseTerm(toks, p + 1);
      if (!right) return null;
      if (!binaryValid(val, opk, right.value)) return null;
      val = applyBinary(val, opk, right.value);
      p = right.pos;
    }
    return { value: val, pos: p };
  }

  function brVirtualStream() {
    if (brWorkingValue !== null) return [{ t: 'num', value: brWorkingValue }, ...brStream];
    return brStream;
  }

  // Full-stream validity check backing Enter's disabled state: must have
  // typed something new since the last collapse, AND that plus whatever's
  // already banked must parse as one complete expression (balanced
  // brackets, no dangling operator) with no leftover tokens.
  function brTryParseFull() {
    if (brStream.length === 0) return null;
    const toks = brVirtualStream();
    const r = brParseExpr(toks, 0);
    return r && r.pos === toks.length ? r.value : null;
  }

  function brRenderTokenText(tok) {
    if (tok.t === 'op') return opSymbol(tok.k);
    if (tok.t === 'lp') return '(';
    // A group's own √ transform is rendered as a prefix on its matching
    // "(" instead (standard notation: "√(4 + 5)", not "(4 + 5)√") — see
    // brRenderStreamText's prefix pass below. x² stays a suffix here since
    // "(5 + 2)²" already reads naturally left-to-right.
    if (tok.t === 'rp') return tok.transform === 'sq' ? ')²' : ')';
    if (tok.transform === 'sq') return `${tok.raw}²`;
    if (tok.transform === 'rt') return `√${tok.raw}`;
    return `${tok.raw}`;
  }

  // Two passes: first find every "(" whose matching ")" carries a root
  // transform (so it can be prefixed with √), then render token-by-token.
  // Matching is done with a simple depth counter, same idea as
  // trailingGroupOpenIndex() below but over the whole stream instead of
  // just from the end.
  function brRenderStreamText(toks) {
    const rootPrefixLp = new Set();
    const openStack = [];
    toks.forEach((tok, i) => {
      if (tok.t === 'lp') openStack.push(i);
      else if (tok.t === 'rp') {
        const openIdx = openStack.pop();
        if (tok.transform === 'rt' && openIdx !== undefined) rootPrefixLp.add(openIdx);
      }
    });
    return toks
      .map((tok, i) => (rootPrefixLp.has(i) ? `√${brRenderTokenText(tok)}` : brRenderTokenText(tok)))
      .join(' ');
  }

  function brDoTapNumber(idx) {
    if (brUsed[idx]) return;
    const raw = numbers[idx];
    let value = raw;
    let transform = null;
    if (brPendingTransform) {
      const tv = transformValue(raw, brPendingTransform);
      if (tv !== null) { value = tv; transform = brPendingTransform; }
    }
    brStream.push({ t: 'num', raw, transform, value, poolIdx: idx });
    brUsed[idx] = true;
    brPendingTransform = null;
  }

  function brDoTapOp(k) {
    brStream.push({ t: 'op', k });
  }

  function brDoTapParen(which) {
    if (which === '(') {
      // A transform armed BEFORE this "(" is tapped must apply to the
      // WHOLE group once it closes, not get grabbed by the first number
      // typed inside it (e.g. "[x²] ( 5 + 2 )" should square the 7, not
      // just the 5) — captured here on the lp token and cleared out of
      // brPendingTransform so brDoTapNumber() can't consume it early.
      brStream.push({ t: 'lp', pendingTransform: brPendingTransform });
      brPendingTransform = null;
      return;
    }
    // rp carries an explicit transform field (null, not just absent) since
    // a completed group can have a transform applied post-hoc, same as a
    // number token — see brApplyTransformToTrailingGroup().
    const rp = { t: 'rp', transform: null };
    brStream.push(rp);
    // If the "(" this closes had a transform armed before it was opened,
    // apply it now that the group's value is actually known — reuses the
    // exact same post-hoc application (and its silent-no-op-on-invalid-
    // root behavior) as tapping a transform after an already-closed group.
    const openIdx = trailingGroupOpenIndex();
    if (openIdx !== null) {
      const lp = brStream[openIdx];
      if (lp.pendingTransform) {
        brApplyTransformToTrailingGroup(rp, lp.pendingTransform);
        lp.pendingTransform = null;
      }
    }
  }

  // The pending transform captured on the innermost currently-open "("
  // (if any) — read-only lookup used only so the operator row's own
  // armed-highlight keeps glowing while the player is still typing inside
  // a bracket whose closing transform is already decided. brDoTapParen()
  // is what actually reads/clears the real thing when "(" / ")" are tapped.
  function innermostOpenPendingTransform() {
    const openStack = [];
    for (const tok of brStream) {
      if (tok.t === 'lp') openStack.push(tok);
      else if (tok.t === 'rp') openStack.pop();
    }
    return openStack.length > 0 ? openStack[openStack.length - 1].pendingTransform : null;
  }

  // Index of the "(" matching the trailing ")" in brStream, walking
  // backward with a paren-depth counter. Returns null if the stream
  // doesn't currently end on a completed group.
  function trailingGroupOpenIndex() {
    const closeIdx = brStream.length - 1;
    if (closeIdx < 0 || brStream[closeIdx].t !== 'rp') return null;
    let depth = 0;
    for (let i = closeIdx; i >= 0; i--) {
      if (brStream[i].t === 'rp') depth++;
      else if (brStream[i].t === 'lp') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return null;
  }

  // The trailing group's own computed value, ignoring whatever transform
  // is (or isn't) already sitting on its closing paren — used both to
  // validate a new transform tap and to decide whether √x should be
  // greyed out for this group. Parses brStream directly (not the virtual
  // stream with brWorkingValue prepended) since a "(...)" is always typed
  // fresh within the current turn. Returns null if the group somehow
  // isn't cleanly parseable (shouldn't happen for a genuinely completed
  // group, but keeps this a safe no-op rather than a crash if it ever is).
  function trailingGroupRawValue() {
    const openIdx = trailingGroupOpenIndex();
    if (openIdx === null) return null;
    const closeIdx = brStream.length - 1;
    const inner = brParseExpr(brStream, openIdx + 1);
    return inner && inner.pos === closeIdx ? inner.value : null;
  }

  // If the stream's last token is a plain number, tapping a transform
  // applies retroactively to THAT number instead of arming for the next
  // one — lets "5 then x²" match "x² then 5" (testers found the
  // before-only order confusing). Toggles/swaps in place, same rules as
  // the arm path below: same key tapped again reverts to the raw value,
  // the other key swaps which transform is applied. transformValue() is
  // always computed off .raw (not .value), so swapping never compounds.
  function brApplyTransformToTrailingNumber(tok, key) {
    if (tok.transform === key) {
      tok.transform = null;
      tok.value = tok.raw;
      return true;
    }
    const tv = transformValue(tok.raw, key);
    if (tv === null) return true; // e.g. rooting a non-perfect square — silent no-op, same as the arm-then-tap path
    tok.transform = key;
    tok.value = tv;
    return true;
  }

  // Same idea as brApplyTransformToTrailingNumber() but for a completed
  // "(...)" group — the transform lives on the closing-paren token and is
  // applied to the group's own computed value (via trailingGroupRawValue),
  // never to a value that already has some other transform baked in, so
  // swapping sq<->rt never compounds.
  function brApplyTransformToTrailingGroup(tok, key) {
    if (tok.transform === key) {
      tok.transform = null;
      return true;
    }
    const rawValue = trailingGroupRawValue();
    if (rawValue === null) return true; // not cleanly parseable — bail as a no-op
    const tv = transformValue(rawValue, key);
    if (tv === null) return true; // e.g. rooting a group whose value isn't a perfect square — silent no-op
    tok.transform = key;
    return true;
  }

  function brDoTapTransform(key) {
    const trailing = brStream[brStream.length - 1];
    if (trailing && trailing.t === 'num') {
      brApplyTransformToTrailingNumber(trailing, key);
      return;
    }
    if (trailing && trailing.t === 'rp') {
      brApplyTransformToTrailingGroup(trailing, key);
      return;
    }
    // No number or completed group to apply to yet — arms/disarms a
    // transform for the NEXT number OR "(" tapped instead. Tapping the
    // same one again disarms it, tapping the other swaps which is armed.
    // Persists across other taps (an operator in between doesn't clear
    // it) until consumed — either immediately by a number (brDoTapNumber)
    // or deferred onto a "(" to be applied to the whole group once it
    // closes (brDoTapParen(), see its own comment).
    brPendingTransform = brPendingTransform === key ? null : key;
  }

  function brDoTapBackspace() {
    if (brStream.length === 0) return;
    const popped = brStream.pop();
    if (popped.t === 'num') brUsed[popped.poolIdx] = false;
  }

  function brDoTapEnter() {
    const result = brTryParseFull();
    if (result === null) return;
    const text = brRenderStreamText(brStream);
    brLedger.push({ text, result });
    brWorkingValue = result;
    brStream = [];
  }

  function brDoReset() {
    brUsed = numbers.map(() => false);
    brWorkingValue = null;
    brStream = [];
    brLedger = [];
    brPendingTransform = null;
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
      mode: 'brackets',
      brUsed, brWorkingValue, brStream, brLedger, brPendingTransform,
      seconds: totalSeconds, revealed,
    }, { completed });
  }

  // --- Rendering ---

  function render() {
    renderBrackets();
  }

  // Same target card / ledger / prompt / keypad DOM ids every other game
  // convention uses — the ledger shows the in-progress expression as its
  // own last row (not a separate line), the operator row has nine keys
  // (+ − × ÷ x² √x ( ) plus a real Enter button, three tints so the
  // arithmetic/transform/bracket groups read apart — see
  // .totalz-board--brackets in style.css), and nothing is disabled while
  // playing except an already-used number and Enter itself, which only
  // enables once brTryParseFull() says the typed expression is complete
  // and valid.
  function renderBrackets() {
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

    const parsed = brTryParseFull();
    const hasRows = brLedger.length > 0 || brStream.length > 0;

    const $ledger = $('#totalz-ledger').empty();
    if (!hasRows) {
      $ledger.html('<div class="totalz-ledger__empty">tap a number to begin</div>');
    } else {
      brLedger.forEach((line) => {
        const $row = $('<div>', { class: 'totalz-line' + (line.result === target ? ' is-solved' : '') })
          .html(`<span class="totalz-line__expr">${line.text} =</span><span class="totalz-line__result">${line.result}</span>`);
        $ledger.append($row);
      });

      if (brStream.length > 0 && !locked) {
        const $ghost = $('<div>', { class: 'totalz-line totalz-line--ghost' });
        $('<span>', { class: 'totalz-line__expr' }).text(brRenderStreamText(brStream) + ' ').append('<span class="totalz-caret"></span>').appendTo($ghost);
        $('<button>', { class: 'totalz-line__del', type: 'button', text: '‹ del' })
          .on('click', () => { brDoTapBackspace(); afterMove(); })
          .appendTo($ghost);
        $ledger.append($ghost);
      }

      if (hasRows && !locked) {
        const $resetRow = $('<div>', { class: 'totalz-ledger__reset-row' });
        $('<button>', { class: 'totalz-ledger__reset-btn', type: 'button', text: 'reset' })
          .on('click', () => { brDoReset(); persistProgress(false); render(); })
          .appendTo($resetRow);
        $ledger.append($resetRow);
      }
    }
    const lastLine = $ledger.children().last();
    if (lastLine.length) lastLine[0].scrollIntoView({ block: 'nearest' });

    const $prompt = $('#totalz-prompt');
    if (locked) {
      $prompt.text('');
    } else if (brStream.length === 0) {
      $prompt.html(brWorkingValue === null ? 'tap a <b>number</b> to start' : 'tap an <b>operator</b> or <b>number</b> to continue');
    } else if (parsed !== null) {
      $prompt.html('valid — press <b>Enter</b> to fold it in');
    } else {
      $prompt.text('keep building…');
    }

    const $numberRow = $('#totalz-number-row').empty();
    numbers.forEach((v, i) => {
      // While √x is armed for the NEXT number (not deferred onto an open
      // "(" — see brDoTapParen()), a number without an integer root can't
      // produce a valid tap here at all — grey it out instead of letting
      // the tap silently fall through untransformed.
      const rootArmBlocked = brPendingTransform === 'rt' && transformValue(v, 'rt') === null;
      const enabled = !locked && !brUsed[i] && !rootArmBlocked;
      const $tile = $('<div>', { class: 'totalz-tile' + (enabled ? '' : ' is-disabled') + (brUsed[i] ? ' is-used' : ''), text: v });
      if (enabled) $tile.on('click', () => { brDoTapNumber(i); afterMove(); });
      $numberRow.append($tile);
    });

    const $operatorRow = $('#totalz-operator-row').empty();
    const BRACKET_KEYS = [
      { key: '+', label: '+', group: 'main', kind: 'op' },
      { key: '-', label: '−', group: 'main', kind: 'op' },
      { key: '*', label: '×', group: 'main', kind: 'op' },
      { key: '/', label: '÷', group: 'main', kind: 'op' },
      { key: 'sq', label: 'x²', group: 'transform', kind: 'transform' },
      { key: 'rt', label: '√x', group: 'transform', kind: 'transform' },
      { key: '(', label: '(', group: 'bracket', kind: 'paren' },
      { key: ')', label: ')', group: 'bracket', kind: 'paren' },
    ];
    // Trailing number or completed group in the stream (if any) — needed
    // so x²/√x can show their state relative to what was just tapped,
    // not just a pending arm for the next number. See brDoTapTransform()'s
    // comment for why groups only ever get the post-hoc path.
    const trailingTok = brStream[brStream.length - 1];
    const trailingIsNum = !!trailingTok && trailingTok.t === 'num';
    const trailingIsGroup = !!trailingTok && trailingTok.t === 'rp';
    // Only actually computed (via a small re-parse) when a group is
    // trailing — trailingGroupRawValue() is cheap but there's no reason to
    // run it on every render when it isn't needed.
    const trailingGroupRaw = trailingIsGroup ? trailingGroupRawValue() : null;
    BRACKET_KEYS.forEach((def) => {
      const armed = def.kind === 'transform' && (
        brPendingTransform === def.key ||
        (trailingIsNum && trailingTok.transform === def.key) ||
        (trailingIsGroup && trailingTok.transform === def.key) ||
        innermostOpenPendingTransform() === def.key
      );
      // √x specifically can't apply to a trailing number/group that isn't
      // a perfect square — greyed out rather than a silent no-op tap, so
      // testers can see up front it doesn't apply here (the "before-only"
      // ordering bug report was exactly this kind of invisible failure).
      // Root arming for a NOT-YET-tapped number is left alone — which
      // number comes next isn't known yet, so there's nothing to block.
      const rootBlocked = def.key === 'rt' && (
        (trailingIsNum && trailingTok.transform !== 'rt' && transformValue(trailingTok.raw, 'rt') === null) ||
        (trailingIsGroup && trailingTok.transform !== 'rt' && (trailingGroupRaw === null || transformValue(trailingGroupRaw, 'rt') === null))
      );
      const disabled = locked || rootBlocked;
      const $tile = $('<div>', {
        class: `totalz-tile totalz-tile--op-${def.group}` + (disabled ? ' is-disabled' : '') + (armed ? ' is-armed' : ''),
        text: def.label,
      });
      if (!disabled) {
        $tile.on('click', () => {
          if (def.kind === 'op') brDoTapOp(def.key);
          else if (def.kind === 'transform') brDoTapTransform(def.key);
          else brDoTapParen(def.key);
          afterMove();
        });
      }
      $operatorRow.append($tile);
    });

    const enterReady = parsed !== null && !locked;
    const $enterBtn = $('<button>', {
      class: 'totalz-tile totalz-enter-btn' + (enterReady ? ' is-ready' : ''),
      type: 'button',
      text: 'Enter',
    });
    $enterBtn.prop('disabled', !enterReady);
    if (enterReady) $enterBtn.on('click', () => { brDoTapEnter(); afterMove(); });
    $operatorRow.append($enterBtn);
  }

  // Runs after every player-initiated move — re-renders, then checks
  // whether that move just hit the target (kept OUT of the brDoX()
  // mutators themselves so revealSolution() can replay the same functions
  // without accidentally re-triggering a "win").
  function afterMove() {
    persistProgress(false);
    render();
    if (currentValue() === target) handleWin();
  }

  // --- Shell integration ---

  const instructions =
    '<p>Use the six numbers to make the TARGET</p>' +
    '<p>Use any number once</p>' +
    '<p>Type a calculation with <span class="totalz-instr-ops">+&nbsp;&nbsp;−&nbsp;&nbsp;×&nbsp;&nbsp;÷&nbsp;&nbsp;x²&nbsp;&nbsp;√x&nbsp;&nbsp;(&nbsp;&nbsp;)</span></p>' +
    '<p>Tap <strong>Enter</strong> to lock it in, then keep building until you hit the TARGET</p>';

  const shell = initShell({
    gameId: GAME_ID,
    title: 'TOTALZ',
    // Same equals-sign-in-a-circle badge shown on this game's hub tile —
    // see .hub__tile-badge in style.css and games-registry.js's `accent`
    // field (same pattern SOLVZ uses for its own ➕ badge).
    emojiBadge: { glyph: '🟰', accent: '#8ED9A0' },
    accentColor: { bg: '#A9D0F5', ink: '#1D4E78', rim: 'rgba(25, 60, 95, 0.30)' },
    instructions,
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

  // Replays the day's known-correct trail through the same brDoX() mutators
  // the player uses (guaranteed to land exactly on target, since that
  // trail is exactly how this target was constructed — see
  // totalz-generation's offline generator), so the ledger ends up showing a
  // real, valid solution rather than some separate hardcoded display.
  // Shared by the actual reveal-and-give-up path and the dev "Solve
  // puzzle" shortcut below (which simulates a genuine WIN, not a reveal).
  // A 'first' step's optional transform is armed via brDoTapTransform()
  // BEFORE the number, and every step ends with brDoTapEnter() so the
  // ledger comes out with one row per step. No authored day currently
  // produces a standalone 'unary' step (a transform with no accompanying
  // number) — the arm-then-tap-a-number model has no way to apply a
  // transform directly to the running total, so that step type is just
  // skipped here rather than crashing if one ever shows up.
  function replayKnownTrailBrackets() {
    brDoReset();
    for (const step of knownSolutionTrail) {
      if (step.type === 'first') {
        if (step.transform) brDoTapTransform(step.transform);
        brDoTapNumber(numbers.indexOf(step.raw));
      } else if (step.type === 'binary') {
        brDoTapOp(step.op);
        if (step.transform) brDoTapTransform(step.transform);
        brDoTapNumber(numbers.indexOf(step.raw));
      } else if (step.type === 'unary') {
        continue;
      }
      brDoTapEnter();
    }
  }

  // Reachable only via the player's own confirmed choice to give up.
  function revealSolution() {
    locked = true;
    stopTimer();
    hideRevealButton();
    revealed = true;
    replayKnownTrailBrackets();
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
    replayKnownTrailBrackets();
    handleWin();
  }

  initToolsPanel([GAME_ID], {
    extraActions: [{ label: 'Solve puzzle', onClick: solvePuzzle }],
  });

  // Same three-way daily-status branch as every other game — see
  // games/solvz/index.js for the fuller explanation of what each status
  // means, and games/glympz/index.js/games/quadz/index.js for the
  // additional `revealed` sub-branch within 'completed'.
  //
  // canResume also checks the saved record's own `mode` field is
  // 'brackets' — a leftover safety net from when this game briefly had two
  // input models (classic was removed entirely; see
  // [[project_totalz_bracket_input_mode]] in project memory for that
  // history and how to recover the old code if it's ever wanted back). Any
  // save from before that removal has no `mode` field (or `'classic'`),
  // which fails this check and falls straight through to the fresh-start
  // branch instead of trying to restore a shape this file no longer
  // understands.
  const savedMode = (shell.status.record && shell.status.record.data && shell.status.record.data.mode) || 'classic';
  const canResume = !isPreviewOnly && savedMode === 'brackets';

  function restoreBracketFields(data) {
    brUsed = data.brUsed || numbers.map(() => false);
    brWorkingValue = data.brWorkingValue ?? null;
    brStream = data.brStream || [];
    brLedger = data.brLedger || [];
    brPendingTransform = data.brPendingTransform ?? null;
  }

  if (canResume && shell.status.status === 'completed') {
    const { data } = shell.status.record;
    restoreBracketFields(data);
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
  } else if (canResume && shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    restoreBracketFields(data);
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
