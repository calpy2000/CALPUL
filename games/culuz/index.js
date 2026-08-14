// CULUZ — a Stroop-effect reaction game. Shapes fade in on screen, each
// filled with a colour and labelled with two words (a colour name + a shape
// name) that may or may not actually match what's shown. Tap a shape whose
// label is fully correct to score; tap one that isn't and it costs one of 5
// fails — as does going IDLE_FAIL_THRESHOLD seconds without a tap that
// hits any object at all. A gold star starts appearing once the difficulty
// ramp finishes —
// its colour and label can both lie like any other object's, but tapping
// the *actual* gold star with a correct label is the only thing that wins
// the round outright and scores 100 points; a correctly-labelled decoy of
// another colour just scores 1 point like a normal object, and an
// incorrectly-labelled star (gold or not) costs a fail like any other
// wrong tap.
//
// Ported from a standalone prototype (built and iterated on in isolation
// before this integration — see the prototype's own history for the design
// reasoning behind each rule below) into this hub's shared shell/storage/
// dev-tools conventions, same as every other game here.

import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore } from '../../shared/core/game-storage.js';
import { enableCanvasPointerDrag } from '../../shared/input/canvas-pointer.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { getPentagonIconDataURL } from './tile-icon.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

const GAME_ID = 'culuz';

hidePageLoadingIndicator();
stripReloadParam();

// ---------- Data ----------

const SHAPE_NAMES = ['square', 'circle', 'triangle', 'ellipse', 'rectangle', 'pentagon', 'hexagon', 'octagon', 'diamond'];

// Colours below were jointly re-optimized (not tuned pair-by-pair) so every
// pair in the set — not just the ones a tester happened to flag — clears a
// safe separation margin under protanopia, deuteranopia, and tritanopia
// simulation, in addition to normal vision. blue/black were already fine
// and stayed put; every other value moved. See CULUZ colour-check artifact
// (2026-08-14) for the full before/after and per-vision-type numbers.
const COLOURS = {
  yellow: '#FFFE33',
  orange: '#FC7905',
  red: '#C52E1C',
  pink: '#DF7097',
  blue: '#3E63DD',
  green: '#15A54A',
  purple: '#B938FA',
  black: '#242424',
  brown: '#73341D',
};
const COLOUR_NAMES = Object.keys(COLOURS); // captured before 'gold' is added below, so it's never picked for normal objects
const GOLD = '#F6C445';
COLOURS.gold = GOLD; // usable via COLOURS[...] lookups, but excluded from COLOUR_NAMES/randChoice

// Gold star's own fill/word vocabulary: every normal colour plus the
// exclusive 'gold' itself, minus 'yellow' — yellow and gold read as near-
// identical at a glance (by design, gold is meant to evoke a bright warm
// yellow), so a star that's genuinely yellow-filled-and-correctly-labelled,
// or gold-filled-but-lyingly-labelled-'Yellow', would be a legitimate "that
// looked like the gold star" complaint either way. Dropping yellow from
// this pool entirely avoids the whole ambiguity rather than picking a side.
const GOLD_STAR_COLOUR_NAMES = [...COLOUR_NAMES.filter((n) => n !== 'yellow'), 'gold'];

// Fixed internal canvas resolution (see index.html) — CSS scales the
// element itself, same convention as JEWELZ/WARPZ (see shared/input/
// canvas-pointer.js's header comment for why this makes pointer-coordinate
// conversion trivial and DPR-safe with no extra work here).
const CANVAS_W = 450;
const CANVAS_H = 800;
const BASE_RADIUS = 85;

const FADE_IN_DURATION = 0.7; // seconds, fixed throughout
const FADE_OUT_DURATION = 0.7; // seconds, fixed throughout
const POP_DURATION = 0.5;
const TOTAL_FAILS = 5;
const IDLE_FAIL_THRESHOLD = 10; // seconds — no tapped (hit) object at all costs a fail, same as a wrong tap
const GLOW_BLUR_FACTOR = 0.5; // relative to object radius
const MIN_SPAWN_GAP = 10; // px breathing room between object edges, on top of not overlapping at all

