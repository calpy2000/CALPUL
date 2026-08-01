// RAINZ — letters fall as raindrops down a canvas; tap one to catch its
// letter into a 4-tile grid below. Fill all 4 with a real word to score a
// point (and blow up the raindrops that spelled it); get it wrong and
// those same raindrops just go back to falling, still catchable. The game
// ends the instant ANY raindrop — caught or not — touches the bottom.
// (Originally 5-letter words, using SLYDZ's word list — reverted to
// 4-letter, using QUADZ's word list instead, after playtesting found
// 5-letter words too hard to spell one falling drop at a time.)
//
// Closest existing game: JEWELZ & JEWELZ (games/jewelz/index.js) — same
// canvas-drawn, one-continuous-attempt-per-day, "dies" on a collision
// shape. RAINZ reuses that whole architecture (game loop, particle/
// explosion system, shell wiring) almost verbatim; the input model mixes
// both of JEWELZ's ideas — a tap directly catches a falling raindrop, but
// the row of umbrellas along the bottom can be dragged (mouse or touch)
// like JEWELZ's own character, and bursts any raindrop it touches (see
// isPointInUmbrella/checkUmbrellaCollisions and the enableCanvasPointerDrag
// wiring near the bottom of this file).

import Raindrop from './Raindrop.js';
import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome } from '../../shared/core/game-storage.js';
import { enableCanvasPointerDrag } from '../../shared/input/canvas-pointer.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { ALL_WORDS } from './words.js';
import { getHeaderIconDataURL, getTileIconDataURL, getWildcardIconDataURL, WILDCARD_LETTER } from './raindrop-icon.js';
import { drawUmbrella, getUmbrellaIconDataURL } from './umbrella-icon.js';
import { hidePageLoadingIndicator } from '../../shared/core/loading-indicator.js';

hidePageLoadingIndicator();

const GAME_ID = 'rainz';
const WORD_LENGTH = 4;

// Inline images for the instructions text (see initShell's `instructions`
// below) — same pattern as games/jewelz/index.js's PLAYER_IMG/BAR_IMG/
// JEWEL_IMG, so the umbrella/wildcard features are explained with the
// actual game art rather than a plain-text emoji stand-in.
const LETTER_DROP_IMG = `<img src="${getTileIconDataURL(1)}" alt="letter raindrop" class="rainz-inline-icon">`;
const WILDCARD_IMG = `<img src="${getWildcardIconDataURL()}" alt="wildcard raindrop" class="rainz-inline-icon">`;
const UMBRELLA_IMG = `<img src="${getUmbrellaIconDataURL()}" alt="umbrella" class="rainz-inline-icon">`;

// A Set gives O(1) "is this a real word?" lookups — see games/slydz/index.js
// for the fuller explanation of why this matters (~5,469 entries here,
// copied from QUADZ — see words.js's own header comment).
const ALL_WORDS_SET = new Set(ALL_WORDS);

const canvas = document.getElementById('responsiveCanvas');
const ctx = canvas.getContext('2d');
const liveScoreEl = document.getElementById('liveScore');

// Builds the 5 tile <div>s once, up front — plain vanilla DOM (no jQuery,
// matching JEWELZ's style, since this file is all Canvas + a handful of
// simple elements rather than DOM-heavy tile dragging).
const tilesContainer = document.getElementById('rainz-tiles');
const tileEls = [];
for (let i = 0; i < WORD_LENGTH; i++) {
  const el = document.createElement('div');
  el.className = 'rainz-tile';
  tilesContainer.appendChild(el);
  tileEls.push(el);
}

// --- Game state --- (same "plain top-level variables" approach as JEWELZ)
let isGameStarted = false;
let isGameOver = false;
let lastTime = performance.now();

let survivalTime = 0; // shown in the shared header timer, same as JEWELZ's survival time
let score = 0; // words formed this round
let finalSummaryProcessed = false; // same guard as JEWELZ's — flips once, stops the loop for good

let raindrops = [];
let particles = []; // reuses JEWELZ's diamond-shaped explosion particles verbatim

// A row of umbrellas along the canvas bottom — the "Classic Solid" concept
// the user picked from the umbrella-options gallery. Each is a {x, y, r,
// palette} object (not a fused image) that the player can drag anywhere on
// the canvas (see the drag wiring near enableCanvasPointerDrag below); on
// release it just stays put, clamped so it can never end up partly off-
// screen. If any falling (not-yet-caught) raindrop touches an umbrella —
// whether the raindrop fell into it or the player dragged the umbrella
// into the raindrop's path — both explode and are removed from play (see
// checkUmbrellaCollisions()). Rebuilt fresh (back to the default row, full
// count) at the start of every round.
const UMBRELLA_R = 24;
const UMBRELLA_COUNT = 8;
let umbrellas = [];
function createDefaultUmbrellas() {
  const list = [];
  const laneW = canvas.width / UMBRELLA_COUNT;
  for (let i = 0; i < UMBRELLA_COUNT; i++) {
    list.push({
      x: laneW * (i + 0.5),
      y: canvas.height - UMBRELLA_R * 1.6 - 10, // leaves room for the handle/hook below + a little bottom padding
      r: UMBRELLA_R,
      palette: Raindrop.PALETTE[i % Raindrop.PALETTE.length],
    });
  }
  return list;
}
umbrellas = createDefaultUmbrellas();

