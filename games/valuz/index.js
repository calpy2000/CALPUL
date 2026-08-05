// VALUZ — a daily 6-question trivia set where the correct answers are shown
// shuffled in a tray; drag each one onto its matching question, then Guess
// to see which ones you got right. Modeled on SOLVZ's fixed-position,
// content-swap drag pattern (tiles never move in the DOM — dragging swaps
// what's INSIDE two tiles), extended to a 5-column board (question / spacer
// / drop-zone / spacer / answer-tray) instead of SOLVZ's single equation
// grid, and to a one-shot "Guess" reveal instead of SOLVZ's continuous
// auto-checking.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore } from '../../shared/core/game-storage.js';
import { enableTileDragSwap } from '../../shared/input/dom-tile-drag.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam, navigateWithSpinner } from '../../shared/core/loading-indicator.js';
import { getQuestionTileIconDataURL } from './tile-icon.js';

const GAME_ID = 'valuz';

// Colour-type answers have no text of their own — the tile IS the answer,
// shown as a flat fill. Fixed to the 8 named colours the spec allows.
const COLOUR_HEX = {
  red: '#E53E3E',
  yellow: '#ECC94B',
  blue: '#3182CE',
  green: '#38A169',
  orange: '#DD6B20',
  pink: '#D53F8C',
  purple: '#805AD5',
  black: '#1A202C',
};

// Loaded once, up front, via top-level await (valid inside a <script
// type="module">) — same pattern WARPZ uses for sequences.json. `days` is
// an array of { day, category, tagline, type, questions: [...] } — see
// days.json itself for the real data and games/valuz's spec conversation
// for the schema's origin.
let days = [];
try {
  const res = await fetch(new URL('./days.json', import.meta.url));
  days = await res.json();
} catch (err) {
  console.warn('VALUZ: failed to load days.json', err);
}

// hidePageLoadingIndicator() runs AFTER the days.json fetch above, NOT as
// the first statement (the usual convention — see loading-indicator.js's
// own comment on why "first statement" is normally correct). A real bug,
// found via a user report of "long wait with no spinner": calling it
// first only accounts for the JS module graph finishing, not this game's
// OWN data fetch — on a slow/cold-cache connection, the spinner was being
// torn down right as the actual network wait began, leaving a real gap
// with nothing on screen. loading-indicator.js's own rule is that a fetch
// which ISN'T guaranteed-fast must either finish before this call or wrap
// itself in a fresh showPageLoadingIndicator() — moving this call down
// here is the simpler of those two options. WARPZ had the identical bug
// (this ordering was originally copied FROM WARPZ's sequences.json
// fetch) — fixed there the same way, same commit.
hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

// --- Which day's content to show ---
// Real players always get today's actual day-of-year match. A `?day=NNN`
// query param overrides that — used ONLY by this game's own dev-panel
// "Preview day" buttons (below), so whoever's building/testing VALUZ can
// jump straight to any authored day regardless of the real date, since
// content is still sparse (a handful of days out of 366) during this
// build-out phase, same situation MUVEEZ's image curation was in early on.
const todayDayOfYear = dayOfYear();
const previewDayParam = new URLSearchParams(window.location.search).get('day');
const previewDay = previewDayParam !== null ? Number(previewDayParam) : null;

const activeDayData =
  (previewDay !== null && days.find((d) => d.day === previewDay)) ||
  days.find((d) => d.day === todayDayOfYear) ||
  days[0] ||
  null;

// True whenever what's on screen ISN'T actually today's real puzzle (either
// an explicit ?day= preview, or today simply has no authored content yet
// and we fell back to days[0]) — in either case this run must never touch
// the real daily-lock/best-score storage, or a dev preview would corrupt
// tomorrow's "already played today" state or stomp a real best score with
// whatever content happened to be loaded during testing.
const isPreview = !activeDayData || activeDayData.day !== todayDayOfYear;

if (!activeDayData) {
  console.error('VALUZ: no day data available — days.json may have failed to load or is empty.');
}