// Difficulty ramp: hold time shrinks, the concurrent-object cap grows,
// spawns get more frequent, and correct/incorrect drifts away from 1:1 —
// all four move linearly with elapsed time and keep moving at the same
// rate past RAMP_DURATION, they do NOT plateau there. RAMP_DURATION is just
// the point each *_START/*_END pair was tuned around (chosen so the cap is
// actually reachable: at that point, HOLD_END / SPAWN_INTERVAL_END ~=
// CONCURRENT_END). HOLD_MIN/SPAWN_INTERVAL_MIN are only safety floors for
// rounds that run far longer than the ramp was tuned for, so the maths
// can't reach zero/negative durations.
const RAMP_DURATION = 180; // seconds (3 minutes)
const HOLD_START = 3.0, HOLD_END = 1.0; // seconds, fully visible ("stays on screen")
const HOLD_MIN = 0.15; // seconds
const CONCURRENT_START = 1, CONCURRENT_END = 6;
const SPAWN_INTERVAL_START = 1.0, SPAWN_INTERVAL_END = 0.5; // seconds, average gap between spawns
const SPAWN_INTERVAL_MIN = 0.1; // seconds
const SPAWN_VARIANCE_FRACTION = 0.3; // +/- 30% of the current interval
const CORRECT_PROBABILITY_START = 0.5, CORRECT_PROBABILITY_END = 1 / 3; // 1:1 -> 2:1 incorrect:correct

// Gold star: a bonus win-condition object, only starts appearing once the
// difficulty ramp finishes. Interval/variance have been halved twice from
// an original 15s +/- 3s (first a 3x request, then a further 2x request),
// scaled together each time so the variance stays the same proportion
// (20%) of the interval.
const GOLD_STAR_INTERVAL_BASE = 2.5; // seconds
const GOLD_STAR_INTERVAL_VARIANCE = 0.5; // +/- seconds

function rampProgress(elapsed) { return Math.max(0, elapsed / RAMP_DURATION); } // uncapped above 1 on purpose — see comment above
function currentHoldDuration(elapsed) {
  const p = rampProgress(elapsed);
  return Math.max(HOLD_MIN, HOLD_START + (HOLD_END - HOLD_START) * p);
}
function currentMaxConcurrent(elapsed) {
  const p = rampProgress(elapsed);
  return Math.max(1, Math.round(CONCURRENT_START + (CONCURRENT_END - CONCURRENT_START) * p));
}
function currentSpawnInterval(elapsed) {
  const p = rampProgress(elapsed);
  const base = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START + (SPAWN_INTERVAL_END - SPAWN_INTERVAL_START) * p);
  return base * randRange(1 - SPAWN_VARIANCE_FRACTION, 1 + SPAWN_VARIANCE_FRACTION);
}
function currentCorrectProbability(elapsed) {
  const p = rampProgress(elapsed);
  return clamp(CORRECT_PROBABILITY_START + (CORRECT_PROBABILITY_END - CORRECT_PROBABILITY_START) * p, 0, 1);
}

// ---------- Utilities ----------

