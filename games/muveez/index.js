// MUVEEZ — a 6x6 grid, each tile showing one slice of today's movie still
// (same "one big background image, sliced across 36 tiles" trick as GLYMPZ —
// see the detailed explanation in games/glympz/index.js). Unlike GLYMPZ, tiles
// are never shuffled or dragged: they're simply revealed, six at a time, in
// a random-but-same-for-everyone-today order, and the player tries to name
// the movie in as few guesses as possible. Each wrong guess reveals the
// next batch of six tiles.
//
// answers.js is populated gradually by the review tool in
// tools/muveez-curation/ (real movie stills + titles, added a batch at a
// time) — days that haven't been curated yet are still an empty string
// there, so PLACEHOLDER_ANSWER below covers those days until real data
// exists for every day of the year.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome } from '../../shared/core/game-storage.js';
import { dayOfYear } from '../../shared/core/date-utils.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { ANSWERS_366 } from './answers.js';
import { isFuzzyMatch } from './fuzzy-match.js';
import { getClapperboardIconDataURL } from './icon.js';

const GAME_ID = 'muveez';

const PLACEHOLDER_ANSWER = 'correct movie title';
const ANSWER = ANSWERS_366[dayOfYear() - 1] || PLACEHOLDER_ANSWER;

$(function () {

  const COLUMNS = 6;
  const TOTAL_TILES = 36; // 6x6
  const BATCH_SIZE = 6;
  const TOTAL_BATCHES = TOTAL_TILES / BATCH_SIZE; // 6 batches of 6

  const $grid = $('#grid-container');
  const $input = $('#guess-input');
  const $guessBtn = $('#guess-btn');
  const $error = $('#guess-error');
  const $guessNumber = $('#guess-number');

  // Same daily-image mechanism as GLYMPZ: picks today's numbered .jpg and
  // exposes it as a CSS custom property every tile's background-image reads
  // from (see style.css). See the fuller explanation of the "one big image,
  // sliced via background-position" trick in games/glympz/index.js.
  const imageFileName = `${dayOfYear()}.jpg`;
  document.documentElement.style.setProperty('--daily-image', `url('./images/${imageFileName}')`);

  // --- Seeded PRNG + shuffle — same technique as SOLVZ/GLYMPZ/SLYDZ (see the
  // fullest explanation of this exact trick in games/solvz/index.js) —
  // deterministic "random-looking" numbers so every player gets the exact
  // same tile-reveal order on the same calendar day. ---
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

  // Builds today's reveal order: shuffles the 36 tile indices (0-35), then
  // slices that shuffled list into 6 groups of 6 — group 1 is which tiles
  // appear first, group 2 which tiles appear on the first wrong guess, and
  // so on. `day * 449` (449 is prime) gives this game its own point in the
  // pseudo-random sequence, distinct from SOLVZ's `day * 997`, GLYMPZ's plain
  // Math.random() shuffle, and SLYDZ's `day * 733`.
  function generateRevealBatches(day) {
    const seed = day * 449;
    const indices = Array.from({ length: TOTAL_TILES }, (_, i) => i);
    const shuffled = seededShuffle(indices, seed);

    const batches = [];
    for (let b = 0; b < TOTAL_BATCHES; b++) {
      batches.push(shuffled.slice(b * BATCH_SIZE, b * BATCH_SIZE + BATCH_SIZE));
    }
    return batches;
  }

  // Precomputes all 366 days' reveal orders up front — same approach as
  // SOLVZ/SLYDZ, and just as cheap here (one shuffle of 36 items per day).
  const REVEAL_BATCHES_366 = [];
  for (let day = 1; day <= 366; day++) {
    REVEAL_BATCHES_366.push(generateRevealBatches(day));
  }

  const todayDayOfYear = dayOfYear();
  const revealBatches = REVEAL_BATCHES_366[todayDayOfYear - 1];

  console.log(`🎬 MUVEEZ Daily Puzzle (Day ${todayDayOfYear} of 366):`);
  console.log('Reveal order (tile indices per batch):', revealBatches);

  // Builds the 36 tiles. Unlike GLYMPZ, there's no shuffling and no per-tile
  // "correct order" to track — every tile permanently shows its own true
  // slice of the image, in its own true grid position. The only thing that
  // changes over time is whether a tile has the "revealed" class yet.
  //
  // Each tile is two layers (see style.css): the .tile element itself is a
  // plain, solid-colored placeholder that's visible immediately, and a
  // ::before pseudo-element sits on top of it showing that tile's actual
  // image slice, clipped down to nothing via `clip-path` until the
  // "revealed" class is added — that's what makes the 2-second swipe-down
  // animation possible. Since a ::before isn't a real element jQuery can
  // .css() directly, each tile's image position is instead stored as CSS
  // custom properties (--pos-x/--pos-y) ON the .tile element — style.css's
  // ::before rule then reads them back out with var(--pos-x)/var(--pos-y).
  // Custom properties are inherited by pseudo-elements the same way normal
  // CSS properties are, which is what makes this indirection work.
  function buildGrid() {
    for (let i = 0; i < TOTAL_TILES; i++) {
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      // Same background-position math as GLYMPZ: turns this tile's (row, col)
      // into a 0-100% position, picking out its one true slice of the
      // shared background image.
      const posX = (col / (COLUMNS - 1)) * 100;
      const posY = (row / (COLUMNS - 1)) * 100;

      const tile = $('<div>', {
        class: 'tile',
        id: `t${i + 1}`,
        'data-index': i,
      }).appendTo($grid)[0];
      tile.style.setProperty('--pos-x', `${posX}%`);
      tile.style.setProperty('--pos-y', `${posY}%`);
    }
  }
  buildGrid();

  // Adds the "revealed" class to every tile in the given batch (1-based).
  // No-ops safely past the last batch (see the guess-handling code below,
  // which calls this without needing its own bounds-checking every time).
  function revealBatch(batchNumber) {
    if (batchNumber < 1 || batchNumber > TOTAL_BATCHES) return;
    revealBatches[batchNumber - 1].forEach((tileIndex) => {
      $(`#t${tileIndex + 1}`).addClass('revealed');
    });
  }

  // Reveals every batch UP TO AND INCLUDING `batchNumber` at once, with no
  // animation delay between them — used when restoring a resumed or
  // already-completed game, where the tiles should just appear in their
  // already-revealed state immediately rather than replaying every reveal
  // that already happened in an earlier session.
  function revealUpTo(batchNumber) {
    for (let b = 1; b <= batchNumber; b++) revealBatch(b);
  }

  // --- Guessing ---
  let guessCount = 0;
  let revealedBatchCount = 0;
  let locked = true;
  // Tracks the OUTCOME of a finished game (not read at all while still
  // playing) — `null` until the game ends, then `true` for a correct guess
  // or `false` for running out of guesses. Persisted alongside everything
  // else so reloading an already-finished game knows which end-screen
  // message to show (see the 'completed' branch near the bottom of this
  // file).
  let won = null;

  // Guesses are capped at one per batch — TOTAL_BATCHES (6) tiles-batches
  // means 6 total guesses. The 6th guess is the last chance: if it's wrong,
  // the game ends in a loss (see submitGuess() below).
  const MAX_GUESSES = TOTAL_BATCHES;

  // Only used to detect a blank/whitespace-only submission — the actual
  // answer comparison is isFuzzyMatch() (see fuzzy-match.js), which does
  // its own much more forgiving normalization.
  function normalize(str) {
    return str.trim().toLowerCase();
  }

  // Keeps the black circle badge inside the guess input showing which
  // attempt number the player is ABOUT to make (guessCount is how many
  // guesses have already been submitted, so the next one is guessCount + 1).
  function updateGuessNumberDisplay() {
    $guessNumber.text(guessCount + 1);
  }

  // --- Timer ---
  // Kept purely as extra context for the player (and for a bit of visual
  // consistency with the other games' footers) — MUVEEZ's actual score is
  // the number of guesses, not elapsed time, so nothing here affects
  // scoring or the best-score comparison.
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
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  // --- Persistence (supports resume-in-progress) ---
  function persistProgress(completed) {
    saveProgress(GAME_ID, { revealedBatchCount, guessCount, seconds: totalSeconds, won }, { completed });
  }

  // --- Shell (header/footer/start banner/end screen/daily lock) ---
  const shell = initShell({
    gameId: GAME_ID,
    title: 'MUVEEZ',
    // Same clapperboard image shown on this game's hub tile — see
    // games/muveez/icon.js.
    emojiImage: getClapperboardIconDataURL(),
    // Buttons colored from this game's own hub-tile palette (games-registry.js's
    // `color`/`rim`) instead of the shared global blue every game used before.
    accentColor: { bg: '#DD7FA3', ink: '#5A0F32', rim: 'rgba(90, 15, 50, 0.30)' },
    instructions: '<p>Guess the movie from the tiles revealed so far</p><p>A maximum of 6 guesses</p><p>Fewer guesses is better!</p>',
  });

  // Replaces whatever the player last typed with the real answer, once the
  // game is over (win, loss, or revisiting an already-finished day) — always
  // the actual stored ANSWER text, never the player's own last guess.
  function showAnswerInInput() {
    $input.val(`Answer: ${ANSWER}`).addClass('is-answer-shown');
  }

  function handleWin() {
    locked = true;
    stopTimer();
    $input.prop('disabled', true);
    $guessBtn.prop('disabled', true);
    showAnswerInInput();
    won = true;
    // Guessing correctly reveals whatever tiles hadn't come up yet — the
    // player doesn't have to keep guessing wrong just to see the full
    // picture. Setting revealedBatchCount to the max (rather than just
    // calling revealUpTo) also makes sure that full reveal is what gets
    // saved by persistProgress() below, so reloading a completed game shows
    // every tile too.
    revealedBatchCount = TOTAL_BATCHES;
    revealUpTo(TOTAL_BATCHES);
    persistProgress(true);

    const result = submitScore(GAME_ID, guessCount, { higherIsBetter: false });
    saveTodayOutcome(GAME_ID, { revealed: false, usedHelp: false, failed: false, isNewBest: result.isNewBest, isTie: result.isTie });
    const guessWord = `${guessCount} guess${guessCount === 1 ? '' : 'es'}`;
    const wellDoneMessage = `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p><p>you scored ${guessWord}</p><p>see if you can do even better tomorrow</p>`;
    // No previous best at all (first-ever play) or a previous best of
    // exactly 0 would make "new best"/"equaled best" messaging read oddly
    // this early on — fall back to the plain WELL DONE message for both.
    const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
    const message = hasNoMeaningfulBest
      ? wellDoneMessage
      : result.isNewBest
        ? `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p><p>You scored ${guessWord}</p><p>That is a new <strong style="color: var(--shell-accent)">PERSONAL BEST</strong></p>`
        : result.isTie
          ? `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p><p>you equaled your best score of ${guessWord}</p><p>Let's go for a personal best tomorrow</p>`
          : wellDoneMessage;
    shell.showEndScreen({
      message,
      animateTarget: document.getElementById('grid-container'),
      shareText: `🎬 MUVEEZ — guessed in ${guessCount}!`,
      celebrate: true,
      score: guessCount,
    });
  }

  // Mirrors handleWin() but for running out of guesses — no submitScore()
  // call (a loss has no guess count worth recording as a "best"), and a
  // different message. Still reveals the full picture (already fully
  // revealed by the time the last guess is used, but this keeps the logic
  // correct even if MAX_GUESSES/TOTAL_BATCHES ever drift apart) so the
  // player at least gets to see what the answer's poster looked like.
  function handleLoss() {
    locked = true;
    stopTimer();
    $input.prop('disabled', true);
    $guessBtn.prop('disabled', true);
    showAnswerInInput();
    won = false;
    revealedBatchCount = TOTAL_BATCHES;
    revealUpTo(TOTAL_BATCHES);
    persistProgress(true);
    // Running out of guesses always auto-reveals the answer (see
    // showAnswerInInput()/revealUpTo() above) — unlike GLYMPZ/SLYDZ/QUADZ's
    // opt-in "give up" button, this isn't a player choice, but it's still a
    // real reveal, so it's recorded as both failed AND revealed.
    saveTodayOutcome(GAME_ID, { revealed: true, usedHelp: false, failed: true, isNewBest: false, isTie: false });

    shell.showEndScreen({
      message: `<p class="shell-end-screen__title"><strong>COMMISERATIONS 😢</strong></p><p>you failed to guess the movie</p><p>better luck tomorrow</p>`,
      animateTarget: document.getElementById('grid-container'),
      shareText: `🎬 MUVEEZ — couldn't guess it today!`,
      // No `celebrate` here — a loss is explicitly not a celebration moment.
    });
  }

  // The core guess flow: reads the input, ignores a blank submission
  // (otherwise a player could spam the button with nothing typed just to
  // farm free tile reveals), counts the attempt, and either wins, loses (if
  // this was the last of MAX_GUESSES and still wrong), or reveals the next
  // batch and shows the "Sorry, try again" message.
  function submitGuess() {
    if (locked) return;

    const raw = $input.val();
    if (!normalize(raw)) return; // blank/whitespace-only guess — do nothing

    guessCount++;

    if (isFuzzyMatch(raw, ANSWER)) {
      handleWin();
      return;
    }

    if (guessCount >= MAX_GUESSES) {
      handleLoss();
      return;
    }

    // Wrong guess, guesses still remaining.
    $error.removeClass('is-hidden');
    $input.val('');
    updateGuessNumberDisplay(); // badge now shows the NEXT attempt's number
    revealedBatchCount = Math.min(revealedBatchCount + 1, TOTAL_BATCHES);
    revealBatch(revealedBatchCount); // safely no-ops once every batch is already showing
    persistProgress(false);
  }

  $guessBtn.on('click', submitGuess);

  // Enter key submits a guess too, same as pressing the button — a plain
  // <input> has no default Enter behavior on its own (that's only true
  // inside a <form>, which this page deliberately doesn't use), so this
  // listener is what makes Enter do anything at all.
  $input.on('keydown', (e) => {
    if (e.key === 'Enter') submitGuess();
  });

  // Per the design: the "Sorry, try again" message disappears as soon as
  // the player starts typing their NEXT guess, rather than lingering once
  // they've clearly moved on. The 'input' event fires on every keystroke
  // (and paste, etc.) — this only needs to run the (cheap) class removal
  // once there's actually something to hide.
  $input.on('input', () => {
    if (!$error.hasClass('is-hidden')) $error.addClass('is-hidden');
  });

  // Testing shortcut: instantly wins — same spirit as GLYMPZ's "Solve puzzle"
  // shortcut. Calls handleWin() directly rather than routing through
  // submitGuess()/Play Now, since this can be used even before the game has
  // been started at all; handleWin() itself takes care of revealing every
  // remaining tile (same as a real correct guess does), so nothing extra
  // needs doing here.
  function revealAnswer() {
    shell.hideStartBanner();
    guessCount = guessCount || 1;
    handleWin();
  }

  initToolsPanel([GAME_ID], { extraActions: [{ label: 'Reveal answer', onClick: revealAnswer }] });

  // Same three-way daily-status branch as SOLVZ/GLYMPZ/SLYDZ — see the fuller
  // explanation in games/solvz/index.js.
  if (shell.status.status === 'completed') {
    const { data } = shell.status.record;
    revealedBatchCount = data.revealedBatchCount;
    guessCount = data.guessCount;
    totalSeconds = data.seconds;
    won = data.won;
    revealUpTo(revealedBatchCount);
    updateTimerDisplay();
    $input.prop('disabled', true);
    $guessBtn.prop('disabled', true);
    showAnswerInInput();
    // No `celebrate` on this branch either way — this only runs when
    // revisiting a day already finished in an EARLIER session, not on the
    // actual moment of winning/losing, so it shouldn't replay the confetti.
    shell.showEndScreen(won === false ? {
      message: `<p class="shell-end-screen__title"><strong>COMMISERATIONS 😢</strong></p><p>you failed to guess the movie</p><p>better luck tomorrow</p>`,
      shareText: `🎬 MUVEEZ — couldn't guess it today!`,
    } : {
      message: `<p>You already guessed today's MUVEEZ in ${guessCount}.</p><p>Hope to see you tomorrow.</p>`,
      shareText: `🎬 MUVEEZ — guessed in ${guessCount}!`,
    });
  } else if (shell.status.status === 'in-progress') {
    const { data } = shell.status.record;
    revealedBatchCount = data.revealedBatchCount;
    guessCount = data.guessCount;
    totalSeconds = data.seconds;
    revealUpTo(revealedBatchCount);
    updateTimerDisplay();
    updateGuessNumberDisplay(); // restores the badge to the correct next-attempt number on resume
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
      revealedBatchCount = 1;
      revealBatch(1); // the very first reveal happens as soon as the player presses Play Now
      persistProgress(false);
    });
  }

});