// The umbrella currently being dragged (null when none) — dragOffset keeps
// the umbrella's position stable relative to where within it the player
// first pressed, rather than snapping its center to the pointer.
let draggedUmbrella = null;
let dragOffset = { x: 0, y: 0 };

// A generous rectangle covering the whole umbrella (canopy + finial +
// hanging handle/hook), used both for "did the drag start on this
// umbrella?" hit-testing and could double for other future interactions.
function isPointInUmbrella(u, x, y) {
  return (
    x >= u.x - u.r && x <= u.x + u.r &&
    y >= u.y - u.r * 1.25 && y <= u.y + u.r * 1.65
  );
}

// Checks every umbrella against every not-yet-caught raindrop; a collision
// bursts both (particles at each one's own position/color) and removes
// them from play. Only unclicked drops are eligible — one that's already
// been caught into the tile grid is mid-word (see catchDrop()/tiles) and
// popping it out from under resolveWord() would leave a dangling
// reference, so those are left alone here.
function checkUmbrellaCollisions() {
  for (let i = umbrellas.length - 1; i >= 0; i--) {
    const umbrella = umbrellas[i];
    for (let j = raindrops.length - 1; j >= 0; j--) {
      const drop = raindrops[j];
      if (drop.clicked) continue;
      const dx = drop.x - umbrella.x;
      const dy = drop.y - umbrella.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= drop.radius + umbrella.r * 0.85) {
        createExplosion(drop.x, drop.y, drop.palette.deep, 4, 14);
        createExplosion(umbrella.x, umbrella.y, umbrella.palette.deep, 5, 18);
        raindrops.splice(j, 1);
        umbrellas.splice(i, 1);
        break; // this umbrella is gone — stop checking it against other drops
      }
    }
  }
}

let spawnTimer = 0;
let nextSpawnIn = randomBetween(2.2, 3.5); // seconds until the next raindrop spawns — widened again per playtesting feedback (too many overlapping drops)

// --- Difficulty ramp (the user's own names for these, used while tuning) ---
// For the first START_PERIOD seconds of a round, every new raindrop spawns
// at its normal speed. After that, each NEW raindrop spawned is SPEED_FACTOR
// times faster than the previous new one — a compounding ramp (5% on top
// of 5% on top of 5%, ...), not a one-off bump — so the game keeps getting
// harder the longer a round runs. Both values are deliberately small/simple
// for now; expect them to get tuned.
const START_PERIOD = 10; // seconds before the ramp begins
const SPEED_FACTOR = 1.0196875; // each post-ramp spawn is 1.96875% faster than the last (2.625% reduced 25% per follow-up feedback)
let speedMultiplier = 1; // compounds once survivalTime passes START_PERIOD; reset in startGame()

// As drops fall faster, each one also crosses the screen faster — without
// spawning them more often too, the number actually on screen at once
// would keep dropping the longer a round runs, leaving fewer and fewer
// letters to work with right when the game is hardest. Scaling the spawn
// interval down as speedMultiplier climbs keeps the average on-screen
// count from collapsing — the same relationship Little's Law describes
// for a queue: arrival rate should scale with service rate to hold the
// average number "in the system" steady.
//
// An earlier version divided the interval directly by speedMultiplier,
// which (even with a floor) still let the on-screen count climb without
// bound — since compounding is tied to spawn COUNT (see SPEED_FACTOR
// above), spawning more often also means speedMultiplier itself compounds
// more often per second, which shrinks the interval further, in a
// snowballing feedback loop. Two changes fix this without needing a manual
// "how much to hold it back by" dial:
//
// 1. Using the SQUARE ROOT of speedMultiplier instead of speedMultiplier
//    itself — spawn rate still tracks speed (auto-adjusts, no separate
//    tuning constant), just much more gently, which on its own turns the
//    runaway into an ordinary bounded exponential instead of a blowup.
// 2. A soft-then-hard cap on how many raindrops are ever on screen at
//    once (see MAX_RAINDROPS/SOFT_CAP_START below) — belt-and-braces, so
//    the overlap guideline (see pickNonOverlappingX) is never straining
//    against dozens of simultaneous drops regardless of how the speed
//    ramp plays out.
const MIN_SPAWN_INTERVAL = 0.5;
const MAX_RAINDROPS = 25; // hard cap — animate()'s spawn check below simply skips spawning at/above this
const SOFT_CAP_START = 20; // count at which introduction starts easing off, reaching MAX_RAINDROPS' worth of slowdown by MAX_RAINDROPS itself

function randomSpawnInterval() {
  const base = randomBetween(2.2, 3.5) / Math.sqrt(speedMultiplier);

  // Ramps linearly from 1x (no slowdown) at SOFT_CAP_START up to 10x
  // (a much longer wait) right at MAX_RAINDROPS, so introduction eases off
  // smoothly as the canvas fills up rather than spawning at full speed
  // right up to the hard cap and then stopping dead.
  const count = raindrops.length;
  const softCapT = Math.min(1, Math.max(0, (count - SOFT_CAP_START) / (MAX_RAINDROPS - SOFT_CAP_START)));
  const softCapMultiplier = 1 + softCapT * 9;

  return Math.max(MIN_SPAWN_INTERVAL, base * softCapMultiplier);
}