function randRange(min, max) { return min + Math.random() * (max - min); }
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randChoiceExcept(arr, except) {
  const filtered = arr.filter((x) => x !== except);
  return randChoice(filtered);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrastRatio(hexA, hexB) {
  const a = relLuminance(hexA);
  const b = relLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

// Pick two distinct colour names for the two text words: never equal to the
// fill colour, never equal to each other. One word always gets the single
// best-contrast colour available against the fill (some fills, e.g. pink/
// green, only have one genuinely legible option) — the other is randomised
// among the next-best options so there's still variety.
function pickTextColors(fillName) {
  const others = COLOUR_NAMES.filter((n) => n !== fillName);
  const ranked = others
    .map((n) => ({ n, c: contrastRatio(COLOURS[n], COLOURS[fillName]) }))
    .sort((a, b) => b.c - a.c);
  const best = ranked[0].n;
  const secondPool = ranked.slice(1, 4).map((x) => x.n);
  const second = randChoice(secondPool.length ? secondPool : [ranked[1].n]);
  return shuffle([best, second]);
}

// ---------- Shape path builder (also used for hit-testing) ----------

function tracePolygon(ctx, cx, cy, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function traceShape(ctx, shape, cx, cy, r) {
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.18, r * 0.78, 0, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'square':
      ctx.beginPath();
      ctx.rect(cx - r * 0.82, cy - r * 0.82, r * 1.64, r * 1.64);
      ctx.closePath();
      break;
    case 'rectangle':
      ctx.beginPath();
      ctx.rect(cx - r * 1.08, cy - r * 0.7, r * 2.16, r * 1.4);
      ctx.closePath();
      break;
    case 'triangle':
      tracePolygon(ctx, cx, cy, r * 1.12, 3, -Math.PI / 2);
      break;
    case 'pentagon':
      tracePolygon(ctx, cx, cy, r, 5, -Math.PI / 2);
      break;
    case 'hexagon':
      tracePolygon(ctx, cx, cy, r, 6, -Math.PI / 2);
      break;
    case 'octagon':
      tracePolygon(ctx, cx, cy, r * 0.98, 8, -Math.PI / 8);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r * 0.78, cy);
      ctx.lineTo(cx, cy + r * 1.15);
      ctx.lineTo(cx - r * 0.78, cy);
      ctx.closePath();
      break;
    case 'star': {
      const outerR = r * 1.15;
      const innerR = outerR * 0.45;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? outerR : innerR;
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + rad * Math.cos(angle);
        const y = cy + rad * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
  }
}

// ---------- DOM refs ----------

const canvas = document.getElementById('culuzCanvas');
const ctx = canvas.getContext('2d');
const liveScoreEl = document.getElementById('culuzLiveScore');
const failsDiscsEl = document.getElementById('culuzFailsDiscs');

// ---------- Game state ----------

let objects = [];
let score = 0;
let failsUsed = 0;
let isGameStarted = false;
let isGameOver = false; // this ROUND is over (win or lose) — distinct from the daily lock
let didWin = false;
let finalSummaryProcessed = false;
let lastTime = 0;
let gameElapsed = 0;
let idleTimer = 0; // seconds since the last tap that actually hit an object — reset in handleTap(), ticks up in update()
let spawnCooldown = 0;
let wasBelowCap = true;
let goldStarCooldown = 0;
let goldStarArmed = false; // true once we've crossed RAMP_DURATION and armed the first cooldown

function buildFailDiscs() {
  failsDiscsEl.innerHTML = '';
  for (let i = 0; i < TOTAL_FAILS; i++) {
    const d = document.createElement('span');
    d.className = 'culuz-fail-disc';
    failsDiscsEl.appendChild(d);
  }
}

function updateFailsUI() {
  const discs = failsDiscsEl.children;
  for (let i = 0; i < discs.length; i++) {
    discs[i].classList.toggle('used', i < failsUsed);
  }
  // failsUsed only ever increases by 1 per call, so the disc that just
  // flipped to .used is always index failsUsed-1 — no need to diff against
  // the previous state to find it. Guarded for failsUsed===0 (the reset
  // call at round start), where there's nothing to burst.
  const justUsed = discs[failsUsed - 1];
  if (justUsed) spawnFailDiscBurst(justUsed);
}

// Spawns a one-shot flash + shockwave ring + outward particle burst on a
// fail disc the moment it's used — see the .exploding/.culuz-fail-shockwave/
// .culuz-fail-particle rules in style.css for the actual animation.
const FAIL_BURST_COLORS = ['#e5484d', '#ff8a80', '#ffffff'];
function spawnFailDiscBurst(discEl) {
  discEl.classList.remove('exploding');
  void discEl.offsetWidth; // forces a reflow so re-adding the class restarts the animation, in case this ever fires twice on the same disc
  discEl.classList.add('exploding');

  const shockwave = document.createElement('span');
  shockwave.className = 'culuz-fail-shockwave';
  shockwave.addEventListener('animationend', () => shockwave.remove());
  setTimeout(() => shockwave.remove(), 700); // animationend won't fire under prefers-reduced-motion, so back it with a timeout too
  discEl.appendChild(shockwave);

  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + randRange(-0.3, 0.3);
    const dist = randRange(30, 56);
    const particle = document.createElement('span');
    particle.className = 'culuz-fail-particle';
    particle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    particle.style.setProperty('--rot', `${randRange(0, 360)}deg`);
    particle.style.setProperty('--size', `${randRange(3, 8).toFixed(1)}px`);
    particle.style.setProperty('--pcolor', randChoice(FAIL_BURST_COLORS));
    particle.addEventListener('animationend', () => particle.remove());
    setTimeout(() => particle.remove(), 700); // same reduced-motion fallback as the shockwave
    discEl.appendChild(particle);
  }
}

// Returns true if an object was actually spawned. Can fail (returns false)
// if no non-overlapping spot could be found, or no shape/colour is free to
// use — objects must never overlap and never share a shape or colour with
// another alive object, so a failed attempt just means "try again very
// soon" rather than relaxing either constraint.
function spawnObject(elapsed) {
  const r = BASE_RADIUS * randRange(0.9, 1.1);
  const spot = pickSpawnPosition(r);
  if (!spot) return false;

  const alive = objects.filter((o) => o.state === 'alive' && !o.isGoldStar);
  const usedShapes = new Set(alive.map((o) => o.shape));
  const usedColours = new Set(alive.map((o) => o.fillColorName));
  const availableShapes = SHAPE_NAMES.filter((s) => !usedShapes.has(s));
  const availableColours = COLOUR_NAMES.filter((c) => !usedColours.has(c));
  if (availableShapes.length === 0 || availableColours.length === 0) return false;

  const shape = randChoice(availableShapes);
  const fillColorName = randChoice(availableColours);

  let displayColourWord = fillColorName;
  let displayShapeWord = shape;
  const wantsCorrect = Math.random() < currentCorrectProbability(elapsed);
  if (!wantsCorrect) {
    // Exactly one word is wrong, chosen randomly — never both, so an
    // incorrect object always still has one genuinely correct word.
    if (Math.random() < 0.5) {
      displayColourWord = randChoiceExcept(COLOUR_NAMES, fillColorName);
    } else {
      displayShapeWord = randChoiceExcept(SHAPE_NAMES, shape);
    }
  }
  const isCorrect = displayColourWord === fillColorName && displayShapeWord === shape;

  const [word1Color, word2Color] = pickTextColors(fillColorName);

  const hold = currentHoldDuration(elapsed);
  const lifetime = FADE_IN_DURATION + hold + FADE_OUT_DURATION;

  objects.push({
    shape,
    fillColorName,
    displayColourWord,
    displayShapeWord,
    isCorrect,
    word1Color,
    word2Color,
    r,
    x: spot.x,
    y: spot.y,
    lifetime,
    elapsed: 0,
    state: 'alive', // 'alive' | 'popping'
    popElapsed: 0,
    particles: [],
  });
  return true;
}

// Only tapping the *actual* gold star with a correct label wins the game —
// see the isGoldStar branch in popObject() for why a correctly-labelled
// non-gold star doesn't. Same currentCorrectProbability coin flip and
// one-word-wrong rule as normal objects, so it can't be told apart from a
// decoy on sight. The star's actual fill colour varies (not always
// literally gold) — GOLD_STAR_COLOUR_NAMES is the shared fill/word
// vocabulary, so a star can be e.g. genuinely blue-filled and lyingly
// labelled "Gold Star", same as any normal object's colour-word can lie
// about its fill. Shape is always 'star' itself (only the shape *word* can
// lie). Reuses the same rendering/pop/particle pipeline as normal objects
// via COLOURS.gold.
function spawnGoldStar(elapsed) {
  const r = BASE_RADIUS * randRange(0.9, 1.1);
  const spot = pickSpawnPosition(r);
  if (!spot) return false;

  const hold = currentHoldDuration(elapsed);
  const lifetime = FADE_IN_DURATION + hold + FADE_OUT_DURATION;

  const fillColorName = randChoice(GOLD_STAR_COLOUR_NAMES);
  let displayColourWord = fillColorName;
  let displayShapeWord = 'star';
  const wantsCorrect = Math.random() < currentCorrectProbability(elapsed);
  if (!wantsCorrect) {
    if (Math.random() < 0.5) {
      displayColourWord = randChoiceExcept(GOLD_STAR_COLOUR_NAMES, fillColorName);
    } else {
      displayShapeWord = randChoiceExcept(SHAPE_NAMES, 'star');
    }
  }
  const isCorrect = displayColourWord === fillColorName && displayShapeWord === 'star';

  const [word1Color, word2Color] = pickTextColors(fillColorName);

  objects.push({
    shape: 'star',
    fillColorName,
    displayColourWord,
    displayShapeWord,
    isCorrect,
    isGoldStar: true,
    word1Color,
    word2Color,
    r,
    x: spot.x,
    y: spot.y,
    lifetime,
    elapsed: 0,
    state: 'alive',
    popElapsed: 0,
    particles: [],
  });
  return true;
}

// Random stationary spot that never overlaps an already-alive object. Null
// if no such spot can be found after enough attempts (screen too full).
function pickSpawnPosition(r) {
  const margin = r + 12;
  if (CANVAS_W - margin <= margin || CANVAS_H - margin <= margin) return null;
  const alive = objects.filter((o) => o.state === 'alive');
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = randRange(margin, CANVAS_W - margin);
    const y = randRange(margin, CANVAS_H - margin);
    const overlaps = alive.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + r + MIN_SPAWN_GAP);
    if (!overlaps) return { x, y };
  }
  return null;
}

