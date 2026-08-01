// JEWELZ — move a face around a canvas, dodging spinning bars and
// collecting jewels that appear in timed waves, for as long as possible.
//
// Unlike SOLVZ/GLYMPZ (which build their game out of HTML elements you can
// inspect in DevTools), everything visible here is drawn by JavaScript onto
// a <canvas> — a blank rectangular surface the browser gives you full pixel-
// level drawing control over. There's no "jewel element" or "bar element"
// in the DOM at all; `bars`/`jewels`/`particles` below are just plain
// JavaScript objects/arrays that this file draws fresh, by hand, every
// single frame.

import Bar from './Bar.js';
import Jewel from './Jewel.js';
import { getJewelIconDataURL, getBonusJewelIconDataURL, BONUS_JEWEL_STYLE } from './jewel-icon.js';
import { drawPlayerFace, getPlayerIconDataURL } from './player-icon.js';
import { getHorizontalBarIconDataURL } from './bar-icon.js';
import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome } from '../../shared/core/game-storage.js';
import { enableCanvasPointerDrag } from '../../shared/input/canvas-pointer.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { hidePageLoadingIndicator } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();

const GAME_ID = 'jewelz';

// Inline <img> tags, pre-built once, reused everywhere the corresponding
// emoji used to appear in rendered HTML (live score, footer best score,
// end-of-round message, instructions). Text-only surfaces (shareText, going
// to the clipboard — see shell.js's shareResults()) keep the plain emoji
// instead, since there's no HTML there for an <img> to render.
const JEWEL_IMG = `<img src="${getJewelIconDataURL()}" alt="jewel" class="jewelz-inline-icon">`;
// Sapphire bonus jewel — used alongside JEWEL_IMG in the instructions text
// so both jewel colors a player might see in play are shown, not just the
// regular ruby one.
const BONUS_JEWEL_IMG = `<img src="${getBonusJewelIconDataURL()}" alt="bonus jewel" class="jewelz-inline-icon">`;
const PLAYER_IMG = `<img src="${getPlayerIconDataURL()}" alt="player" class="jewelz-inline-icon">`;
const BAR_IMG = `<img src="${getHorizontalBarIconDataURL()}" alt="bar" class="jewelz-inline-icon--bar">`;

initToolsPanel([GAME_ID], {
  extraActions: [
    // Matches RAINZ's own "Force game over" shortcut — reaching game-over
    // by actually colliding with a bar isn't practical to force by hand for
    // every test pass. Just flipping the flag (rather than also setting
    // isPlayerExploded/faking a collision) is enough: animate()'s
    // finalSummaryProcessed check only waits on particles.length === 0,
    // which is already true with no explosion triggered, so the end screen
    // shows on the very next frame.
    { label: 'Force game over', onClick: () => { isGameOver = true; } },
    // Spawns a bonus jewel a little offset from the player (visible, but
    // not collected instantly) — the wave state machine only offers a
    // bonus jewel once per ~8-second cycle (waiting -> active -> waiting ->
    // bonus), which isn't practical to wait out by hand for every test pass.
    {
      label: 'Spawn bonus jewel',
      onClick: () => {
        const bonusJewel = new Jewel(
          Math.min(player.x + 100, canvas.width - 40),
          player.y
        );
        bonusJewel.style = BONUS_JEWEL_STYLE;
        bonusJewel.radius = 30;
        bonusJewel.maxLifetime = 1.5;
        bonusJewel.value = 3;
        bonusJewel.label = '3';
        jewels.push(bonusJewel);
      },
    },
  ],
});

const canvas = document.getElementById('responsiveCanvas');
// getContext('2d') returns the actual drawing API object — everything drawn
// below goes through `ctx` (short for "context"), e.g. ctx.fillRect(...),
// ctx.fillText(...). This is the browser's built-in Canvas API, not a
// third-party library.
const ctx = canvas.getContext('2d');
const liveScoreEl = document.getElementById('liveScore');

// Unlike SOLVZ/GLYMPZ, JEWELZ has NO wrapping $(function(){}) — there's no
// jQuery loaded (see index.html), and since this script tag has
// type="module", it's automatically deferred until the HTML is fully
// parsed anyway (so #responsiveCanvas/#liveScore above are guaranteed to
// already exist by the time these lines run).