// The 5-tile grid's current contents — each slot is either `null` (empty)
// or the actual Raindrop instance that was caught into it, in click order.
// Keeping the instance (not just its letter) is what lets resolveWord()
// explode/revert the EXACT raindrops that formed this attempt.
let tiles = new Array(WORD_LENGTH).fill(null);
let resolving = false; // true while a completed word's flash/explode animation is playing — blocks new catches

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Computed directly from this game's own words.js (every valid 4-letter
// word, ALL_WORDS — 5,469 words / 21,876 total letters): each letter's own
// share of every letter across the whole list. Previously only vowels were
// frequency-weighted (consonants stayed uniform among themselves) — this
// extends the same idea to all 26 letters, so e.g. E/A/S/O (each ~8-10%)
// show up far more than Q/X/J/Z (each under 1%), matching real 4-letter
// words rather than a flat 1/26 for every consonant.
const LETTER_WEIGHTS = [
  { letter: 'A', weight: 0.0954 },
  { letter: 'B', weight: 0.0268 },
  { letter: 'C', weight: 0.0267 },
  { letter: 'D', weight: 0.0379 },
  { letter: 'E', weight: 0.0952 },
  { letter: 'F', weight: 0.0220 },
  { letter: 'G', weight: 0.0283 },
  { letter: 'H', weight: 0.0286 },
  { letter: 'I', weight: 0.0583 },
  { letter: 'J', weight: 0.0065 },
  { letter: 'K', weight: 0.0300 },
  { letter: 'L', weight: 0.0515 },
  { letter: 'M', weight: 0.0329 },
  { letter: 'N', weight: 0.0439 },
  { letter: 'O', weight: 0.0773 },
  { letter: 'P', weight: 0.0341 },
  { letter: 'Q', weight: 0.0011 },
  { letter: 'R', weight: 0.0543 },
  { letter: 'S', weight: 0.0849 },
  { letter: 'T', weight: 0.0508 },
  { letter: 'U', weight: 0.0423 },
  { letter: 'V', weight: 0.0104 },
  { letter: 'W', weight: 0.0217 },
  { letter: 'X', weight: 0.0039 },
  { letter: 'Y', weight: 0.0281 },
  { letter: 'Z', weight: 0.0073 },
];

// A/E/I/O/U, tagged separately from the rest of LETTER_WEIGHTS so their
// combined share of spawns can be tuned independently of the raw word-
// frequency numbers above — see VOWEL_RATIO right below (the user's own
// name for this dial, to reuse while tuning — same convention as this
// file's START_PERIOD/SPEED_FACTOR).
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// Multiplies every vowel's raw weight before EFFECTIVE_LETTER_WEIGHTS
// renormalizes the whole table back to summing to 1. 1 leaves the pure
// word-frequency distribution alone (vowels are already ~36.9% of every
// letter across words.js's own word list, verified directly against it);
// >1 pushes vowels to appear more often than that raw share, <1 less.
// Adjust this one number to change the vowel/consonant mix — no other
// code here needs to change.
const VOWEL_RATIO = 1;

// LETTER_WEIGHTS scaled by VOWEL_RATIO (vowels only) and renormalized so
// the weights still sum to 1 — computed once, since VOWEL_RATIO is a
// fixed constant for now rather than something that changes mid-game.
const EFFECTIVE_LETTER_WEIGHTS = (() => {
  const scaled = LETTER_WEIGHTS.map(({ letter, weight }) => ({
    letter,
    weight: VOWELS.has(letter) ? weight * VOWEL_RATIO : weight,
  }));
  const total = scaled.reduce((sum, { weight }) => sum + weight, 0);
  return scaled.map(({ letter, weight }) => ({ letter, weight: weight / total }));
})();

function randomLetter() {
  let r = Math.random();
  for (const { letter, weight } of EFFECTIVE_LETTER_WEIGHTS) {
    if (r < weight) return letter;
    r -= weight;
  }
  return EFFECTIVE_LETTER_WEIGHTS[EFFECTIVE_LETTER_WEIGHTS.length - 1].letter; // floating-point fallback
}