function popObject(obj) {
  if (obj.state !== 'alive') return;
  obj.state = 'popping';
  obj.popElapsed = 0;
  const fillHex = COLOURS[obj.fillColorName];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + randRange(-0.2, 0.2);
    const speed = randRange(90, 230);
    obj.particles.push({
      x: obj.x, y: obj.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      color: fillHex,
    });
  }

  if (obj.isGoldStar) {
    // Winning requires the *actual* gold star, correctly labelled — a
    // correctly-labelled decoy star (e.g. genuinely blue, truthfully
    // labelled "Blue Star") is just a normal safe tap worth 1 point, same
    // as any other correct object. Otherwise the colour-varying decoys
    // would be pointless: any correctly-labelled star would win outright
    // regardless of what colour it actually was.
    if (obj.isCorrect && obj.fillColorName === 'gold') {
      score += 100;
      liveScoreEl.textContent = `Score: ${score}`;
      isGameOver = true;
      didWin = true;
    } else if (obj.isCorrect) {
      score += 1;
      liveScoreEl.textContent = `Score: ${score}`;
    } else {
      failsUsed += 1;
      updateFailsUI();
      if (failsUsed >= TOTAL_FAILS) {
        isGameOver = true;
        didWin = false;
      }
    }
    return;
  }

  if (obj.isCorrect) {
    score += 1;
    liveScoreEl.textContent = `Score: ${score}`;
  } else {
    failsUsed += 1;
    updateFailsUI();
    if (failsUsed >= TOTAL_FAILS) {
      isGameOver = true;
      didWin = false;
    }
  }
}