// --- Game state ---
// All of these are plain top-level variables (not wrapped in any object or
// class) that the functions below read and update directly — a simple
// approach that works fine for a game this size, though a larger game would
// often group related state together (e.g. into a single `gameState`
// object) to keep track of it more easily.
let isGameStarted = false;
let isGameOver = false;
let isDragging = false;
// performance.now() returns a high-precision timestamp (milliseconds since
// the page loaded) — used here (and in animate() below) to measure exactly
// how much time passed between frames, which is what makes the game's speed
// consistent regardless of how fast or slow a particular device can render.
let lastTime = performance.now();

let survivalTime = 0; // seconds survived so far this round — also what's shown in the header timer
let lastSpawnTime = 0; // survivalTime value when a new bar was last spawned
let score = 0; // jewels collected this round

let jewelCycleTimer = 0;
let jewelPhase = 'waiting'; // 'waiting', 'active' (regular jewel wave), or 'bonus' (single bonus jewel) — see the wave logic inside animate() below
let waveJewelsSpawned = false;
// Alternates between 'active' and 'bonus' each time a 'waiting' phase ends,
// so the bonus jewel's own appearances interleave between regular waves
// rather than potentially landing on the same cycle as one.
let nextWavePhase = 'active';

// How many bonus phases have started this round — the FIRST 5 spawn a
// single bonus jewel (as before), the NEXT 5 (appearances 6-10) spawn 2
// at once, and every one after that spawns 3 — same 1.5s duration and "3"
// value each, just more of them on screen simultaneously, so the maximum
// score per bonus phase escalates from 3 to 6 to 9 and then stays there.
let bonusAppearanceCount = 0;

let isPlayerExploded = false;
let finalSummaryProcessed = false;

// Hues newly-spawned bars are picked from (see the spawn logic inside
// animate()) — each bar is now drawn with the neon-glow + pulsing + full
// 3D bevel treatment (see Bar.js's draw()), picked from the canvas effects
// gallery: cyan, magenta, gold.
const neonHues = [175, 320, 45];

// Tracks whichever hue the MOST RECENTLY created bar got — including the
// very first hardcoded one in startGame() — so the spawn logic below can
// exclude it from the next pick and guarantee two bars never spawn back to
// back in the same color.
let lastBarHue = neonHues[0];

// The player's position and size, in the canvas's own internal coordinate
// space (0,0 top-left, up to canvas.width/height bottom-right) — NOT
// on-screen pixel coordinates, which may differ if the canvas is displayed
// larger/smaller than its native 450x800 resolution (see
// shared/input/canvas-pointer.js for the coordinate conversion that makes
// mouse/touch input line up with this space correctly).
const player = { x: 225, y: 400, radius: 25 }; // vertical middle of the 800px-tall canvas, so the face is visible behind the start banner
let bars = [];
let jewels = [];
let particles = []; // small diamond-shaped bits flung outward for the explosion effects

// Checks whether a circle (the player) overlaps a ROTATED rectangle (a
// Bar — see Bar.js, which spins over time via its own `angle` property).
// This uses a technique sometimes called "closest point on rectangle": if
// you can find the point ON the rectangle's edge/interior that's CLOSEST to
// the circle's center, then the circle and rectangle overlap exactly when
// that closest point is within the circle's radius. The tricky part is that
// the rectangle is rotated — so this first "un-rotates" the whole problem
// (rotating the circle's position by the NEGATIVE of the rectangle's angle,
// which is mathematically equivalent to rotating the rectangle back to
// being perfectly upright), solves the much simpler axis-aligned version of
// the problem, then the result is valid either way since rotation doesn't
// change distances.
function checkCollision(circle, rect) {
  // Circle's position relative to the rectangle's center.
  const cx = circle.x - rect.x;
  const cy = circle.y - rect.y;
  // Standard 2D rotation formula, rotating by -rect.angle (undoing the
  // rectangle's own rotation) to work out where the circle would be if the
  // rectangle were upright.
  const cos = Math.cos(-rect.angle);
  const sin = Math.sin(-rect.angle);
  const unrotatedCircleX = cx * cos - cy * sin;
  const unrotatedCircleY = cx * sin + cy * cos;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  // Clamps the (now un-rotated) circle position to the rectangle's bounds —
  // this finds the closest point ON the rectangle to the circle's center:
  // if the circle is already "inside" the rectangle's span on an axis, the
  // closest point on that axis is the circle's own position (clamping does
  // nothing); if the circle is outside, the closest point is the
  // rectangle's nearest edge.
  const closestX = Math.max(-halfW, Math.min(unrotatedCircleX, halfW));
  const closestY = Math.max(-halfH, Math.min(unrotatedCircleY, halfH));
  const distX = unrotatedCircleX - closestX;
  const distY = unrotatedCircleY - closestY;
  // Compares squared distance to squared radius, rather than taking a
  // square root to get the real distance — mathematically equivalent for a
  // simple "is this closer than X" check, and slightly cheaper to compute
  // since Math.sqrt() is relatively expensive to call many times per frame.
  return (distX * distX + distY * distY) < (circle.radius * circle.radius);
}