// A small hand-picked list of common, easily-recognizable 4-letter words —
// used only to build the "guaranteed word" below, rather than picking any
// of the ~5,469 entries in words.js (which includes far more obscure ones
// like "AAHS"/"ABAC"/"ABOS"). Filtered against ALL_WORDS_SET at round start
// so the pick still validates against the game's own word list.
const COMMON_WORDS = [
  'RAIN', 'GAME', 'PLAY', 'LOVE', 'TIME', 'WORD', 'BLUE', 'STAR', 'FISH', 'BIRD',
  'TREE', 'BOOK', 'DOOR', 'MOON', 'SNOW', 'WIND', 'FIRE', 'GOLD', 'WAVE', 'LEAF',
  'SAND', 'ROCK', 'LAKE', 'HILL', 'ROAD', 'SHIP', 'KING', 'SOUP', 'CAKE', 'MILK',
  'RICE', 'CORN', 'BEAN', 'MEAT', 'FARM', 'BARN', 'DUCK', 'FROG', 'LION', 'BEAR',
  'WOLF', 'DEER', 'GOAT', 'CRAB', 'CLAM', 'SHOE', 'HAND', 'FOOT', 'HEAD', 'FACE',
  'EYES', 'EARS', 'HAIR', 'BONE', 'SKIN', 'SOFT', 'HARD', 'FAST', 'SLOW', 'COLD',
  'WARM', 'DARK', 'PINK', 'GRAY', 'JUMP', 'WALK', 'TALK', 'SING', 'RIDE', 'SWIM',
  'DIVE', 'ROAR', 'HOWL', 'PURR', 'WISH', 'HOPE', 'KIND', 'GOOD', 'NICE', 'EASY',
  'BUSY', 'LAZY', 'WILD', 'TAME', 'LOUD', 'OPEN', 'SHUT', 'PUSH', 'PULL', 'SPIN',
  'TURN', 'STOP', 'GLOW',
];

// EVERY set of BATCH_SIZE consecutively-spawned raindrops (1-5, 6-10,
// 11-15, ... — not just the first batch of a round) is seeded so a real,
// common 4-letter word is always spellable from among them — pure
// independent random letters (plain randomLetter()) could otherwise hand a
// player a batch with no valid word in it at all, purely by bad luck.
// Since tiles fill in CLICK order (not spawn order — see catchDrop()), a
// player can catch the word's 4 drops in whatever order they appear on
// screen and still spell it correctly, no matter where among the batch
// they land or which filler letter(s) accompany them. (6 letters per batch
// reduced to 5 — i.e. only 1 filler letter now, not 2 — per follow-up
// feedback.)
const BATCH_SIZE = 5;

function buildBatchLetters() {
  const validCommonWords = COMMON_WORDS.filter((w) => ALL_WORDS_SET.has(w));
  const pool = validCommonWords.length > 0 ? validCommonWords : ALL_WORDS;
  const word = pool[Math.floor(Math.random() * pool.length)];
  const fillerCount = BATCH_SIZE - word.length;
  const letters = [...word];
  for (let i = 0; i < fillerCount; i++) letters.push(randomLetter());
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  // Logged for testing — lets you confirm (via devtools) which word is
  // guaranteed to be spellable from the next batch of raindrops, and in
  // what shuffled order their letters will actually spawn.
  console.log(`RAINZ: next ${BATCH_SIZE} raindrops (${letters.join('')}) guarantee the word "${word}"`);
  return letters;
}

// The current batch of letters and how far into it spawnRaindrop() has
// gotten — nextRaindropLetter() below hands out one per call and builds a
// fresh batch (a fresh guaranteed word) the instant the previous one runs
// out, so this repeats for the whole round, not just its opening spawns.
// Reset in startGame() by just emptying the array — the very first call
// naturally builds batch 1 since indexInBatch(0) >= length(0).
let currentBatchLetters = [];
let indexInBatch = 0;
function nextRaindropLetter() {
  if (indexInBatch >= currentBatchLetters.length) {
    currentBatchLetters = buildBatchLetters();
    indexInBatch = 0;
  }
  return currentBatchLetters[indexInBatch++];
}

// Wildcards spawn 1-in-10 raindrops on average, but that target itself
// jitters ±50% per spawn decision (0.05-0.15 instead of a flat 0.1) rather
// than every spawn rolling against the exact same fixed probability — this
// is the same "average X, but each instance varies" spirit as a raindrop's
// own ±30% speed factor. Overriding a batch letter to a wildcard AFTER
// nextRaindropLetter() has already accounted for it can only ever make the
// batch's guaranteed word EASIER to spell (a wildcard matches whatever
// letter it replaced too), so it never breaks that guarantee.
const WILDCARD_BASE_FREQUENCY = 0.1; // 1 in 10, on average
function isWildcardSpawn() {
  const jitter = 0.5 + Math.random(); // 0.5x-1.5x
  return Math.random() < WILDCARD_BASE_FREQUENCY * jitter;
}

// A word can contain any number of wildcard letters (see WILDCARD_LETTER)
// — each one can stand in for any A-Z, independently, so "G*A*" should
// match "GOAL" just as validly as "*ORM" matches "FORM" or two wildcards
// together match e.g. "G*A*" -> "GOAL". Recurses one wildcard at a time
// (trying all 26 letters at the FIRST '*' found, then recursing on what's
// left) so multiple wildcards in the same word are all covered — cheap
// even in the worst case (26^n for n wildcards, and n is at most 4).
function isValidWordWithWildcards(word) {
  const wildcardIndex = word.indexOf(WILDCARD_LETTER);
  if (wildcardIndex === -1) return ALL_WORDS_SET.has(word);
  for (let code = 65; code <= 90; code++) { // 'A'-'Z'
    const candidate = word.slice(0, wildcardIndex) + String.fromCharCode(code) + word.slice(wildcardIndex + 1);
    if (isValidWordWithWildcards(candidate)) return true;
  }
  return false;
}