// ---------- Input ----------

function handleTap(x, y) {
  if (!isGameStarted || isGameOver) return;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.state !== 'alive') continue;
    const hitR = obj.r * 1.05;
    if ((x - obj.x) ** 2 + (y - obj.y) ** 2 <= hitR * hitR) {
      idleTimer = 0; // only a tap that actually hits an object counts — see IDLE_FAIL_THRESHOLD
      popObject(obj);
      break;
    }
  }
}

enableCanvasPointerDrag({
  canvas,
  onStart: (pos) => handleTap(pos.x, pos.y),
});

// ---------- Update / draw ----------

function update(dt) {
  if (isGameStarted && !isGameOver) {
    gameElapsed += dt;
    shell.timer.setSeconds(gameElapsed); // keeps the shared header timer updated live, every frame — same pattern as WARPZ/JEWELZ/RAINZ
    const cap = currentMaxConcurrent(gameElapsed);
    const aliveCount = objects.filter((o) => o.state === 'alive').length;
    const belowCap = aliveCount < cap;

    // A slot just became available (or the cap just grew): arm a fresh
    // full gap rather than resuming whatever cooldown was left over from
    // before, so "N seconds between objects" holds even at cap 1.
    if (belowCap && !wasBelowCap) {
      spawnCooldown = currentSpawnInterval(gameElapsed);
    }
    if (belowCap) {
      spawnCooldown -= dt;
      if (spawnCooldown <= 0) {
        const spawned = spawnObject(gameElapsed);
        spawnCooldown = spawned ? currentSpawnInterval(gameElapsed) : 0.15; // couldn't find room, retry shortly
      }
    }
    wasBelowCap = belowCap;

    // Gold star: independent schedule, only starts once the ramp finishes.
    if (gameElapsed >= RAMP_DURATION) {
      if (!goldStarArmed) {
        goldStarArmed = true;
        goldStarCooldown = GOLD_STAR_INTERVAL_BASE + randRange(-GOLD_STAR_INTERVAL_VARIANCE, GOLD_STAR_INTERVAL_VARIANCE);
      }
      const goldStarAlive = objects.some((o) => o.state === 'alive' && o.isGoldStar);
      if (!goldStarAlive) {
        goldStarCooldown -= dt;
        if (goldStarCooldown <= 0) {
          const spawned = spawnGoldStar(gameElapsed);
          goldStarCooldown = spawned
            ? GOLD_STAR_INTERVAL_BASE + randRange(-GOLD_STAR_INTERVAL_VARIANCE, GOLD_STAR_INTERVAL_VARIANCE)
            : 0.15; // couldn't find room, retry shortly
        }
      }
    }

    // Idle penalty: going IDLE_FAIL_THRESHOLD seconds without a tap that
    // actually hit an object costs a fail, same as a wrong tap — checked
    // last in this block (after this frame's own spawn logic already ran)
    // so a fail triggered here can't leave one extra object spawned into an
    // already-over round.
    idleTimer += dt;
    if (idleTimer >= IDLE_FAIL_THRESHOLD) {
      idleTimer = 0;
      failsUsed += 1;
      updateFailsUI();
      if (failsUsed >= TOTAL_FAILS) {
        isGameOver = true;
        didWin = false;
      }
    }
  }

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.state === 'alive') {
      obj.elapsed += dt;
      if (obj.elapsed >= obj.lifetime) {
        objects.splice(i, 1);
        continue;
      }
    } else if (obj.state === 'popping') {
      obj.popElapsed += dt;
      obj.particles.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life += dt;
      });
      if (obj.popElapsed >= POP_DURATION) {
        objects.splice(i, 1);
      }
    }
  }
}