// Spawns `count` small diamond particles bursting outward from one point,
// in a full circle around it — used for both the "jewel collected" sparkle
// and the player's "hit by a bar" explosion.
function createExplosion(startX, startY, color, size, count) {
  for (let i = 0; i < count; i++) {
    // Divides a full circle (2π radians) evenly among `count` particles, so
    // each one starts flying in a different, evenly-spaced direction — the
    // added `Math.random() * 0.5` gives each one a small random nudge off
    // that perfectly even angle so the burst doesn't look too mechanically
    // uniform.
    const angle = (Math.PI * 2 / count) * i + (Math.random() * 0.5);
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: startX, y: startY,
      // vx/vy ("velocity x/y") — how far this particle moves per frame,
      // computed from its angle and speed using basic trigonometry
      // (cos/sin convert an angle+distance into x/y movement amounts).
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color, size, alpha: 1, life: 1.0,
    });
  }
}

// Draws one full frame: clears the canvas, then redraws everything (bars,
// jewels, particles, the player) from scratch in their CURRENT positions.
// Canvas has no memory of what it drew last frame — every visible frame is
// the result of this function running the drawing commands again from the
// current state.
function drawEverything() {
  // Wipes the entire canvas back to blank/transparent — without this, every
  // frame's drawing would just pile up on top of the last, leaving trails
  // everywhere instead of things appearing to move.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  particles.forEach((p) => {
    // ctx.save()/ctx.restore() bracket a group of drawing settings changes
    // (here, globalAlpha and fillStyle) so they only apply to THIS
    // particle's drawing and don't leak into whatever gets drawn next —
    // save() remembers the context's current settings, restore() puts them
    // back exactly as they were.
    ctx.save();
    ctx.globalAlpha = p.alpha; // fades the particle out as it dies (see the alpha update logic in animate())
    ctx.fillStyle = p.color;
    // Draws a small diamond shape: begin a new path, move to the top point
    // (without drawing), then draw straight lines to the right, bottom, and
    // left points in turn, then closePath() draws the final line back to
    // the starting point, and fill() colors the resulting shape in.
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - p.size);
    ctx.lineTo(p.x + p.size, p.y);
    ctx.lineTo(p.x, p.y + p.size);
    ctx.lineTo(p.x - p.size, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Bar.js and Jewel.js each expose their own .draw(ctx) method — this file
  // doesn't need to know HOW a bar or jewel actually draws itself, only
  // that calling .draw(ctx) on one does the right thing. That's a small
  // example of "encapsulation": each class owns and hides the details of
  // its own appearance.
  jewels.forEach((jewel) => jewel.draw(ctx));
  bars.forEach((bar) => bar.draw(ctx));

  if (!isPlayerExploded) {
    // See player-icon.js — a warm 3D "glass bubble" the user picked out of
    // a gallery of Canvas-drawn avatar concepts, replacing the plain 🙂
    // emoji this used to just fillText() directly.
    drawPlayerFace(ctx, player.x, player.y, player.radius, survivalTime);
  }
}