// Same particle burst helper as games/jewelz/index.js's createExplosion() —
// generic, not JEWELZ-specific, so it's copied here verbatim rather than
// imported cross-game (matching this project's convention that each game
// owns its own files).
function createExplosion(startX, startY, color, size, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + (Math.random() * 0.5);
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: startX, y: startY,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color, size, alpha: 1, life: 1.0,
    });
  }
}

// A raindrop's x never changes after it spawns (see Raindrop.js's update()
// — only y moves), so two drops can NEVER collide unless their x's are
// within a diameter of each other; if they aren't, they stay in their own
// vertical column for their whole fall no matter how their speeds differ.
// MIN_RAINDROP_SEPARATION is exactly one full diameter — the minimum at
// which two drops just touch without actually overlapping (no extra
// breathing room beyond that, per the user's request to reduce the margin
// to zero) — and pickNonOverlappingX() below searches for a spawn x that
// clears every CURRENTLY on-screen drop by at least that much, guaranteeing
// no future overlap is even possible, not just "probably fine." Only falls
// back to a plain random x (overlap possible) when the canvas is so full of
// drops that no gap that wide is left anywhere — the outlier case the user
// described.
const MIN_RAINDROP_SEPARATION = Raindrop.BASE_RADIUS * 2;

// Finds every gap between currently on-screen drops (sorted left to right,
// bracketed by the canvas's own spawn bounds so the space before the
// first drop and after the last one count too) that's wide enough to fit
// a new drop at least MIN_RAINDROP_SEPARATION from BOTH neighbors, then
// picks uniformly at random from a random qualifying gap. This is
// exhaustive (checks every actual gap), not random guessing, so it finds
// a valid spot whenever ANY exists — a random-sampling search could
// plausibly miss a real-but-narrow gap by chance and wrongly conclude
// there wasn't one.
function pickNonOverlappingX(margin) {
  const lo = margin;
  const hi = canvas.width - margin;
  const sep = MIN_RAINDROP_SEPARATION;
  const existingXs = raindrops.map((drop) => drop.x).sort((a, b) => a - b);
  const points = [lo - sep, ...existingXs, hi + sep];

  const candidateRanges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const rangeLo = Math.max(lo, points[i] + sep);
    const rangeHi = Math.min(hi, points[i + 1] - sep);
    if (rangeHi >= rangeLo) candidateRanges.push([rangeLo, rangeHi]);
  }

  if (candidateRanges.length === 0) {
    // No gap anywhere is wide enough — the canvas is genuinely saturated
    // with drops. Falling back to a plain random x; some overlap here is
    // truly unavoidable, exactly the outlier case described.
    return randomBetween(lo, hi);
  }
  const [rangeLo, rangeHi] = candidateRanges[Math.floor(Math.random() * candidateRanges.length)];
  return randomBetween(rangeLo, rangeHi);
}

let lastPaletteIndex = null;

function pickPaletteIndex() {
  const paletteCount = Raindrop.PALETTE.length;
  if (paletteCount <= 1) return 0;
  let index;
  do {
    index = Math.floor(Math.random() * paletteCount);
  } while (index === lastPaletteIndex);
  lastPaletteIndex = index;
  return index;
}

function spawnRaindrop() {
  // Every drop is exactly BASE_RADIUS now (size no longer varies — see
  // Raindrop.js), so that alone is a safe margin to keep a drop from
  // spawning partly off the left/right edge.
  const margin = Raindrop.BASE_RADIUS;
  const x = pickNonOverlappingX(margin);
  // Always pulls from the batch first (so batch boundaries/progression stay
  // exactly as before), THEN may override the result to a wildcard — never
  // skips a batch slot, since that would silently stall the guaranteed-word
  // batching instead of just replacing this one drop.
  const batchLetter = nextRaindropLetter();
  const letter = isWildcardSpawn() ? WILDCARD_LETTER : batchLetter;
  const drop = new Raindrop(x, letter, pickPaletteIndex());

  // See the difficulty-ramp comment near speedMultiplier's declaration —
  // once past START_PERIOD, every spawn compounds the multiplier further
  // before applying it, so each new drop is faster than the previous one.
  if (survivalTime >= START_PERIOD) {
    speedMultiplier *= SPEED_FACTOR;
  }
  drop.speed *= speedMultiplier;

  raindrops.push(drop);
}

// Finds the next empty tile slot and fills it with this raindrop's letter
// — called the moment a tap lands on an uncaught drop (see the
// enableCanvasPointerDrag wiring near the bottom of this file).
function catchDrop(drop) {
  drop.clicked = true; // stops it from being hit-testable again, switches its rendering to grey

  const emptyIndex = tiles.findIndex((t) => t === null);
  tiles[emptyIndex] = drop;
  tileEls[emptyIndex].textContent = drop.letter;
  tileEls[emptyIndex].classList.add('filled');

  if (emptyIndex === WORD_LENGTH - 1) {
    resolveWord();
  }
}

