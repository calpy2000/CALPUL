// MOJEEZ — a daily set of 4 titles (movie, TV show, or book), each shown
// only as an emoji sequence, ordered easiest to hardest. Type a guess for
// all 4, then Guess to grade the whole set at once — modeled directly on
// VALUZ's "fill everything in, one Guess button grades the round" flow and
// its post-game "tap a tile to see more" popover, swapping VALUZ's
// drag-to-match tiles for MUVEEZ's free-text fuzzy-matched guess input
// (see shared/core/fuzzy-match.js, promoted out of MUVEEZ once this game
// needed the identical logic).

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore, getTodayOutcome } from '../../shared/core/game-storage.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { watchFitToStage } from '../../shared/core/fit-to-stage.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator, stripReloadParam, navigateWithSpinner } from '../../shared/core/loading-indicator.js';
import { isFuzzyMatch } from '../../shared/core/fuzzy-match.js';
import { getMojeezTileIconDataURL } from './tile-icon.js';

const GAME_ID = 'mojeez';

// Loaded once, up front, via top-level await (valid inside a <script
// type="module">) — same pattern VALUZ/WARPZ use for their own JSON data.
// `days` is an array of { day, items: [...] } — see days.json itself.
let days = [];
try {
  const res = await fetch(new URL('./days.json', import.meta.url));
  days = await res.json();
} catch (err) {
  console.warn('MOJEEZ: failed to load days.json', err);
}

// hidePageLoadingIndicator() runs AFTER the days.json fetch above, not as
// the very first statement — same fix VALUZ/WARPZ both needed (see VALUZ's
// own fuller comment on this): calling it first only covers the JS module
// graph finishing, not this game's own data fetch, which on a slow/cold
// connection would tear the spinner down right as the real network wait
// begins.
hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

// --- Which day's content to show ---
// Real players always get today's actual day-of-year match. A `?day=NNN`
// query param overrides that — used ONLY by this game's own dev-panel
// "Preview day" buttons (below), so whoever's building/testing MOJEEZ can
// jump straight to any authored day regardless of the real date, since
// content is still sparse (one day out of 366) during this build-out
// phase — same situation VALUZ/MUVEEZ were both in early on.
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
// the real daily-lock/best-score storage, exactly the same guard VALUZ
// uses for the same reason.
const isPreview = !activeDayData || activeDayData.day !== todayDayOfYear;

if (!activeDayData) {
  console.error('MOJEEZ: no day data available — days.json may have failed to load or is empty.');
}