$(function () {
  if (!activeDayData) {
    // Nothing to build a board out of — bail out to a plain message rather
    // than throwing partway through DOM construction below.
    document.getElementById('board').innerHTML = '<p style="text-align:center">VALUZ has no puzzle data available right now.</p>';
    return;
  }

  const QUESTIONS = activeDayData.questions; // [{ number, question, answer, more }, ...], 6 entries
  const ANSWER_TYPE = activeDayData.type; // 'number' | 'letter' | 'emoji' | 'colour'

  // --- Deterministic daily shuffle ---
  // Same "looks random but reproducible" trick SOLVZ uses for its own daily
  // puzzle generation (see that file's own comment on seededPseudoRandom) —
  // seeded off this SPECIFIC day's number, so every player sees the same
  // starting tray order for a given day, Wordle-style, rather than a fresh
  // shuffle per page load.
  function seededPseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }
  function seededShuffle(array, seed) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(seededPseudoRandom(seed + i) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  const SHUFFLED_ANSWERS = seededShuffle(QUESTIONS.map((q) => q.answer), activeDayData.day * 997);

  // --- Reading/writing a slot tile's value ---
  // Every column-3 (drop) and column-5 (tray) tile keeps its CURRENT value
  // in a data-value attribute — the single source of truth read by grading,
  // persistence, and drag-swap alike. Number/letter/emoji types render that
  // value as plain text; colour type has no text at all, just a flat fill
  // (recoloring would erase the answer, which is why it needs the separate
  // check/cross overlay added at grading time instead).
  function renderSlotValue(tileEl, value) {
    tileEl.dataset.value = value || '';
    tileEl.classList.toggle('is-empty', !value);
    if (ANSWER_TYPE === 'colour') {
      tileEl.style.backgroundColor = value ? COLOUR_HEX[value] : '';
      tileEl.textContent = '';
    } else {
      tileEl.style.backgroundColor = '';
      tileEl.textContent = value || '';
    }
  }

  function dropTileFor(questionNumber) {
    return document.querySelector(`.valuz-tile--drop[data-question-number="${questionNumber}"]`);
  }
  function trayTileFor(questionNumber) {
    return document.querySelector(`.valuz-tile--tray[data-question-number="${questionNumber}"]`);
  }

  // --- Building the board ---
  // A single 5-column CSS grid (question / spacer / drop / spacer / tray),
  // one row per question, PLUS one extra row at the very END (after all 6
  // questions) reserved for the "correct answers" label, column 5 only.
  // This label's position has moved twice now: it started as its own row
  // ABOVE column 5 (inside the grid), then moved to share a row with the
  // Guess button below the grid — but that put it out of horizontal line
  // with column 5's own tiles, and the user wanted it back directly under
  // the LAST question row's column-5 tile instead, so it's back inside the
  // grid, just at the bottom instead of the top. Every tile is explicitly
  // placed via inline grid-row/grid-column rather than relying on DOM
  // order (SOLVZ's approach) — simpler here since columns 2/4 need no
  // elements at all (they're pure grid gutter space, not tiles), so
  // relying on implicit row-major placement would require filler divs.
  // Category + tagline for the active day — shown once, above the grid, as
  // ONE centered line ("Movies: match the number with the film") with just
  // the category+colon bold, not two separate lines — per explicit request
  // to reclaim vertical space. Tagline text itself was shortened to fit
  // this single-line combined form (see days.json).
  $('#dayHeader').html(
    `<p class="valuz-day-line"><strong>${activeDayData.category}:</strong> ${activeDayData.tagline}</p>`
  );

  const $grid = $('#valuzGrid');
  const LABEL_ROW = QUESTIONS.length + 1; // directly below the last question row
  const $col5Label = $('<div>', { class: 'valuz-col5-label', id: 'col5Label' }).css({ gridRow: LABEL_ROW, gridColumn: 5 });
  $grid.append($col5Label);

  QUESTIONS.forEach((q, i) => {
    const row = i + 1;

    // Plain bold number (not a circular badge) — column 1 is narrow enough
    // that the badge's own padding/diameter was eating space the question
    // text needed, per the user's explicit follow-up feedback.
    //
    // valuz-tile__taphint ("tap") sits in the bottom-right corner, hidden
    // by CSS until the tile gets .is-clickable (see markQuestionsClickable()
    // below) — a small nudge that the question can be tapped for more info
    // once the round is graded. Bottom-right chosen deliberately: with the
    // question number pinned top-left and text flowing left-to-right, that
    // corner is the one LEAST likely to already have text sitting under it
    // on a given tile, explicit reasoning from the user's own request.
    $('<div>', { class: 'valuz-tile valuz-tile--question', 'data-question-number': q.number })
      .css({ gridRow: row, gridColumn: 1 })
      .html(
        `<span class="valuz-tile__qnum">${q.number}</span><span class="valuz-tile__qtext">${q.question}</span><span class="valuz-tile__taphint">tap</span>`
      )
      .appendTo($grid);

    // Emoji type gets an extra modifier class (see .valuz-tile--type-emoji
    // in style.css) — bigger glyph, white fill + thin border instead of
    // the flat teal every other type uses, per explicit request: small
    // emoji on a saturated teal background were hard to make out.
    const typeClass = ANSWER_TYPE === 'emoji' ? ' valuz-tile--type-emoji' : '';

    const $drop = $('<div>', { class: `valuz-tile valuz-tile--slot valuz-tile--drop${typeClass}`, 'data-question-number': q.number })
      .css({ gridRow: row, gridColumn: 3 })
      .appendTo($grid);
    renderSlotValue($drop[0], '');

    const $tray = $('<div>', { class: `valuz-tile valuz-tile--slot valuz-tile--tray${typeClass}`, 'data-question-number': q.number })
      .css({ gridRow: row, gridColumn: 5 })
      .appendTo($grid);
    renderSlotValue($tray[0], SHUFFLED_ANSWERS[i]);
  });

  // --- Guess button ---
  const $guessBtn = $('#guessBtn');
  function updateGuessButtonState() {
    if (graded) return; // never re-enable after grading, regardless of tile state
    const allPlaced = QUESTIONS.every((q) => dropTileFor(q.number).dataset.value);
    $guessBtn.prop('disabled', !allPlaced);
  }

  // --- Drag-and-drop ---
  // Content-swap, exactly like SOLVZ: tiles never move in the DOM, dragging
  // swaps what's INSIDE the two tiles. Any two slot tiles may swap with
  // each other — column 5 -> column 3 (placing an answer), column 3 ->
  // column 5 (taking one back), or column 3 -> column 3 (directly
  // re-arranging two already-placed answers) — tileSelector is scoped to
  // '.valuz-tile--slot' so question tiles (column 1) are never draggable at
  // all, not even reachable by this module.
  let locked = true;
  enableTileDragSwap({
    container: document.getElementById('valuzGrid'),
    tileSelector: '.valuz-tile--slot',
    isLocked: () => locked,
    onSwap: (a, b) => {
      const aValue = a.dataset.value;
      const bValue = b.dataset.value;
      renderSlotValue(a, bValue);
      renderSlotValue(b, aValue);
      updateGuessButtonState();
      persistProgress(false);
    },
  });

  // --- Timer ---
  // Runs and displays throughout, purely for the player's own curiosity —
  // per the user's own call, VALUZ's actual score is correct-count out of
  // 6, not time, so the timer never factors into submitScore()/best-score
  // comparisons at all.
  let totalSeconds = 0;
  let timerInterval = null;

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
  function captureBoardState() {
    return {
      drop: QUESTIONS.map((q) => dropTileFor(q.number).dataset.value),
      tray: QUESTIONS.map((q) => trayTileFor(q.number).dataset.value),
    };
  }
  function applyBoardState(state) {
    QUESTIONS.forEach((q, i) => {
      renderSlotValue(dropTileFor(q.number), state.drop[i]);
      renderSlotValue(trayTileFor(q.number), state.tray[i]);
    });
  }
  // Preview runs (see `isPreview` above) never touch real localStorage —
  // every persistence/scoring call in this file goes through here or
  // through the `isPreview` guards around submitScore()/saveTodayScore()
  // near gradeRound(), so a dev preview of e.g. day 220 can never corrupt
  // the real player's actual today's-progress or best-score for VALUZ.
  function persistProgress(completed) {
    if (isPreview) return;
    saveProgress(GAME_ID, { board: captureBoardState(), seconds: totalSeconds, graded, score }, { completed });
  }

  // --- Grading ---
  let graded = false;
  let score = 0;

  function formatScore(s) {
    return `${s}/6`;
  }

  // Compares every drop tile's current value against that question's real
  // answer and applies the correct/incorrect visual — a small badge
  // overlay with a plain text tick/cross glyph (✓/✗, NOT the
  // emoji-presentation versions — explicit user correction), same
  // treatment for EVERY answer type now. This was originally colour-type
  // only (recoloring the tile itself for number/letter/emoji, since colour
  // tiles can't be recolored without erasing the answer) — the user liked
  // the badge look enough to drop the background-recolor approach entirely
  // and use badges everywhere instead. Pure/idempotent: used both for a
  // live Guess and for redrawing an already-completed day's result on
  // reload, so it always clears any previous mark first.
  function applyGradeMarks() {
    let correctCount = 0;
    QUESTIONS.forEach((q) => {
      const dropEl = dropTileFor(q.number);
      const isCorrect = dropEl.dataset.value === q.answer;
      if (isCorrect) correctCount++;

      const existingMark = dropEl.querySelector('.valuz-grademark');
      if (existingMark) existingMark.remove();

      const mark = document.createElement('span');
      mark.className = `valuz-grademark ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
      mark.textContent = isCorrect ? '✓' : '✗'; // plain text ✓ / ✗, not emoji glyphs
      dropEl.appendChild(mark);
    });
    return correctCount;
  }

  // Column 5 is empty by the time Guess is clicked (all 6 answers moved to
  // column 3) — this repopulates it with the ACTUAL correct answer for
  // each row, row-aligned with that row's question (not shuffled again),
  // so the player can compare column 3 (their guess) against column 5 (the
  // real answer) side by side. Also shows the "correct answers" label.
  function revealCorrectAnswers() {
    $col5Label.html('correct<br>answers');
    QUESTIONS.forEach((q) => {
      const trayEl = trayTileFor(q.number);
      renderSlotValue(trayEl, q.answer);
      trayEl.classList.add('is-revealed');
    });
  }

  // Only gives question tiles their "clickable for more info" affordance
  // (cursor + hover state, see .valuz-tile--question.is-clickable in
  // style.css) once the round is actually graded — called from both a live
  // Guess and the "already completed today" restore branch below, so the
  // spoiler-guard in the click handler above and the visual affordance
  // always agree with each other.
  function markQuestionsClickable() {
    document.querySelectorAll('.valuz-tile--question').forEach((el) => el.classList.add('is-clickable'));
  }

  function buildEndMessage(finalScore, result) {
    const scoreLine = `<p>You matched ${finalScore} out of 6 correctly</p>`;
    // Always the second sentence on the end screen, regardless of which
    // title/variant above it — explicit user request, replacing whatever
    // variant-specific line (new-best/tie/perfect/zero/generic) used to sit
    // here, so every end-screen state consistently points the player at
    // the post-game "more info" popover feature.
    const moreLine = `<p>Tap on a question to see more</p>`;
    const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
    if (!hasNoMeaningfulBest && result.isNewBest) {
      return `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p>${scoreLine}${moreLine}`;
    }
    if (!hasNoMeaningfulBest && result.isTie) {
      return `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p>${scoreLine}${moreLine}`;
    }
    if (finalScore === 6) {
      return `<p class="shell-end-screen__title"><strong>PERFECT!!! 🎯</strong></p>${scoreLine}${moreLine}`;
    }
    if (finalScore === 0) {
      return `<p class="shell-end-screen__title"><strong>OH NO 😬</strong></p>${scoreLine}${moreLine}`;
    }
    return `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p>${scoreLine}${moreLine}`;
  }

  function showEndScreenForScore(finalScore, result) {
    shell.showEndScreen({
      message: buildEndMessage(finalScore, result),
      animateTarget: document.getElementById('board'),
      shareText: `❓ VALUZ Day ${activeDayData.day} (${activeDayData.category}) — matched ${finalScore}/6!`,
      celebrate: finalScore === 6,
      score: isPreview ? null : finalScore,
    });
  }

  function gradeRound() {
    if (graded) return;
    graded = true;
    locked = true;
    stopTimer();
    $guessBtn.prop('disabled', true);

    score = applyGradeMarks();
    revealCorrectAnswers();
    markQuestionsClickable();

    if (isPreview) {
      showEndScreenForScore(score, { previousBest: null, isNewBest: false, isTie: false, isFirst: true });
      return;
    }
    persistProgress(true);
    const result = submitScore(GAME_ID, score, { higherIsBetter: true });
    saveTodayScore(GAME_ID, score);
    // VALUZ has no help/reveal concept of its own (the post-game "more info"
    // popover only ever shows AFTER grading, so it can't have influenced
    // the guess) — only isNewBest/isTie are meaningful here.
    saveTodayOutcome(GAME_ID, { revealed: false, usedHelp: false, failed: false, isNewBest: result.isNewBest, isTie: result.isTie });
    showEndScreenForScore(score, result);
  }

  $guessBtn.on('click', () => {
    if ($guessBtn.prop('disabled') || graded) return;
    gradeRound();
  });

  // --- Post-game "more info" popover ---
  // One shared floating element (see index.html's #morePopover), positioned
  // near whichever question tile was clicked, rather than one popover per
  // row — same look/feel as QUADZ/SLYDZ's own help popover (see that
  // game's style.css .help-popover), but anchored dynamically via
  // getBoundingClientRect() instead of a single fixed `position:absolute`
  // spot, since any of the 6 question rows can be the one clicked.
  // Deliberately only wired up AFTER grading (`if (!graded) return` below)
  // so it can never leak the answer before a guess is actually made.
  const $morePopover = $('#morePopover');

  function positionPopover(tileEl) {
    const rect = tileEl.getBoundingClientRect();
    const popEl = $morePopover[0];
    const popRect = popEl.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + popRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popRect.height - 8); // flip above the tile if there's no room below
    }
    let left = Math.min(rect.left, window.innerWidth - popRect.width - 8);
    left = Math.max(8, left);
    popEl.style.top = `${top}px`;
    popEl.style.left = `${left}px`;
  }

  function hideMorePopover() {
    $morePopover.addClass('is-hidden');
  }

  $(document).on('click', '.valuz-tile--question', function () {
    if (!graded) return;
    const questionNumber = Number(this.dataset.questionNumber);
    const alreadyOpenForThis = $morePopover.data('openFor') === questionNumber && !$morePopover.hasClass('is-hidden');
    if (alreadyOpenForThis) {
      hideMorePopover();
      return;
    }
    const q = QUESTIONS.find((qq) => qq.number === questionNumber);
    $morePopover.data('openFor', questionNumber).html(`<p>${q.more}</p>`).removeClass('is-hidden');
    positionPopover(this);
  });

  // Closes on any click outside both the popover itself and a question tile.
  $(document).on('click', (e) => {
    if ($morePopover.hasClass('is-hidden')) return;
    const clickedInsidePopover = $morePopover[0].contains(e.target);
    const clickedAQuestionTile = e.target.closest('.valuz-tile--question');
    if (!clickedInsidePopover && !clickedAQuestionTile) hideMorePopover();
  });

  // A `position:fixed` popover computed from getBoundingClientRect() at
  // click-time goes stale if the page then scrolls (e.g. .shell's own
  // overflow-y:auto safety net, see shared/shell.css) — capture:true so
  // this also catches scroll events from that nested scrollable ancestor,
  // which don't bubble to window/document by default.
  window.addEventListener('scroll', hideMorePopover, true);

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'VALUZ',
    emojiImage: getQuestionTileIconDataURL(),
    accentColor: { bg: '#8E6FB3', ink: '#2E1F42', rim: 'rgba(40, 20, 60, 0.30)' },
    instructions: `<p>Drag the 6 answers on the right to match questions on the left</p><p>Then tap guess</p><p>Afterward, tap any question to see more</p>`,
    formatScore,
  });

  if (isPreview) {
    // Dev preview of a day that isn't today's real puzzle — never restore
    // or branch off real daily-lock state, always a fresh play-through.
    shell.showStartBanner(() => {
      locked = false;
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  } else if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyBoardState(data.board);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    graded = true;
    score = data.score;
    applyGradeMarks();
    revealCorrectAnswers();
    markQuestionsClickable();
    $guessBtn.prop('disabled', true);
    shell.showEndScreen({
      message: `<p>You already played today's VALUZ — you matched ${score} out of 6.</p><p>Tap on a question to see more</p>`,
      shareText: `❓ VALUZ Day ${activeDayData.day} (${activeDayData.category}) — matched ${score}/6!`,
    });
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyBoardState(data.board);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    updateGuessButtonState();
    shell.showStartBanner(() => {
      locked = false;
      startTimer();
    }, { label: 'Resume' });
  } else {
    shell.showStartBanner(() => {
      locked = false;
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

  // --- Dev tools panel ---
  // "Fill correct answers & guess" mirrors SOLVZ's own "Solve puzzle"
  // shortcut — writes every correct answer straight into column 3 and runs
  // the real grading path, for quickly checking the grading/reveal/popover
  // flow without dragging by hand. One "Preview day N" button per day
  // actually loaded from days.json (built dynamically, not hardcoded, so
  // it always matches whatever content currently exists) reloads the page
  // with that day forced via ?day=, covering the "today has no authored
  // content yet" gap during this build-out phase.
  function fillCorrectAnswersAndGuess() {
    shell.hideStartBanner();
    if (locked) {
      locked = false;
      startTimer();
    }
    QUESTIONS.forEach((q) => {
      renderSlotValue(dropTileFor(q.number), q.answer);
      renderSlotValue(trayTileFor(q.number), '');
    });
    updateGuessButtonState();
    gradeRound();
  }

  const previewDayActions = days.map((d) => ({
    label: `Preview day ${d.day} (${d.category})`,
    onClick: () => {
      const url = new URL(window.location.href);
      url.searchParams.set('day', String(d.day));
      navigateWithSpinner(url.toString());
    },
  }));

  initToolsPanel([GAME_ID], {
    extraActions: [{ label: 'Fill correct answers & guess', onClick: fillCorrectAnswersAndGuess }, ...previewDayActions],
  });
});