// Tapping an already-caught (grey) raindrop is a reset action — every grey
// drop on screen reverts to catchable and the answer grid clears back to
// empty, giving the player an escape hatch from a bad catch without
// waiting for a full invalid-word resolution.
function resetCaughtDrops() {
  raindrops.forEach((drop) => { drop.clicked = false; });
  tileEls.forEach((el) => {
    el.textContent = '';
    el.classList.remove('filled', 'flash-success', 'flash-fail', 'exploding');
  });
  tiles = new Array(WORD_LENGTH).fill(null);
}

// Runs the instant the 5th tile fills in: checks the word, then plays the
// success/fail flash + explode-clear sequence described in the design
// brief. `resolving` blocks new catches for the ~850ms this takes so a
// fresh word can't start filling in on top of the one being resolved.
function resolveWord() {
  resolving = true;
  const word = tiles.map((d) => d.letter).join('');
  const isValid = isValidWordWithWildcards(word);
  const caughtDrops = tiles.slice(); // snapshot — `tiles` gets cleared before the drops themselves are dealt with

  tileEls.forEach((el) => el.classList.add(isValid ? 'flash-success' : 'flash-fail'));

  setTimeout(() => {
    if (isGameOver) return; // don't touch score/DOM after the round has already ended

    if (isValid) {
      caughtDrops.forEach((drop) => {
        createExplosion(drop.x, drop.y, drop.palette.deep, 4, 14);
        raindrops = raindrops.filter((d) => d !== drop); // removed from play entirely
      });
      score += 1;
      liveScoreEl.textContent = `Words: ${score}`;
    } else {
      // Back to their original color and clickable again — still falling,
      // never removed from `raindrops` in the first place.
      caughtDrops.forEach((drop) => { drop.clicked = false; });
    }

    tileEls.forEach((el) => {
      el.classList.remove('flash-success', 'flash-fail');
      el.classList.add('exploding');
    });

    setTimeout(() => {
      if (isGameOver) return;
      tileEls.forEach((el) => {
        el.textContent = '';
        el.classList.remove('filled', 'exploding');
      });
      tiles = new Array(WORD_LENGTH).fill(null);
      resolving = false;
    }, 350);
  }, 500);
}

function drawEverything() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  umbrellas.forEach((u) => drawUmbrella(ctx, u.x, u.y, u.r, u.palette));

  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - p.size);
    ctx.lineTo(p.x + p.size, p.y);
    ctx.lineTo(p.x, p.y + p.size);
    ctx.lineTo(p.x - p.size, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  raindrops.forEach((drop) => drop.draw(ctx));
}

function buildResultLine(finalScore, result) {
  // A round that ends with no words formed gets its own dedicated message
  // rather than folding into the generic "GAME OVER" line below — takes
  // priority over isNewBest/isTie, since a score of 0 "tying" a previous
  // best of 0 still isn't something worth congratulating.
  if (finalScore === 0) {
    return `<p class="shell-end-screen__title"><strong>OH NO!! 😢</strong></p><p>you failed to score today</p><p>better luck tomorrow</p>`;
  }
  const wordOrWords = `${finalScore} word${finalScore === 1 ? '' : 's'}`;
  // No previous best at all (result.isFirst) or a previous best of exactly
  // 0 would make "new best"/"equaled best" messaging read oddly this early
  // on — fall back to the plain WELL DONE message for both, same as every
  // other game.
  const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
  if (!hasNoMeaningfulBest && result.isNewBest) {
    return `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p><p>You scored ${wordOrWords}</p><p>That is a new <strong style="color: var(--shell-accent)">PERSONAL BEST</strong></p>`;
  }
  // finalScore > 0 is already guaranteed here (the ===0 case returned above).
  if (!hasNoMeaningfulBest && result.isTie) {
    return `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p><p>you equaled your best score of ${wordOrWords}</p><p>Let's go for a personal best tomorrow</p>`;
  }
  return `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p><p>you scored ${wordOrWords}</p><p>see if you can do even better tomorrow</p>`;
}