$(function () {
  if (!activeDayData) {
    document.getElementById('mojeezBoard').innerHTML = '<p style="text-align:center">MOJEEZ has no puzzle data available right now.</p>';
    return;
  }

  const ITEMS = activeDayData.items; // [{ number, tier, category, title, emoji, explain }, ...], 4 entries

  function tileFor(itemNumber) {
    return document.querySelector(`.mojeez-tile[data-item-number="${itemNumber}"]`);
  }
  function inputFor(itemNumber) {
    return document.querySelector(`.mojeez-input[data-item-number="${itemNumber}"]`);
  }

  // --- Building the board ---
  // One card per item, built dynamically (not static HTML) since the
  // number of items/their content comes from days.json — same "static
  // shell, dynamic content" split VALUZ's own buildBoard uses.
  //
  // The taphint pill lives INSIDE .mojeez-input-wrap, positioned against
  // the input itself rather than the tile's outer corner — same
  // "badge-in-input" technique MUVEEZ's own .muveez-input-wrap uses for its
  // guess-number badge (see games/muveez/style.css), just on the right edge
  // instead of the left. This is also what keeps the pill lined up with the
  // input regardless of how tall the rest of the tile ends up being.
  //
  // .mojeez-zoom-badge sits in the tile's own top-right corner (not gated
  // behind grading, unlike the taphint pill) so a player can enlarge an
  // unclear emoji sequence before ever guessing — see openZoom() below.
  const $board = $('#mojeezBoard');
  ITEMS.forEach((item) => {
    $('<div>', { class: 'mojeez-tile', 'data-item-number': item.number })
      .html(
        `<button type="button" class="mojeez-zoom-badge" data-item-number="${item.number}" aria-label="Zoom this emoji">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"></circle><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"></line></svg>
           zoom
         </button>
         <span class="mojeez-tile__category">${item.category}</span>
         <div class="mojeez-tile__emoji">${item.emoji}</div>
         <div class="mojeez-input-wrap">
           <input type="text" class="mojeez-input" data-item-number="${item.number}" placeholder="Your guess" autocomplete="off" autocapitalize="off" spellcheck="false" disabled>
           <span class="mojeez-tile__taphint">tap</span>
         </div>`
      )
      .appendTo($board);
  });

  // --- Emoji zoom (badge -> full-width card, anchored on the tile itself) ---
  // A single shared card (see index.html's #zoomSheet/#zoomScrim), filled
  // in with whichever item's badge was tapped, then vertically positioned
  // right next to THAT tile (see positionZoomSheet — same
  // getBoundingClientRect + flip-if-no-room-below technique positionPopover
  // uses further down for #morePopover) rather than pinned to the bottom of
  // the viewport, so the enlarged emoji appears where the player was
  // already looking instead of requiring a glance all the way down the
  // screen. Independent of grading/lock state, since reading the clue is
  // the whole point. stopPropagation keeps the tap from also bubbling up
  // into the post-grade "more info" tile-click handler further down.
  const $zoomScrim = $('#zoomScrim');
  const $zoomSheet = $('#zoomSheet');
  const $zoomSheetEmoji = $('#zoomSheetEmoji');

  // Only the vertical position varies — the card itself is full viewport
  // width (see .mojeez-zoom-sheet's left:8px/right:8px in style.css), so
  // there's no horizontal offset left to compute.
  function positionZoomSheet(tileEl) {
    const rect = tileEl.getBoundingClientRect();
    const sheetEl = $zoomSheet[0];
    const sheetRect = sheetEl.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + sheetRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - sheetRect.height - 10); // flip above the tile if there's no room below
    }
    sheetEl.style.top = `${top}px`;
  }

  function openZoom(itemNumber) {
    const item = ITEMS.find((it) => it.number === itemNumber);
    hideMorePopover();
    $zoomSheetEmoji.html(item.emoji);
    positionZoomSheet(tileFor(itemNumber));
    $zoomScrim.addClass('is-open');
    $zoomSheet.addClass('is-open');
  }
  function closeZoom() {
    $zoomScrim.removeClass('is-open');
    $zoomSheet.removeClass('is-open');
  }

  $(document).on('click', '.mojeez-zoom-badge', function (e) {
    e.stopPropagation();
    openZoom(Number(this.dataset.itemNumber));
  });
  $zoomScrim.on('click', closeZoom);
  // A position computed from getBoundingClientRect() at open-time goes
  // stale if the page then scrolls — same fix positionPopover's own
  // scroll listener needs, for the same reason (see further down).
  window.addEventListener('scroll', closeZoom, true);

  function enableInputs() {
    document.querySelectorAll('.mojeez-input').forEach((el) => { el.disabled = false; });
  }

  // --- Guess button ---
  const $guessBtn = $('#guessBtn');
  function updateGuessButtonState() {
    if (graded) return; // never re-enable after grading, regardless of input state
    const allFilled = ITEMS.every((item) => inputFor(item.number).value.trim());
    $guessBtn.prop('disabled', !allFilled);
  }

  let locked = true;
  $(document).on('input', '.mojeez-input', () => {
    if (locked) return;
    updateGuessButtonState();
    persistProgress(false);
  });

  // --- Timer ---
  // Runs and displays throughout, purely for the player's own curiosity —
  // MOJEEZ's actual score is correct-count out of 4, not time, same as
  // VALUZ's own timer never factoring into best-score comparisons.
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
  function captureGuesses() {
    return ITEMS.map((item) => inputFor(item.number).value);
  }
  function applyGuesses(values) {
    ITEMS.forEach((item, i) => { inputFor(item.number).value = values[i] || ''; });
  }
  // Preview runs (see `isPreview` above) never touch real localStorage —
  // same guard VALUZ uses so a dev preview of e.g. day 40 can never
  // corrupt the real player's actual today's-progress or best score.
  function persistProgress(completed) {
    if (isPreview) return;
    saveProgress(GAME_ID, { guesses: captureGuesses(), seconds: totalSeconds, graded, score }, { completed });
  }

  // --- Grading ---
  let graded = false;
  let score = 0;

  function formatScore(s) {
    return `${s}/4`;
  }

  // Compares every input's current guess against that item's real title via
  // fuzzy matching (shared/core/fuzzy-match.js — the same tolerance MUVEEZ
  // uses for its own single-title guess), applies a correct/incorrect badge,
  // locks the input, and always reveals the real title so the player learns
  // the exact answer even when their fuzzy-matched guess wasn't spelled
  // identically. The reveal replaces the category label (MOVIE/TV/BOOK)
  // rather than adding a new line below the input — explicit request to
  // keep each tile's height down, so the end-of-game panel (always
  // positioned a fixed distance above the footer, see shared/shell.css)
  // lands below all 4 tiles instead of overlapping them. Pure/idempotent:
  // used both for a live Guess and for redrawing an already-completed
  // day's result on reload.
  function applyGradeMarks() {
    let correctCount = 0;
    ITEMS.forEach((item) => {
      const inputEl = inputFor(item.number);
      const isCorrect = isFuzzyMatch(inputEl.value, item.title);
      if (isCorrect) correctCount++;
      inputEl.disabled = true;

      const tileEl = tileFor(item.number);

      const existingMark = tileEl.querySelector('.mojeez-grademark');
      if (existingMark) existingMark.remove();
      const mark = document.createElement('span');
      mark.className = `mojeez-grademark ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
      mark.textContent = isCorrect ? '✓' : '✗'; // plain text ✓ / ✗, not emoji-presentation glyphs
      tileEl.appendChild(mark);

      const categoryEl = tileEl.querySelector('.mojeez-tile__category');
      categoryEl.textContent = item.title;
      categoryEl.classList.add('is-revealed');
    });
    return correctCount;
  }

  // Only gives tiles their "clickable for more info" affordance (cursor +
  // hover state, see .mojeez-tile.is-clickable in style.css) once the
  // round is actually graded — called from both a live Guess and the
  // "already completed today" restore branch below, so the spoiler-guard
  // in the click handler further down and the visual affordance always
  // agree with each other. Same pattern as VALUZ's markQuestionsClickable().
  function markTilesClickable() {
    document.querySelectorAll('.mojeez-tile').forEach((el) => el.classList.add('is-clickable'));
  }

  // 'max' (all 4 correct) / 'zero' (none correct) / undefined (a normal
  // in-between score) — fed into shell.showEndScreen's `outcome`, which
  // picks the matching one-line copy from end-panel-content.js.
  function classifyOutcome(finalScore) {
    if (finalScore === 4) return 'max';
    if (finalScore === 0) return 'zero';
    return undefined;
  }

  function showEndScreenForScore(finalScore, { outcome, isNewBest }) {
    shell.showEndScreen({
      outcome,
      scoreText: String(finalScore),
      isNewBest,
      animateTarget: document.getElementById('mojeezBoard'),
      shareText: `🙂 MOJEEZ - ${finalScore}/4`,
      celebrate: finalScore === 4,
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
    markTilesClickable();

    if (isPreview) {
      showEndScreenForScore(score, { outcome: classifyOutcome(score), isNewBest: false });
      return;
    }
    persistProgress(true);
    const result = submitScore(GAME_ID, score, { higherIsBetter: true });
    saveTodayScore(GAME_ID, score);
    // A meaningful PB needs a real previous best to have beaten — not the
    // player's first-ever play, and not a previous best of exactly 0 (see
    // end-panel-content.js's scenario-priority comment).
    const hasMeaningfulBest = result.previousBest !== null && result.previousBest !== 0;
    const outcome = classifyOutcome(score);
    const isNewBest = hasMeaningfulBest && result.isNewBest;
    // MOJEEZ has no help/reveal concept of its own (the post-game "more
    // info" popover only ever shows AFTER grading, so it can't have
    // influenced the guess), same as VALUZ's identical outcome shape.
    // panelOutcome/panelIsNewBest are the FINAL decision the end panel
    // showed today, persisted so a page reload can show the identical
    // scenario without re-deriving it (see the 'completed' branch below).
    saveTodayOutcome(GAME_ID, {
      revealed: false,
      usedHelp: false,
      failed: false,
      isNewBest: result.isNewBest,
      isTie: result.isTie,
      panelOutcome: outcome,
      panelIsNewBest: isNewBest,
    });
    showEndScreenForScore(score, { outcome, isNewBest });
  }

  $guessBtn.on('click', () => {
    if ($guessBtn.prop('disabled') || graded) return;
    gradeRound();
  });

  // --- Post-game "more info" popover ---
  // One shared floating element (see index.html's #morePopover), positioned
  // near whichever tile was clicked — identical mechanism to VALUZ's own
  // popover (see games/valuz/index.js for the fuller comment on each
  // step), just keyed by item number instead of question number, and
  // reading item.explain instead of q.more. Deliberately only wired up
  // AFTER grading (`if (!graded) return` below) so it can never leak an
  // answer before a guess is actually made.
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

  $(document).on('click', '.mojeez-tile', function () {
    if (!graded) return;
    const itemNumber = Number(this.dataset.itemNumber);
    const alreadyOpenForThis = $morePopover.data('openFor') === itemNumber && !$morePopover.hasClass('is-hidden');
    if (alreadyOpenForThis) {
      hideMorePopover();
      return;
    }
    const item = ITEMS.find((it) => it.number === itemNumber);
    $morePopover.data('openFor', itemNumber).html(`<p>${item.explain}</p>`).removeClass('is-hidden');
    positionPopover(this);
  });

  // Closes on any click outside both the popover itself and a tile.
  $(document).on('click', (e) => {
    if ($morePopover.hasClass('is-hidden')) return;
    const clickedInsidePopover = $morePopover[0].contains(e.target);
    const clickedATile = e.target.closest('.mojeez-tile');
    if (!clickedInsidePopover && !clickedATile) hideMorePopover();
  });

  // A `position:fixed` popover computed from getBoundingClientRect() at
  // click-time goes stale if the page then scrolls (e.g. .shell's own
  // overflow-y:auto safety net) — capture:true so this also catches scroll
  // events from that nested scrollable ancestor, which don't bubble to
  // window/document by default. Same fix VALUZ needed for the same reason.
  window.addEventListener('scroll', hideMorePopover, true);

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'MOJEEZ',
    emojiImage: getMojeezTileIconDataURL(),
    accentColor: { bg: '#E0787A', ink: '#4A1518', rim: 'rgba(90, 20, 22, 0.30)' },
    instructions: '<p>Guess movies, TV shows & books from emojis</p><p>Then tap guess</p><p>Afterwards tap an answer to see the reveal</p>',
    formatScore,
  });

  // Shrinks .mojeez-stage (via --fit-scale, see style.css) just enough that
  // it — plus room for the start-banner/end-screen panel — fits inside the
  // stage on any device, no page scroll needed. See VALUZ's own index.js
  // and shared/core/fit-to-stage.js for the fuller reasoning; same fix,
  // same root cause.
  watchFitToStage(document.getElementById('game-stage'), document.querySelector('.mojeez-stage'));

  if (isPreview) {
    // Dev preview of a day that isn't today's real puzzle — never restore
    // or branch off real daily-lock state, always a fresh play-through.
    shell.showStartBanner(() => {
      locked = false;
      enableInputs();
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  } else if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    applyGuesses(data.guesses);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    graded = true;
    score = data.score;
    applyGradeMarks();
    markTilesClickable();
    $guessBtn.prop('disabled', true);
    // Falls back to re-deriving outcome from just the score if this day was
    // completed before panelOutcome/panelIsNewBest existed — isNewBest
    // defaults to false in that fallback since there's no stored record of
    // whether it was a meaningful PB at the time.
    const storedOutcome = getTodayOutcome(GAME_ID);
    shell.showEndScreen({
      outcome: storedOutcome ? storedOutcome.panelOutcome : classifyOutcome(score),
      scoreText: String(score),
      isNewBest: storedOutcome ? storedOutcome.panelIsNewBest : false,
      shareText: `🙂 MOJEEZ - ${score}/4`,
    });
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    applyGuesses(data.guesses);
    totalSeconds = data.seconds;
    updateTimerDisplay();
    enableInputs();
    updateGuessButtonState();
    shell.showStartBanner(() => {
      locked = false;
      startTimer();
    }, { label: 'Resume' });
  } else {
    shell.showStartBanner(() => {
      locked = false;
      enableInputs();
      totalSeconds = 0;
      updateTimerDisplay();
      startTimer();
      persistProgress(false);
    });
  }

  // --- Dev tools panel ---
  // "Fill correct answers & guess" mirrors VALUZ's own shortcut — writes
  // every correct title straight into its input and runs the real grading
  // path, for quickly checking the grading/reveal/popover flow without
  // typing by hand. One "Preview day N" button per day actually loaded
  // from days.json (built dynamically, not hardcoded, so it always matches
  // whatever content currently exists) reloads the page with that day
  // forced via ?day=, covering the "today has no authored content yet" gap
  // during this build-out phase.
  function fillCorrectAnswersAndGuess() {
    shell.hideStartBanner();
    if (locked) {
      locked = false;
      enableInputs();
      startTimer();
    }
    ITEMS.forEach((item) => { inputFor(item.number).value = item.title; });
    updateGuessButtonState();
    gradeRound();
  }

  const previewDayActions = days.map((d) => ({
    label: `Preview day ${d.day}`,
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