// Builds the end-of-round message text, based on how this score compares to
// the player's previous best (the `result` object comes straight from
// game-storage.js's submitScore() — see shared/core/game-storage.js).
function buildResultLine(finalScore, result) {
  // A round that ends with nothing collected gets its own dedicated message
  // rather than folding into the generic "GAME OVER" line below — takes
  // priority over isFirst/isNewBest/isTie, since a score of 0 "tying" a
  // previous best of 0 still isn't something worth congratulating.
  if (finalScore === 0) {
    return `<p class="shell-end-screen__title"><strong>OH NO!! 😢</strong></p><p>you failed to score today</p><p>better luck tomorrow</p>`;
  }
  // No previous best at all (result.isFirst) or a previous best of exactly
  // 0 would make "new best"/"equaled best" messaging read oddly this early
  // on — fall back to the plain WELL DONE message for both, same as every
  // other game.
  const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
  if (!hasNoMeaningfulBest && result.isNewBest) {
    return `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p><p>You scored ${finalScore} ${JEWEL_IMG}</p><p>That is a new <strong style="color: var(--shell-accent)">PERSONAL BEST</strong></p>`;
  }
  // finalScore > 0 is already guaranteed here (the ===0 case returned above).
  if (!hasNoMeaningfulBest && result.isTie) {
    return `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p><p>you equaled your best score of ${finalScore} ${JEWEL_IMG}</p><p>Let's go for a personal best tomorrow</p>`;
  }
  return `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p><p>you scored ${finalScore} ${JEWEL_IMG}</p><p>see if you can do even better tomorrow</p>`;
}