// THE GAME LOOP — same self-scheduling requestAnimationFrame pattern as
// JEWELZ's animate() (see the fuller explanation there); deltaTime keeps
// spawn timing and raindrop movement frame-rate independent.
function animate(currentTime) {
  if (finalSummaryProcessed) return;

  const deltaTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;

  if (!isGameOver) {
    survivalTime += deltaTime;
    shell.timer.setSeconds(survivalTime);

    spawnTimer += deltaTime;
    // At/above MAX_RAINDROPS, this simply skips spawning and leaves
    // spawnTimer sitting at/past nextSpawnIn — the moment a slot frees up
    // (a catch resolves, an umbrella pops one, or the round ends), the
    // very next frame spawns immediately rather than waiting out a whole
    // new interval on top of the wait already spent blocked.
    if (spawnTimer >= nextSpawnIn && raindrops.length < MAX_RAINDROPS) {
      spawnTimer = 0;
      spawnRaindrop(); // called first so it updates speedMultiplier before the line below reads it
      nextSpawnIn = randomSpawnInterval();
    }

    raindrops.forEach((drop) => drop.update(deltaTime));
    checkUmbrellaCollisions();

    // Game over the instant ANY raindrop — clicked/grey or not — reaches
    // the bottom, exactly as specified. When that happens, EVERY raindrop
    // still on screen explodes (not just the one that touched bottom) —
    // each at its own current position/color — then the array is cleared
    // so they're replaced entirely by their own burst of particles rather
    // than continuing to render mid-fall alongside the explosions.
    const offender = raindrops.find((drop) => drop.touchesBottom(canvas.height));
    if (offender) {
      isGameOver = true;
      raindrops.forEach((drop) => {
        createExplosion(drop.x, drop.y, drop.clicked ? Raindrop.GREY.deep : drop.palette.deep, 5, 20);
      });
      raindrops = [];

      // A word can still be mid-resolution here (its own setTimeout(s) in
      // resolveWord() check isGameOver and bail out WITHOUT touching the
      // DOM, once this has already fired) — if a different raindrop
      // reaches bottom in that ~500-850ms window, the just-completed
      // word's tiles would otherwise stay stuck showing its letters
      // forever, even though the score already counted it. Resetting the
      // tile row directly here guarantees it's always cleared the instant
      // the round ends, regardless of resolveWord()'s own timing.
      tileEls.forEach((el) => {
        el.textContent = '';
        el.classList.remove('filled', 'flash-success', 'flash-fail', 'exploding');
      });
    }
  }

  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= deltaTime * 1.5;
    p.alpha = Math.max(0, p.life);
  });
  particles = particles.filter((p) => p.life > 0);

  drawEverything();

  // Same deferred-end-of-round pattern as JEWELZ: wait for the explosion
  // particles to finish fading before showing results, so the "a raindrop
  // hit bottom" burst gets to play out first.
  if (isGameOver && particles.length === 0 && !finalSummaryProcessed) {
    finalSummaryProcessed = true;
    liveScoreEl.textContent = '';
    const result = submitScore(GAME_ID, score, { higherIsBetter: true });
    const resultLine = buildResultLine(score, result);
    saveProgress(GAME_ID, { score, resultLine, seconds: survivalTime }, { completed: true });
    // RAINZ has no reveal/help concept, and only ever ends via a raindrop
    // hitting bottom — a round that formed no words (score === 0) is the
    // closest thing RAINZ has to a "failed" outcome, distinct from a game
    // over that still scored.
    saveTodayOutcome(GAME_ID, { revealed: false, usedHelp: false, failed: score === 0, isNewBest: result.isNewBest, isTie: result.isTie });
    shell.showEndScreen({ message: resultLine, shareText: `🌧️ RAINZ — formed ${score} word${score === 1 ? '' : 's'} today!`, celebrate: score > 0, score });
    return;
  }

  requestAnimationFrame(animate);
}

function startGame() {
  raindrops = [];
  particles = [];
  tiles = new Array(WORD_LENGTH).fill(null);
  tileEls.forEach((el) => {
    el.textContent = '';
    el.classList.remove('filled', 'flash-success', 'flash-fail', 'exploding');
  });
  resolving = false;
  isGameStarted = true;
  isGameOver = false;
  finalSummaryProcessed = false;
  survivalTime = 0;
  spawnTimer = 0;
  speedMultiplier = 1; // fresh ramp each round — reset BEFORE computing nextSpawnIn below, which reads it
  nextSpawnIn = randomSpawnInterval();
  lastPaletteIndex = null;
  currentBatchLetters = []; // forces a fresh guaranteed-word batch on the very next spawn
  indexInBatch = 0;
  umbrellas = createDefaultUmbrellas(); // back to the full row at their default spots
  draggedUmbrella = null;
  score = 0;

  liveScoreEl.textContent = `Words: ${score}`;
  spawnRaindrop(); // first drop appears immediately rather than waiting out the usual spawn gap
  lastTime = performance.now();
  requestAnimationFrame(animate);
}

// onStart checks for an umbrella under the press first (see
// isPointInUmbrella) — if there is one, this gesture drags it instead of
// trying to catch a raindrop. onMove/onEnd only ever act on a drag that's
// already underway — see shared/input/canvas-pointer.js: it reports
// canvas-space coordinates regardless of on-screen display size.
enableCanvasPointerDrag({
  canvas,
  onStart: (pos) => {
    if (!isGameStarted || isGameOver || resolving) return;

    // Umbrellas are drawn in array order (later = on top of earlier), so
    // scanning in reverse picks whichever's frontmost if two ever overlap.
    for (let i = umbrellas.length - 1; i >= 0; i--) {
      const u = umbrellas[i];
      if (isPointInUmbrella(u, pos.x, pos.y)) {
        draggedUmbrella = u;
        dragOffset = { x: pos.x - u.x, y: pos.y - u.y };
        return; // a press starts EITHER a drag OR a catch attempt, never both
      }
    }

    // If two drops overlap at the tap point, pick the TOPMOST one — i.e.
    // whichever renders in front. drawEverything() draws `raindrops` in
    // array order (each one painted over whatever came before it), so
    // "topmost" is simply the LAST matching entry in the array — no
    // distance comparison needed, just keep overwriting `best` as we scan
    // forward and whatever's left at the end is the front-most match.
    let best = null;
    for (const drop of raindrops) {
      if (drop.containsPoint(pos.x, pos.y)) best = drop;
    }
    if (best) {
      if (best.clicked) resetCaughtDrops();
      else catchDrop(best);
    }
  },
  onMove: (pos) => {
    if (!draggedUmbrella) return;
    const u = draggedUmbrella;
    const minX = u.r, maxX = canvas.width - u.r;
    const minY = u.r * 1.25, maxY = canvas.height - u.r * 1.65;
    u.x = Math.min(maxX, Math.max(minX, pos.x - dragOffset.x));
    u.y = Math.min(maxY, Math.max(minY, pos.y - dragOffset.y));
    // Checked on every move (not just once per animation frame) so a fast
    // drag can't "jump over" a raindrop between rAF ticks without the
    // contact ever registering — the burst should fire the instant the
    // drag brings them together, exactly as specified.
    checkUmbrellaCollisions();
  },
  onEnd: () => {
    draggedUmbrella = null; // just stays wherever it was left
  },
});