function alphaFor(obj) {
  const e = obj.elapsed;
  if (e < FADE_IN_DURATION) return e / FADE_IN_DURATION;
  const fadeOutStart = obj.lifetime - FADE_OUT_DURATION;
  if (e > fadeOutStart) return 1 - (e - fadeOutStart) / FADE_OUT_DURATION;
  return 1;
}

function drawObject(obj) {
  const alpha = alphaFor(obj);
  ctx.save();
  ctx.globalAlpha = alpha;

  traceShape(ctx, obj.shape, obj.x, obj.y, obj.r);
  ctx.fillStyle = COLOURS[obj.fillColorName];
  ctx.shadowColor = COLOURS[obj.fillColorName];
  ctx.shadowBlur = obj.r * GLOW_BLUR_FACTOR;
  ctx.fill();
  ctx.shadowBlur = 0;

  const fontSize = Math.max(11, obj.r * 0.25);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 ' + fontSize + 'px ' + FONT_STACK;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 3;

  ctx.fillStyle = COLOURS[obj.word1Color];
  ctx.fillText(obj.displayColourWord, obj.x, obj.y - fontSize * 0.62);
  ctx.fillStyle = COLOURS[obj.word2Color];
  ctx.fillText(obj.displayShapeWord, obj.x, obj.y + fontSize * 0.62);

  ctx.restore();
}

function drawParticles(obj) {
  // Grows from zero across the whole pop duration, then fades fast right
  // at the end (last quarter) rather than fading evenly throughout.
  const growth = clamp(obj.popElapsed / POP_DURATION, 0, 1);
  const scale = 1 - (1 - growth) * (1 - growth); // ease-out quad
  const FADE_START = 0.75;
  const iconAlpha = growth > FADE_START ? clamp(1 - (growth - FADE_START) / (1 - FADE_START), 0, 1) : 1;

  const isWinningTap = obj.isGoldStar && obj.isCorrect && obj.fillColorName === 'gold';
  const glyph = isWinningTap ? '100' : obj.isCorrect ? '✓' : '✗';
  const sizeFactor = isWinningTap ? 0.45 : 0.65; // '100' is 3 characters wide, so it needs a smaller factor than a single glyph to read at a comparable size

  ctx.save();
  ctx.globalAlpha = iconAlpha;
  ctx.fillStyle = obj.isCorrect ? '#2ecc71' : '#ff5555';
  ctx.font = '700 ' + (obj.r * sizeFactor * scale) + 'px ' + FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, obj.x, obj.y);
  ctx.restore();

  obj.particles.forEach((p) => {
    const life = clamp(1 - p.life / POP_DURATION, 0, 1);
    ctx.save();
    ctx.globalAlpha = life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * life + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

const FONT_STACK = "'Quicksand', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  objects.forEach((obj) => {
    if (obj.state === 'alive') drawObject(obj);
    else drawParticles(obj);
  });
}