// THE GAME LOOP. This function calls itself over and over via
// requestAnimationFrame (see the very last line of this function) — that
// browser API schedules its callback to run right before the next screen
// repaint, typically 60 times per second, and passes in a timestamp
// (`currentTime`) for that exact moment. This self-scheduling pattern (a
// function that calls requestAnimationFrame(itself) at its own end) is the
// standard way to drive any canvas animation/game loop in the browser.
function animate(currentTime) {
  // Bails out once the round's ending has already been fully handled (see
  // the block near the bottom of this function) — without this check, the
  // loop would keep running forever even after the game visibly ended.
  if (finalSummaryProcessed) return;

  // deltaTime = seconds elapsed since the PREVIOUS frame (dividing by 1000
  // converts milliseconds to seconds). Every movement/timer calculation
  // below is multiplied by deltaTime rather than being a fixed
  // per-frame amount — that's what's called "frame-rate independent"
  // movement: the game plays at the same real-world SPEED whether it's
  // running at 30fps or 144fps, because a slower frame rate means fewer,
  // but individually LARGER, position updates (bigger deltaTime each time),
  // averaging out to the same overall motion.
  const deltaTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;

  if (!isGameOver) {
    survivalTime += deltaTime;
    shell.timer.setSeconds(survivalTime); // keeps the shared header timer updated live, every frame

    // Spawns a new bar every 20 seconds of survival. `lastSpawnTime += 20`
    // (rather than `lastSpawnTime = survivalTime`) keeps spawns locked to
    // exact 20-second intervals even if a frame happens to land slightly
    // late.
    if (survivalTime - lastSpawnTime >= 20) {
      lastSpawnTime += 20;
      // Picks randomly from whichever hues AREN'T the previous bar's, so
      // consecutive bars are guaranteed to differ (with only 3 hues total,
      // "not the same as last time" already gives real variety without
      // needing full shuffle-bag logic).
      const hueChoices = neonHues.filter((hue) => hue !== lastBarHue);
      const spawnHue = hueChoices[Math.floor(Math.random() * hueChoices.length)];
      lastBarHue = spawnHue;

      // Keeps picking a random position until it finds one far enough from
      // the player (150px) — a "rejection sampling" pattern: generate a
      // random candidate, check if it's acceptable, and if not just throw
      // it away and try again. This avoids ever spawning a bar directly on
      // top of (or unfairly close to) the player.
      let spawnX, spawnY, isTooClose = true;
      while (isTooClose) {
        spawnX = 50 + Math.random() * (canvas.width - 100);
        spawnY = 50 + Math.random() * (canvas.height - 100);
        // ** is JavaScript's exponent operator — `x ** 2` means x squared.
        // This is the standard distance formula (Pythagorean theorem):
        // distance = sqrt((x2-x1)² + (y2-y1)²).
        if (Math.sqrt((spawnX - player.x) ** 2 + (spawnY - player.y) ** 2) > 150) isTooClose = false;
      }
      bars.push(new Bar(spawnX, spawnY, spawnHue));
    }

    // Moves/spins every existing bar (see Bar.js's own update() method for
    // what that actually does — bouncing off walls, spinning over time).
    bars.forEach((bar) => bar.update(deltaTime, canvas.width, canvas.height));

    // --- Jewel spawn "wave" state machine ---
    // Jewels don't appear continuously. A 4-second 'waiting' phase (nothing
    // spawns) is always followed by either a 3-second 'active' phase (three
    // regular jewels appear together) or a 1.5-second 'bonus' phase (one
    // bigger, higher-value jewel appears alone) — `nextWavePhase` alternates
    // between the two every time a 'waiting' phase ends, so bonus jewels
    // interleave between regular waves rather than every wave being
    // regular. Whichever phase is active, uncollected jewels get
    // force-despawned at the end of it. `jewelPhase` tracks which phase is
    // currently happening, and `jewelCycleTimer` tracks how far into the
    // CURRENT phase we are — it gets reset to 0 every time the phase
    // switches.
    jewelCycleTimer += deltaTime;

    if (jewelPhase === 'waiting') {
      if (jewelCycleTimer >= 4) {
        jewelPhase = nextWavePhase;
        nextWavePhase = nextWavePhase === 'active' ? 'bonus' : 'active';
        jewelCycleTimer = 0;
        waveJewelsSpawned = false;
      }
    } else if (jewelPhase === 'active') {
      if (!waveJewelsSpawned) {
        waveJewelsSpawned = true;
        for (let k = 0; k < 3; k++) {
          const jewelX = 40 + Math.random() * (canvas.width - 80);
          const jewelY = 40 + Math.random() * (canvas.height - 80);
          const newJewel = new Jewel(jewelX, jewelY);
          newJewel.maxLifetime = 3; // overrides Jewel's own default lifetime to match this 3-second active phase
          jewels.push(newJewel);
        }
      }
      if (jewelCycleTimer >= 3) {
        // triggerDespawn() (see Jewel.js) starts each remaining jewel's
        // shrink-away animation rather than deleting it instantly — so
        // uncollected jewels play a little "fading out" effect instead of
        // just vanishing.
        jewels.forEach((j) => j.triggerDespawn());
        jewelPhase = 'waiting';
        jewelCycleTimer = 0;
      }
    } else if (jewelPhase === 'bonus') {
      if (!waveJewelsSpawned) {
        waveJewelsSpawned = true;
        bonusAppearanceCount += 1;
        // 1 jewel for appearances 1-5, 2 for appearances 6-10, 3 from then on.
        const bonusCount = bonusAppearanceCount <= 5 ? 1 : bonusAppearanceCount <= 10 ? 2 : 3;
        for (let k = 0; k < bonusCount; k++) {
          const jewelX = 40 + Math.random() * (canvas.width - 80);
          const jewelY = 40 + Math.random() * (canvas.height - 80);
          const bonusJewel = new Jewel(jewelX, jewelY);
          bonusJewel.style = BONUS_JEWEL_STYLE; // sapphire, distinct from the regular ruby jewel
          bonusJewel.radius = 30; // bigger than the regular jewel's 20, per the user's request
          bonusJewel.maxLifetime = 1.5; // stays available ~1.5 seconds (1 -> 2 -> 1.5 across two rounds of playtesting feedback)
          bonusJewel.value = 3; // worth 3 regular jewels
          bonusJewel.label = '3'; // drawn on the gem so the player knows its value at a glance
          jewels.push(bonusJewel);
        }
      }
      if (jewelCycleTimer >= 1.5) {
        jewels.forEach((j) => j.triggerDespawn());
        jewelPhase = 'waiting';
        jewelCycleTimer = 0;
      }
    }
  }

  // Updates every jewel's own internal animation state (spawning in,
  // idling, or despawning — see Jewel.js), and .filter() keeps only the
  // ones whose .update() DIDN'T return true (Jewel's update() returns true
  // once a jewel has fully finished despawning and should be removed for
  // good). This runs even while isGameOver is true, so any in-progress
  // despawn animation gets to finish playing out.
  jewels = jewels.filter((jewel) => !jewel.update(deltaTime));

  // Moves each particle by its velocity, and fades it out over time —
  // `life` counts down from 1.0 to 0 (deltaTime * 1.5 makes them fade
  // slightly faster than one-real-second-per-unit), and `alpha` (used by
  // drawEverything() above) is clamped to never go below 0.
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= deltaTime * 1.5;
    p.alpha = Math.max(0, p.life);
  });
  particles = particles.filter((p) => p.life > 0); // drops fully-faded particles for good

  if (!isGameOver) {
    // Iterating BACKWARDS (from the last index down to 0) is a common
    // pattern when a loop might remove items from the array it's looping
    // over — removing/replacing an item at index i while iterating forward
    // would shift every later item's index by one, potentially causing the
    // loop to skip the item that just slid into the current position.
    // Counting down avoids that entirely, since indices below the current
    // one are never affected by anything that happens above it.
    for (let i = jewels.length - 1; i >= 0; i--) {
      if (jewels[i].state === 'idle') { // only collectible while fully "arrived" (not still popping in or fading out)
        const distance = Math.sqrt((jewels[i].x - player.x) ** 2 + (jewels[i].y - player.y) ** 2);
        if (distance < (player.radius + jewels[i].radius)) {
          createExplosion(jewels[i].x, jewels[i].y, jewels[i].style.glowColor, 4, 12);
          score += jewels[i].value; // regular jewel = 1, bonus jewel = 3
          jewels[i].triggerDespawn();
          liveScoreEl.innerHTML = `Score: ${JEWEL_IMG} = ${score}`;
        }
      }
    }
  }

  drawEverything();

  if (!isGameOver) {
    for (let i = 0; i < bars.length; i++) {
      if (checkCollision(player, bars[i])) {
        isGameOver = true;
        isDragging = false;
        isPlayerExploded = true;
        // Two overlapping explosion bursts (different colors/sizes) layered
        // together for a bigger, more chaotic-looking effect than a single
        // burst would give.
        createExplosion(player.x, player.y, '#1e90ff', 6, 25);
        createExplosion(player.x, player.y, '#ffa502', 4, 15);
      }
    }
  }

  // Waits until the game is over AND every explosion particle has finished
  // fading out (particles.length === 0) before showing the results — this
  // is what lets the player's explosion animation play out fully before the
  // end screen interrupts with the score summary.
  if (isGameOver && particles.length === 0 && !finalSummaryProcessed) {
    finalSummaryProcessed = true;

    const result = submitScore(GAME_ID, score, { higherIsBetter: true });
    const resultLine = buildResultLine(score, result);
    saveProgress(GAME_ID, { score, resultLine, seconds: survivalTime }, { completed: true });
    // JEWELZ has no reveal/help concept, and only ever ends via a death — a
    // round that collected nothing (score === 0) is the closest thing JEWELZ
    // has to a "failed" outcome, distinct from a death that still scored.
    saveTodayOutcome(GAME_ID, { revealed: false, usedHelp: false, failed: score === 0, isNewBest: result.isNewBest, isTie: result.isTie });

    liveScoreEl.textContent = '';
    shell.showEndScreen({ message: resultLine, shareText: `💎💎 JEWELZ — scored ${score} 💎 today!`, celebrate: score > 0, score });
    return; // stops here — no requestAnimationFrame(animate) call below, so the loop naturally stops running
  }

  // Schedules this SAME function to run again for the next frame — this is
  // what keeps the game loop going. Note this line is only reached if the
  // block above didn't already `return`.
  requestAnimationFrame(animate);
}