const shell = initShell({
  gameId: GAME_ID,
  title: 'RAINZ',
  emoji: '🌧️',
  // Same single purple drop shown on this game's hub tile — a letter-free
  // version, since "RAINZ" is already spelled out as text right next to it
  // (see games/rainz/raindrop-icon.js's getHeaderIconDataURL).
  emojiImage: getHeaderIconDataURL(0),
  // Buttons colored from this game's own hub-tile palette (games-registry.js's
  // `color`/`rim`) instead of the shared global blue every game used before.
  accentColor: { bg: '#4FB2D6', ink: '#05374B', rim: 'rgba(5, 55, 75, 0.30)' },
  instructions: `<p>Tap a falling raindrop ${LETTER_DROP_IMG} to use its letter</p><p>Catch 4 letters in a row to spell a word and score a point</p><p>If you make a mistake, tap the raindrop again to start on a new word</p><p>A wildcard ${WILDCARD_IMG} can be used as any letter</p><p>Drag an umbrella ${UMBRELLA_IMG} to burst a raindrop</p><p>The game ends when a raindrop reaches the bottom</p>`,
  formatScore: (score) => `${score} word${score === 1 ? '' : 's'}`,
});

// Same one-shot pattern as JEWELZ — no 'in-progress' resume support, since
// progress is only ever saved once, at round end (see the animate() end-
// of-round block above). An interrupted round just starts fresh next time.
if (shell.status.status === 'completed') {
  const { resultLine, seconds, score: finalScore } = shell.status.record.data;
  shell.timer.setSeconds(seconds || 0);
  shell.showEndScreen({ message: resultLine, shareText: `🌧️ RAINZ — formed ${finalScore} word${finalScore === 1 ? '' : 's'} today!` });
} else {
  drawEverything(); // static (empty) preview behind the start banner
  shell.showStartBanner(startGame);
}

// Feeds a word through the EXACT SAME catchDrop()/resolveWord() path a
// real catch would — useful for testing/QA, since actually catching a
// specific 4-letter word (rather than whatever random letters happen to
// fall) isn't practical to do by hand. Position doesn't matter here (these
// drops are never drawn or hit-tested), only the letter sequence.
function testCatchWord(word) {
  if (!isGameStarted || isGameOver || resolving) return;
  for (const letter of word) catchDrop(new Raindrop(-100, letter));
}

// Dev-only shortcuts, matching the spirit of other games' (e.g. SLYDZ/
// QUADZ's "Solve puzzle") — reaching game-over or a specific word outcome
// naturally both require waiting on randomness that isn't practical to
// force by hand otherwise.
initToolsPanel([GAME_ID], {
  extraActions: [
    { label: 'Force game over', onClick: () => { isGameOver = true; } },
    // Nudges the first raindrop down to the bottom edge so the NEXT frame's
    // real touchesBottom() check fires naturally — exercises the actual
    // explode-everything game-over path (see animate()) rather than just
    // flipping isGameOver directly.
    {
      label: 'Force a raindrop to the bottom',
      onClick: () => { if (raindrops[0]) raindrops[0].y = canvas.height; },
    },
    { label: 'Test word: RAIN (valid)', onClick: () => testCatchWord('RAIN') },
    { label: 'Test word: ZZQX (invalid)', onClick: () => testCatchWord('ZZQX') },
    // Wildcards only spawn ~1-in-10 raindrops on average — these make the
    // hard-to-trigger-by-hand cases easy to check: a visible wildcard drop,
    // and a word solved USING a wildcard.
    {
      label: 'Spawn a wildcard drop',
      onClick: () => {
        const drop = new Raindrop(pickNonOverlappingX(Raindrop.BASE_RADIUS), WILDCARD_LETTER);
        drop.speed *= speedMultiplier;
        raindrops.push(drop);
      },
    },
    { label: `Test word: F${WILDCARD_LETTER}RM (wildcard, valid)`, onClick: () => testCatchWord(`F${WILDCARD_LETTER}RM`) },
  ],
});