function animate(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();

  if (isGameOver && !objects.some((o) => o.state === 'popping') && !finalSummaryProcessed) {
    finishRound();
    return;
  }

  requestAnimationFrame(animate);
}

function classifyOutcome(won) {
  return won ? 'max' : 'loss';
}

function finishRound() {
  finalSummaryProcessed = true;

  const result = submitScore(GAME_ID, score, { higherIsBetter: true });
  saveTodayScore(GAME_ID, score);
  const outcome = classifyOutcome(didWin);
  const hasMeaningfulBest = result.previousBest !== null && result.previousBest !== 0;
  const isNewBest = hasMeaningfulBest && result.isNewBest;
  saveProgress(GAME_ID, { score, panelOutcome: outcome, panelIsNewBest: isNewBest }, { completed: true });
  saveTodayOutcome(GAME_ID, {
    revealed: false, usedHelp: false, failed: !didWin,
    isNewBest: result.isNewBest, isTie: result.isTie,
    panelOutcome: outcome, panelIsNewBest: isNewBest,
  });

  liveScoreEl.textContent = '';
  document.getElementById('culuzInfoRow').classList.add('is-hidden');
  shell.showEndScreen({
    outcome,
    scoreText: String(score),
    isNewBest,
    shareText: `🔷 CULUZ - scored ${score} points today`,
    celebrate: didWin,
    score,
  });
}

function startGame() {
  document.getElementById('culuzInfoRow').classList.remove('is-hidden');
  objects = [];
  score = 0;
  failsUsed = 0;
  isGameStarted = true;
  isGameOver = false;
  didWin = false;
  finalSummaryProcessed = false;
  gameElapsed = 0;
  idleTimer = 0;
  spawnCooldown = randRange(0.3, SPAWN_INTERVAL_START);
  wasBelowCap = true;
  goldStarCooldown = 0;
  goldStarArmed = false;
  updateFailsUI();

  liveScoreEl.textContent = `Score: ${score}`;
  lastTime = performance.now();
  requestAnimationFrame(animate);
}

// ---------- Dev tools ----------

initToolsPanel([GAME_ID], {
  extraActions: [
    // Reaching either ending by actually playing (5 mistaken taps, or
    // waiting a full 3 minutes for the gold star) isn't practical to do by
    // hand for every test pass — same reasoning as WARPZ/JEWELZ's own
    // "force game over" dev shortcut.
    {
      label: 'Skip to 3:00 (stars)',
      onClick: () => {
        if (!isGameStarted || isGameOver) return;
        gameElapsed = RAMP_DURATION;
        shell.timer.setSeconds(gameElapsed); // update() also does this every frame, but set it immediately so the header doesn't lag a frame behind the jump
      },
    },
    {
      label: 'Force win',
      onClick: () => {
        if (!isGameStarted || isGameOver) return;
        isGameOver = true;
        didWin = true;
      },
    },
    {
      label: 'Force game over',
      onClick: () => {
        if (!isGameStarted || isGameOver) return;
        isGameOver = true;
        didWin = false;
      },
    },
  ],
});

// ---------- Shell ----------

buildFailDiscs();

const shell = initShell({
  gameId: GAME_ID,
  title: 'CULUZ',
  emojiImage: getPentagonIconDataURL(),
  accentColor: { bg: '#46A06A', ink: '#0B3320', rim: 'rgba(10, 45, 25, 0.30)' },
  instructions: `<p>Look closely at each shape</p><p>If the text matches what you see, tap to score</p><p>If it doesn't match, leave it alone</p><p>You have 5 chances to fail, but don't hang around - if you wait more than 10 seconds to tap that is a fail</p><p>Tap on a correct gold star ⭐ to earn <strong>100 pts</strong> and win the game</p>`,
  formatScore: (s) => `${s} pts`,
});

if (shell.status.status === 'completed') {
  document.getElementById('culuzInfoRow').classList.add('is-hidden');
  const { score: finalScore, panelOutcome, panelIsNewBest } = shell.status.record.data;
  shell.showEndScreen({
    outcome: panelOutcome,
    scoreText: String(finalScore),
    isNewBest: panelIsNewBest || false,
    shareText: `🔷 CULUZ - scored ${finalScore} points today`,
  });
} else {
  draw(); // static empty canvas behind the start banner
  shell.showStartBanner(startGame);
}