// Builds the very first bar of a round, positioned just below the smiley
// face's starting spot rather than the old fixed (110, 150) — that could
// land anywhere relative to the player and, worse, inherited Bar's fully
// random diagonal velocity, so it could occasionally beeline straight into
// the still-stationary player in the first instant after "Play Now" is
// pressed, before they've had a chance to start moving. Overriding speedX/
// speedY afterward (same pattern as the bonus jewel's post-construction
// overrides below) keeps it mostly horizontal with only a gentle downward
// drift, so it can't double back upward into the player right away.
function createFirstBar() {
  const bar = new Bar(player.x, 0, neonHues[0]);
  bar.y = player.y + player.radius + bar.height / 2 + 20; // just below the smiley, with a small gap
  bar.speedX = 4 * (Math.random() < 0.5 ? 1 : -1); // mostly horizontal...
  bar.speedY = 1; // ...only drifting gently down the screen
  return bar;
}

// Resets every piece of round state back to its starting values and kicks
// off the game loop — called once, when the player presses "Play Now" (see
// shell.showStartBanner(startGame) near the bottom of this file).
function startGame() {
  bars = [createFirstBar()]; // one bar to start (cyan); more spawn over time inside animate()
  lastBarHue = neonHues[0]; // matches the starting bar above, so the first spawned bar won't repeat it
  jewels = [];
  particles = [];
  isGameStarted = true;
  isGameOver = false;
  isPlayerExploded = false;
  finalSummaryProcessed = false;
  survivalTime = 0;
  lastSpawnTime = 0;
  jewelCycleTimer = 0;
  jewelPhase = 'waiting';
  waveJewelsSpawned = false;
  nextWavePhase = 'active'; // first wave after the initial wait is always a regular one
  bonusAppearanceCount = 0; // fresh escalation (1 -> 2 -> 3 bonus jewels) each round
  score = 0;

  liveScoreEl.innerHTML = `Score: ${JEWEL_IMG} = ${score}`;
  lastTime = performance.now(); // reset so the very first deltaTime isn't inflated by however long the start banner was showing
  requestAnimationFrame(animate); // kicks off the game loop for the first time
}

// Wires up player movement — see shared/input/canvas-pointer.js for how
// mouse/touch positions get converted into this canvas's coordinate space
// before these callbacks even run.
enableCanvasPointerDrag({
  canvas,
  onStart: (pos) => {
    if (!isGameStarted || isGameOver || isPlayerExploded) return;
    const dx = pos.x - player.x;
    const dy = pos.y - player.y;
    // Only starts dragging if the press/tap landed ON the player's face
    // (within its radius) — clicking/tapping elsewhere on the canvas does
    // nothing.
    if (Math.sqrt(dx * dx + dy * dy) <= player.radius) isDragging = true;
  },
  onMove: (pos) => {
    if (!isGameStarted || isGameOver || isPlayerExploded || !isDragging) return;
    // Math.max(radius, Math.min(pos, canvas.size - radius)) is a common
    // "clamp" pattern: keeps the player's center at least one radius away
    // from every edge, so the whole circle always stays fully inside the
    // canvas instead of drawing half off the edge.
    player.x = Math.max(player.radius, Math.min(pos.x, canvas.width - player.radius));
    player.y = Math.max(player.radius, Math.min(pos.y, canvas.height - player.radius));
  },
  onEnd: () => { isDragging = false; },
});

const shell = initShell({
  gameId: GAME_ID,
  title: 'JEWELZ',
  emoji: '💎',
  // Same regular jewel image shown on this game's hub tile.
  emojiImage: getJewelIconDataURL(),
  // Buttons colored from this game's own hub-tile palette (games-registry.js's
  // `color`/`rim`) instead of the shared global blue every game used before.
  accentColor: { bg: '#63B98A', ink: '#0A371E', rim: 'rgba(10, 55, 30, 0.30)' },
  instructions: `<p>Move the face ${PLAYER_IMG} with your finger or mouse</p><p>Avoid the bars ${BAR_IMG} to stay alive</p><p>Grab the JEWELZ ${JEWEL_IMG}${BONUS_JEWEL_IMG} to score</p>`,
  // formatScore overrides how the shared footer displays the best score —
  // by default it'd just show the raw number; this appends the jewel image
  // to match how the score is shown everywhere else in this game.
  formatScore: (score) => `${score} ${JEWEL_IMG}`,
});

// Unlike SOLVZ/GLYMPZ, JEWELZ never saves progress mid-round (only once a round
// fully ends — see the saveProgress() call inside animate() above), so
// there's no 'in-progress' status to handle here — a round that gets
// interrupted (browser closed, tab refreshed) simply starts over next time,
// which is normal/expected for this kind of fast-paced action game.
if (shell.status.status === 'completed') {
  // Already played today — restore and display the saved result exactly as
  // it was, without re-running any game logic.
  const { resultLine, seconds, score: finalScore } = shell.status.record.data;
  shell.timer.setSeconds(seconds || 0);
  shell.showEndScreen({ message: resultLine, shareText: `💎💎 JEWELZ — scored ${finalScore} 💎 today!` });
} else {
  drawEverything(); // static preview behind the start banner
  shell.showStartBanner(startGame);
}
