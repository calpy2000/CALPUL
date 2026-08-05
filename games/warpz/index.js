// WARPZ — phase 1. Move the face to dodge a field of tumbling asteroids (or
// the zapper obstacle) and catch star shards (1pt) and energy orbs (3pt)
// for points; touching an obstacle ends the round. Same shell/player/
// collision/explosion pattern JEWELZ uses (see games/jewelz/index.js).

import Asteroid, { TRAJECTORY_VARIATION_DEG } from './Asteroid.js';
import StarShard, { PALETTES as SHARD_PALETTES } from './StarShard.js';
import EnergyOrb, { PALETTES as ORB_PALETTES } from './EnergyOrb.js';
import Zapper from './Zapper.js';
import Cluster from './Cluster.js';
import Worm, { PALETTES as WORM_PALETTES } from './Worm.js';
import Station from './Station.js';
import Maze from './Maze.js';
import Starfield from './Starfield.js';
import { drawPlayerFace, getPlayerIconDataURL } from './player-icon.js';
import { getStarShardIconDataURL } from './star-shard-icon.js';
import { getEnergyOrbIconDataURL } from './energy-orb-icon.js';
import { getSkullIconDataURL } from './skull-icon.js';
import { initShell } from '../../shared/core/shell.js';
import { saveProgress, submitScore, saveTodayOutcome, saveTodayScore } from '../../shared/core/game-storage.js';
import { enableCanvasPointerDrag } from '../../shared/input/canvas-pointer.js';
import { initToolsPanel } from '../../shared/core/tools-panel.js';
import { getToolMode } from '../../shared/core/tool-mode.js';
import { hidePageLoadingIndicator, stripReloadParam } from '../../shared/core/loading-indicator.js';

const GAME_ID = 'warpz';

const PLAYER_IMG = `<img src="${getPlayerIconDataURL()}" alt="spaceman" class="warpz-inline-icon">`;
// --large: these two read as too small to make out at the plain inline-icon
// size (per the user's explicit feedback) — see .warpz-inline-icon--large's
// own comment in style.css for why a transform:scale() modifier, not a
// bigger width/height, is what keeps the instructions text's own line
// spacing completely unchanged.
const STAR_SHARD_IMG = `<img src="${getStarShardIconDataURL()}" alt="star shard" class="warpz-inline-icon warpz-inline-icon--large">`;
const ENERGY_ORB_IMG = `<img src="${getEnergyOrbIconDataURL()}" alt="energy orb" class="warpz-inline-icon warpz-inline-icon--large">`;
const SKULL_IMG = `<img src="${getSkullIconDataURL()}" alt="skull" class="warpz-inline-icon warpz-inline-icon--xlarge">`;

// Loaded once, up front, via top-level await (valid inside a <script
// type="module">) — the dev-tool "Sequence #" radio group below needs the
// full list of defined sequences BEFORE it's built, since its options
// array is static. See games/warpz/sequences.json for the actual data and
// its own comment-equivalent (the JSON has none, but the shape is: an
// array of { sequence, steps: [{ obstacles: [...], duration }] } objects —
// `obstacles` is always a list, even for a single type, so a future
// combined step like ["asteroids", "zapper"] needs no schema change).
let sequences = [];
try {
  const res = await fetch(new URL('./sequences.json', import.meta.url));
  sequences = await res.json();
} catch (err) {
  console.warn('WARPZ: failed to load sequences.json — the "Sequence" obstacle option will have nothing to run', err);
}

// hidePageLoadingIndicator() runs AFTER the sequences.json fetch above,
// NOT as the first statement (the usual convention — see
// loading-indicator.js's own comment on why "first statement" is normally
// correct: it only accounts for the JS module graph finishing, not a
// game's OWN data fetch on top of that). A real bug, found via a user
// report on VALUZ of "long wait with no spinner" that turned out to
// affect this file too, since VALUZ's sequences.json-style fetch was
// originally copied FROM this one: on a slow/cold-cache connection, the
// spinner was being torn down right as the actual network wait for THIS
// fetch began, leaving a real gap with nothing on screen. Moving this
// call down here (rather than wrapping the fetch in its own fresh
// showPageLoadingIndicator()) is the simpler of the two fixes
// loading-indicator.js's own rule allows for.
hidePageLoadingIndicator();
stripReloadParam(); // cleans up the harmless ?_r=... param a dev/tester tools reset may have added

// --- which obstacle type(s) populate the field this round -----------
// A dev-tool radio selector (see the `radioGroups` passed to
// initToolsPanel() below) — picking one is read once, at the moment
// startGame() actually starts a round (see `activeObstacleType` there), so
// whichever was selected is what that round uses throughout. Persisted to
// localStorage (not just an in-memory variable) — the dev panel's own
// "Reset today's progress" button does a full page reload, which would
// otherwise silently wipe an in-memory-only selection right back to the
// default before you ever got to press Play Now. As more obstacle types
// get built (up to ~6 planned total), each just needs one more entry in
// `options` below. Declared/read before initToolsPanel()'s own call since
// its radio inputs read the current value immediately, at panel-build
// time.
//
// The obstacle-type/sequence-number radio groups only ever render in
// TOOL_MODE 'dev' (see tools-panel.js's buildTestPanelContent — testers get
// a reset/feedback panel with none of this) — so outside dev mode there's
// no UI to ever change selectedObstacleType/selectedSequenceNumber away
// from whatever localStorage happens to hold (typically nothing, for a
// tester's first-ever visit, which fell through to the 'clusters' default
// below — a single unchanging obstacle type forever, not the actual
// designed game). IS_DEV_TOOLS forces both to the "real game" values
// (obstacle type 'sequence', sequence number 0 — a sequence id reserved
// specifically for this so it can't collide with whatever ad-hoc numbering
// dev testing sequences use) whenever the dev panel isn't the one in
// control, so testers/real players always get the intended designed
// experience regardless of what's sitting in their localStorage.
const IS_DEV_TOOLS = getToolMode() === 'dev';
const OBSTACLE_TYPE_STORAGE_KEY = 'warpz_devObstacleType';
// Defaulted to 'clusters' for now while that's the one being actively
// tested — switch back to 'asteroids' once that's done.
let selectedObstacleType = IS_DEV_TOOLS
  ? (localStorage.getItem(OBSTACLE_TYPE_STORAGE_KEY) || 'clusters')
  : 'sequence';

// Which sequence number runs when 'sequence' is the selected obstacle type
// — irrelevant otherwise. In dev mode, falls back to whichever sequence is
// first in the JSON if nothing's stored yet or the stored number no longer
// exists. Outside dev mode, always sequence 0 — see IS_DEV_TOOLS above —
// falling back to whatever's first in the JSON only if sequence 0 hasn't
// been authored yet (startGame() already has this same fallback baked in
// for a missing activeSequence, so this never crashes, just plays
// whichever sequence happens to be first until 0 exists).
const SEQUENCE_NUMBER_STORAGE_KEY = 'warpz_devSequenceNumber';
const storedSequenceNumber = Number(localStorage.getItem(SEQUENCE_NUMBER_STORAGE_KEY));
let selectedSequenceNumber = IS_DEV_TOOLS
  ? (sequences.some((s) => s.sequence === storedSequenceNumber)
      ? storedSequenceNumber
      : (sequences[0] ? sequences[0].sequence : null))
  : (sequences.some((s) => s.sequence === 0) ? 0 : (sequences[0] ? sequences[0].sequence : null));

// Which of Maze.js's own DIFFICULTY_PRESETS a spawned maze uses — read once
// per spawn (see spawnMaze()), same "pending pick doesn't retroactively
// change anything already on screen" convention as every other dev-panel
// selector here. Irrelevant when 'maze' isn't the active obstacle type.
const MAZE_DIFFICULTY_STORAGE_KEY = 'warpz_devMazeDifficulty';
const storedMazeDifficulty = localStorage.getItem(MAZE_DIFFICULTY_STORAGE_KEY);
let selectedMazeDifficulty = ['easy', 'medium', 'hard'].includes(storedMazeDifficulty) ? storedMazeDifficulty : 'medium';

initToolsPanel([GAME_ID], {
  extraActions: [
    // Same reasoning as JEWELZ's own dev-panel shortcut — reaching game
    // over by actually colliding with an obstacle isn't practical to force
    // by hand for every test pass.
    { label: 'Force game over', onClick: () => { isGameOver = true; } },
  ],
  radioGroups: [
    {
      label: 'Obstacle type',
      name: 'obstacle-type',
      options: [
        { value: 'asteroids', label: 'Asteroids' },
        { value: 'zapper', label: 'Zapper' },
        { value: 'clusters', label: 'Clusters' },
        { value: 'worms', label: 'Worms' },
        { value: 'station', label: 'Station' },
        { value: 'maze', label: 'Maze' },
        { value: 'sequence', label: 'Sequence' },
      ],
      get: () => selectedObstacleType,
      set: (v) => {
        selectedObstacleType = v;
        localStorage.setItem(OBSTACLE_TYPE_STORAGE_KEY, v);
      }, // debug label only reflects activeObstacleType (see startGame()) — a pending pick doesn't take effect until a new round starts
    },
    // Only rendered if sequences.json actually has something in it — a
    // stray "Sequence #" group with zero options wouldn't do anything
    // useful.
    ...(sequences.length
      ? [
          {
            label: 'Sequence #',
            name: 'sequence-number',
            options: sequences.map((s) => ({ value: String(s.sequence), label: `Sequence ${s.sequence}` })),
            get: () => String(selectedSequenceNumber),
            set: (v) => {
              selectedSequenceNumber = Number(v);
              localStorage.setItem(SEQUENCE_NUMBER_STORAGE_KEY, v);
            }, // only takes effect when "Sequence" is also the selected obstacle type — same "read once at startGame()" timing as everything else here
          },
        ]
      : []),
    {
      label: 'Maze Difficulty',
      name: 'maze-difficulty',
      options: [
        { value: 'easy', label: 'Easy' },
        { value: 'medium', label: 'Medium' },
        { value: 'hard', label: 'Hard' },
      ],
      get: () => selectedMazeDifficulty,
      set: (v) => {
        selectedMazeDifficulty = v;
        localStorage.setItem(MAZE_DIFFICULTY_STORAGE_KEY, v);
      }, // only takes effect when "Maze" is also the selected obstacle type — read once per spawnMaze() call
    },
  ],
});

const canvas = document.getElementById('responsiveCanvas');
const ctx = canvas.getContext('2d');

// --- spawn perimeter config — shared by both asteroids and star shards
// (see pickSpawnPoint() below): top edge + upper 70% of each side, weighted/
// biased toward the top. ---
const SIDE_ENTRY_FRACTION = 0.7;
const TOP_EDGE_WEIGHT_MULTIPLIER = 1.5;
const SIDE_BIAS_POWER = 2;

const CREATION_INTERVAL_BASE = 1.2; // seconds between asteroid spawns
const CREATION_INTERVAL_VARIATION = 0.3; // +/-30%, re-rolled after every spawn
// Worm spawn timing started as a straight reuse of the asteroids' own
// rollSpawnInterval() (per the user's original "density... the same as
// asteroids" request), but was later given its own independent interval —
// CREATION_INTERVAL_BASE / 1.5 (1.2s -> 0.8s), then /1.5 AGAIN (0.8s ->
// ~0.533s) per a second identical "increase the spawning rate of the worms
// by 1.5x" request (rate is the inverse of interval, so a 1.5x higher rate
// is a /1.5 shorter interval). Same +/-30% variation mechanism as every
// other spawn timer in this file.
const WORM_CREATION_INTERVAL_BASE = CREATION_INTERVAL_BASE / 1.5 / 1.5;
const WORM_CREATION_INTERVAL_VARIATION = 0.3;
const SHARD_CREATION_INTERVAL_BASE = 1.5; // seconds between star shard spawns — its own timer, independent of the asteroids'
const SHARD_CREATION_INTERVAL_VARIATION = 0.3;
const ORB_CREATION_INTERVAL_BASE = SHARD_CREATION_INTERVAL_BASE * 3; // spawns a third as often as shards, per the user's explicit request
const ORB_CREATION_INTERVAL_VARIATION = 0.3; // same variation mechanism as every other spawn timer in this file
// Each zapper is on screen for roughly (canvas height + top/bottom margin)
// / its own descent speed ~= 24s. Fixed (no +/-variation, unlike every
// other spawn timer in this file) — zappers all descend at the same
// VERTICAL_SPEED, so a perfectly regular spawn interval is what keeps them
// evenly spaced as they scroll down, per the user's explicit request.
// Since spacing = VERTICAL_SPEED * interval, this constant directly sets
// the vertical gap between consecutive zappers — 6.0s here is the original
// 4.0s x 1.5, per the user's explicit "make the distance between zappers
// larger by 1.5x" request. Both walls spawn on this exact same interval
// (see nextZapperSpawnInRight's half-period offset in startGame()) so
// left/right appear one at a time, evenly interleaved.
const ZAPPER_CREATION_INTERVAL_BASE = 6.0;
// Fixed (not rolled like the asteroid/shard/orb intervals above) — per the
// user's explicit "come one at a time but pretty regularly" request, later
// loosened to "increase the spawning" up to MAX_CONCURRENT_CLUSTERS at
// once. Only ever counts down while clusters.length < MAX_CONCURRENT_CLUSTERS
// (see animate()), so this is the gap AFTER a slot frees up (a cluster
// fully clears — explodes+debris fades, or gets abandoned for drifting/
// charging off-canvas, see Cluster.js's isDone()) before the next one
// starts its own spawn countdown.
const CLUSTER_RESPAWN_DELAY = 0.5;
const MAX_CONCURRENT_CLUSTERS = 2;
// Global minimum gap between any two clusters' explosions, per the user's
// explicit "never allow clusters to explode within 1.5 seconds of each
// other" request — see clusterExplosionCooldown in animate() below, which
// is what actually enforces it (Cluster instances don't coordinate with
// each other directly).
const CLUSTER_EXPLOSION_COOLDOWN = 1.5;
const MAX_ZAPPERS_PER_SIDE = 6; // concurrent on-screen cap, per side
const TOTAL_ZAPPERS_PER_SIDE = 10; // lifetime spawn cap, per side, for the whole round — once reached, that wall just stops producing new ones; whatever's still on screen keeps descending/clearing as normal, per the user's explicit "see how easy it is to survive their passing" request
// Station is large (nearly full canvas width) and takes a long time to
// scroll through. Up to MAX_CONCURRENT_STATIONS (see spawnStation()'s own
// comment) can now briefly overlap for a back-to-back pair, gated mainly
// by canSpawnNextStation()'s own position-based check — this delay is a
// secondary minimum gap on top of that, same "respawn delay after a slot
// frees up" idea as CLUSTER_RESPAWN_DELAY, though in practice the position
// check is almost always the binding constraint (it takes far longer than
// 1s for the gap condition to be met).
const STATION_RESPAWN_DELAY = 1.0;
// Matches Station.js's own VERTICAL_SPEED constant (duplicated rather than
// imported, same convention Zapper.js/Cluster.js already use for their own
// copy of this number) — how fast a player trapped INSIDE the station gets
// carried down with it, per the user's explicit "cannot find a way out by
// the time [they] reach the bottom of the canvas" rule (see animate()).
const STATION_CARRY_SPEED = 38;
// Maze is even taller than Station (20 rows deep vs. one ring), so only
// one is ever on screen at a time — this is just the gap after one fully
// clears before the next one's own spawn timer starts, same idea as
// STATION_RESPAWN_DELAY.
const MAZE_RESPAWN_DELAY = 1.0;
// How long a "station/maze completed" bonus orb waits after the triggering
// exit before it actually appears — per the user's explicit "wait for a
// second" request, so it doesn't spawn mid-canvas right on top of the
// obstacle the player is still visually inside/next to (see
// queueCompletionBonusOrb()'s own comment for the rest of that fix).
const BONUS_ORB_SPAWN_DELAY = 1.0;
// How long the round keeps running (screen still scrolling, no new
// spawns, player invulnerable) after the player clears the whole
// sequence before the win panel actually appears — per the user's
// explicit "let the game continue for 2 seconds" request, rather than
// cutting straight to the panel the instant the last step completes.
const SEQUENCE_WIN_DELAY = 2.0;
// A newly-active type's first spawn used to fire on literally the next
// frame (its own spawn timer reset to 0 at the step boundary) — landing
// right on top of whatever density the outgoing type had built up (e.g.
// two clusters appearing while the canvas was still full of worms read
// as visually abrupt). This is a small breathing gap applied instead,
// per the user's explicit request — not a wait for the outgoing type to
// clear (that's the whole point: it still overlaps, just isn't stacked
// at the exact instant of the transition), see advanceSequenceStep().
const SEQUENCE_STEP_ENTRY_DELAY = 1.5;

// --- game state ---
let isGameStarted = false;
let isGameOver = false;
let isDragging = false;
let isPlayerExploded = false;
let finalSummaryProcessed = false;
let lastTime = performance.now();

// Set the instant the browser starts navigating away (e.g. the header's
// "back" link to the hub) — animate() checks this and stops scheduling
// itself immediately, rather than continuing to burn CPU on a page that's
// about to be torn down anyway. Without this, this game's own rAF loop
// competes with the browser for the CPU it needs to actually load the next
// page, which can make that transition visibly stall. 'pagehide' fires
// reliably on navigation (including back/forward-cache cases) without the
// user-facing side effects 'beforeunload' can have.
let pageIsUnloading = false;
window.addEventListener('pagehide', () => { pageIsUnloading = true; });

let survivalTime = 0; // seconds survived so far this round — shown in the header timer, no longer the score itself
let score = 0; // points earned this round (star shards + energy orbs) — the round's actual score, same convention as JEWELZ's jewel count
let nextSpawnIn = 0;
let nextClusterSpawnIn = 0;
let clusterExplosionCooldown = 0; // seconds left before another cluster is allowed to explode — see CLUSTER_EXPLOSION_COOLDOWN
let nextWormSpawnIn = 0;
let lastWormPalette = null; // whichever palette the most recently SPAWNED worm got, so the next one can avoid repeating it — same not-the-same-as-last-time pattern as the shard/orb palettes
let nextStationSpawnIn = 0;
let nextMazeSpawnIn = 0;
// Whether the player is currently within the maze's own vertical span —
// drives the antenna-hide, same idea as playerInsideStation below. Maze
// doesn't get Station's OWN "carried down while topologically contained"
// death rule (that's specific to being enclosed by a single ring) — it
// gets the bottom-edge crush rule instead (see the atBottomEdge check
// further down), reusing the exact same mechanism Station's touchesRing()
// already established.
let playerInsideMaze = false;
// Whether the player is currently inside the station's outer ring — per
// the user's explicit spec this drives the antenna-hide (see the
// drawPlayerFace call in drawEverything()) and gates the "carried down,
// trapped" lose condition in animate(). Recomputed fresh every frame, not
// just on drag, since the station's own motion can carry the boundary
// across a player who isn't moving at all.
let playerInsideStation = false;
let nextShardSpawnIn = 0;
let nextOrbSpawnIn = 0;
let nextZapperSpawnInLeft = 0;
let nextZapperSpawnInRight = 0;
let zappersSpawnedLeft = 0; // lifetime count for this round, checked against TOTAL_ZAPPERS_PER_SIDE — separate from zappersLeft.length, which only counts ones still on screen
let zappersSpawnedRight = 0;
let lastShardPalette = null; // whichever palette the most recently SPAWNED shard got, so the next one can avoid repeating it
let lastOrbPalette = null; // same idea, but its own separate rotation — an orb never repeats the last ORB color, independent of the most recent shard color
let activeObstacleType = selectedObstacleType; // snapshot of selectedObstacleType taken at startGame(), so a dev-panel change mid-round doesn't switch obstacle types out from under an in-progress round — starts equal to it so the pre-round debug label isn't misleading
let activeSequence = null; // snapshot of the sequences.json entry matching selectedSequenceNumber, taken at startGame() — only meaningful when activeObstacleType === 'sequence'
let sequenceStepIndex = 0; // which step of activeSequence.steps is currently running
let sequenceStepElapsed = 0; // seconds into the CURRENT step — only meaningful for a duration-based step, see advanceSequenceStep()'s own comment
let sequenceStationSpawnCount = 0; // stations spawned so far during the CURRENT step — only meaningful for a quantity-based (station) step
let sequenceStationQuantityLastRef = null; // the station instance that fulfilled the CURRENT quantity-based step's own count (its own "last space station") — watched so the step can advance the moment the player exits it, see the exit-tracking block in animate()
// Same pair, for maze's own quantity-based step form (`{ "obstacles":
// ["maze"], "quantity": n }`, per the user's explicit follow-up spec —
// mirrors station's own mechanism exactly, just against `mazes`/
// `spawnMaze()` instead of `stations`/`spawnStation()`).
let sequenceMazeSpawnCount = 0;
let sequenceMazeQuantityLastRef = null;
// Set true only by triggerSequenceWin(). Per the user's explicit "let the
// game continue for 2 seconds" request, winning no longer sets isGameOver
// immediately — this flag alone marks "the win is decided," used to
// suppress new spawning (see `spawningTypes` below) and every lethal
// check (hitByAnyObstacle, the bottom-crush rule, the trapped-in-station
// rule — search `&& !sequenceCompleted` for all three) for the
// SEQUENCE_WIN_DELAY duration, so the screen keeps scrolling but the
// player can't awkwardly die right after already winning. isGameOver
// itself only flips once sequenceWinDelay (below) counts down to 0 — at
// which point the EXISTING final-summary block picks up sequenceCompleted
// to show the congratulations message and force the confetti celebration
// regardless of score. Reset alongside every other sequence tracker,
// both per-step and per-round.
let sequenceCompleted = false;
let sequenceWinDelay = 0; // counts down from SEQUENCE_WIN_DELAY once sequenceCompleted is set; isGameOver flips true when this reaches 0

const player = { x: 225, y: 400, radius: 25 }; // same size/position convention as JEWELZ
let asteroids = [];
let clusters = [];
let worms = [];
let stations = []; // 0 to MAX_CONCURRENT_STATIONS elements — see canSpawnNextStation()'s own comment
let mazes = []; // practically 0 or 1 — only one at a time, see MAZE_RESPAWN_DELAY's own comment
let starShards = [];
let energyOrbs = [];
// Queued "a station/maze was just completed" bonus orbs, waiting out their
// own BONUS_ORB_SPAWN_DELAY before actually appearing — see
// queueCompletionBonusOrb()'s own comment for why this is a queue instead
// of an immediate spawn.
let pendingBonusOrbs = [];
let zappersLeft = []; // multiple, spawned over time up to MAX_ZAPPERS_PER_SIDE — see spawnZapper() below
let zappersRight = []; // mirror of zappersLeft, pinned to the right wall instead
let particles = []; // small diamond-shaped bits flung outward on death/collection — same effect JEWELZ uses
const starfield = new Starfield(canvas.width, canvas.height); // scrolls independently of every asteroid's/shard's/zapper's own motion

// Temporary dev-only debug label (see index.html) — just shows which
// obstacle is currently active/showing on the field. Remove this function
// + its call sites + the HTML/CSS in index.html/style.css once no longer
// needed.
function zapperCountsLabel() {
  return `L ${zappersLeft.length}/${MAX_ZAPPERS_PER_SIDE} · ${zappersSpawnedLeft}/${TOTAL_ZAPPERS_PER_SIDE}, R ${zappersRight.length}/${MAX_ZAPPERS_PER_SIDE} · ${zappersSpawnedRight}/${TOTAL_ZAPPERS_PER_SIDE}`;
}

function updateObstacleDebugLabel() {
  const el = document.getElementById('obstacleDebugLabel');
  if (!el) return;
  // Dev-only diagnostics — per the user's explicit request, hidden outside
  // TOOL_MODE 'dev' (same IS_DEV_TOOLS gate as the obstacle-type/sequence
  // dev-panel picks above). Actually hides the element (not just leaves its
  // text empty) since .warpz-obstacle-debug still has its own background/
  // padding — an empty text node would otherwise still show as a stray
  // white pill in the corner for testers.
  if (!IS_DEV_TOOLS) { el.style.display = 'none'; return; }
  el.style.display = '';

  if (activeObstacleType === 'sequence' && activeSequence) {
    const step = activeSequence.steps[sequenceStepIndex];
    // Quantity-based steps (station/maze) have no duration/elapsed
    // countdown — show spawn progress toward the requested count instead.
    // See advanceSequenceStep()'s own comment for the two step kinds.
    const quantityCount = step.obstacles.includes('maze') ? sequenceMazeSpawnCount : sequenceStationSpawnCount;
    const progressLabel = step.duration !== undefined
      ? `${Math.max(0, step.duration - sequenceStepElapsed).toFixed(1)}s`
      : `${quantityCount}/${step.quantity}`;
    const typesLabel = step.obstacles.join('+');
    const zapPart = step.obstacles.includes('zapper') ? ` zap(${zapperCountsLabel()})` : '';
    el.textContent = `seq${activeSequence.sequence} step${sequenceStepIndex + 1}/${activeSequence.steps.length} [${typesLabel}] ${progressLabel}${zapPart}`;
  } else if (activeObstacleType === 'zapper') {
    el.textContent = `zapper (${zapperCountsLabel()})`;
  } else if (activeObstacleType === 'station') {
    el.textContent = `station (${stations.length ? 'active' : 'none'}) player:${playerInsideStation ? 'INSIDE' : 'outside'}`;
  } else if (activeObstacleType === 'maze') {
    // `age`/`entranceY` here are purely diagnostic (see the user's own
    // "is the skull really spawning at the half-way point" question) — age
    // is seconds since this maze itself spawned, entranceY is the on-screen
    // Y of the maze's own bottom boundary right now (should read ~400,
    // half the 800px canvas, at the exact instant skull flips none->ACTIVE
    // for the very first time).
    const m0 = mazes[0];
    // 1600 = Maze.js's own TOTAL_HEIGHT (ROWS*CELL_H = 20*80), not exported
    // — hardcoded here rather than adding an export just for this debug
    // string; update this if either constant ever changes.
    const diag = m0 ? ` age:${m0.age.toFixed(1)}s entranceY:${(m0.y + 1600).toFixed(0)} skull:${m0._skull ? 'ACTIVE' : 'none'}` : '';
    el.textContent = `maze[${m0 ? m0.difficulty : selectedMazeDifficulty}] (${mazes.length ? 'active' : 'none'}) player:${playerInsideMaze ? 'INSIDE' : 'outside'}${diag}`;
  } else {
    el.textContent = activeObstacleType;
  }
}
updateObstacleDebugLabel();

function rollSpawnInterval() {
  return CREATION_INTERVAL_BASE * (1 + (Math.random() * 2 - 1) * CREATION_INTERVAL_VARIATION);
}

function rollWormSpawnInterval() {
  return WORM_CREATION_INTERVAL_BASE * (1 + (Math.random() * 2 - 1) * WORM_CREATION_INTERVAL_VARIATION);
}

function rollShardSpawnInterval() {
  return SHARD_CREATION_INTERVAL_BASE * (1 + (Math.random() * 2 - 1) * SHARD_CREATION_INTERVAL_VARIATION);
}

function rollOrbSpawnInterval() {
  return ORB_CREATION_INTERVAL_BASE * (1 + (Math.random() * 2 - 1) * ORB_CREATION_INTERVAL_VARIATION);
}

// Picks an entry edge + position along it + the degrees-off-straight-down
// range that edge is allowed to use — shared by both spawnAsteroid() and
// spawnStarShard() below, since both objects enter the canvas exactly the
// same way (top edge weighted heavier, side entries biased toward their
// own top end, trajectory always constrained to net INTO the canvas).
function pickSpawnPoint() {
  const width = canvas.width, height = canvas.height;
  const sideLen = height * SIDE_ENTRY_FRACTION;
  const topWeight = width * TOP_EDGE_WEIGHT_MULTIPLIER;
  const total = topWeight + sideLen * 2;
  const roll = Math.random() * total;

  if (roll < topWeight) {
    return { edge: 'top', coord: Math.random() * width, angleRangeDeg: [-TRAJECTORY_VARIATION_DEG, TRAJECTORY_VARIATION_DEG] };
  } else if (roll < topWeight + sideLen) {
    return { edge: 'left', coord: Math.pow(Math.random(), SIDE_BIAS_POWER) * sideLen, angleRangeDeg: [0, TRAJECTORY_VARIATION_DEG] };
  } else {
    return { edge: 'right', coord: Math.pow(Math.random(), SIDE_BIAS_POWER) * sideLen, angleRangeDeg: [-TRAJECTORY_VARIATION_DEG, 0] };
  }
}

function spawnAsteroid() {
  const { edge, coord, angleRangeDeg } = pickSpawnPoint();
  asteroids.push(new Asteroid(edge, coord, angleRangeDeg, canvas.width));
}

// Same shared pickSpawnPoint() every other field-obstacle uses. Spawn
// TIMING is its own thing though (see CLUSTER_RESPAWN_DELAY) — capped at
// one on screen at a time, per the user's explicit request.
function spawnCluster() {
  const { edge, coord, angleRangeDeg } = pickSpawnPoint();
  clusters.push(new Cluster(edge, coord, angleRangeDeg, canvas.width, canvas.height));
}

function rollZapperSpawnInterval() {
  return ZAPPER_CREATION_INTERVAL_BASE; // fixed interval, not re-rolled — see the constant's own comment above
}

// Same "not the same as last time" pattern pickNextShardPalette()/
// pickNextOrbPalette() use for their own palettes, just its own rotation —
// a worm never repeats the last WORM color, independent of any shard/orb/
// cluster color history.
function pickNextWormPalette() {
  const choices = WORM_PALETTES.filter((p) => p !== lastWormPalette);
  const palette = choices[Math.floor(Math.random() * choices.length)];
  lastWormPalette = palette;
  return palette;
}

// Same shared pickSpawnPoint() every other field-obstacle uses — per the
// user's original "speed, trajectory, entry points and density... the same
// as asteroids" request. Speed and spawn timing (rollWormSpawnInterval())
// have since diverged from the asteroids' own via later explicit requests —
// see WORM_BASE_SPEED's and WORM_CREATION_INTERVAL_BASE's own comments.
function spawnWorm() {
  const { edge, coord, angleRangeDeg } = pickSpawnPoint();
  const palette = pickNextWormPalette();
  worms.push(new Worm(edge, coord, angleRangeDeg, canvas.width, palette));
}

// Station doesn't use pickSpawnPoint() at all — unlike every other
// obstacle it's not a small object entering from an edge on some
// trajectory, it's a huge structure descending straight down the canvas
// center (see Station.js's own header comment).
//
// Per the user's explicit "station mode" spec, a station also brings its
// own FIXED set of collectibles instead of the normal randomly-flying
// ones (see the `stationActive` gating in animate()): one star shard
// centered in each of the station's 6 channel "spaces" between the rings
// and two adjacent spokes, plus one energy orb dead center of the inner
// ring. Spawned together with the station itself (so they're already
// there as it emerges onto the screen from off the top edge, never
// separately timed in later) and marked `_stationAttached` so animate()
// knows to reposition them every frame from the station's own
// collectibleAnchors() instead of letting them fly under their own
// vx/vy — which is why they're constructed with throwaway edge/coord/
// angle args and immediately zeroed out below, the real position comes
// from the anchor points a moment later.
function spawnStation() {
  const station = new Station(canvas.width, canvas.height);
  // Per-instance "has the player successfully gone in and come back out"
  // tracking — updated each frame in animate() alongside playerInsideStation.
  // Drives both the exclusivity guard and (for a quantity-based sequence
  // step) how soon the next step can start — see effectiveSpawningTypes'
  // and sequenceStationQuantityLastRef's own comments.
  station._wasEverInside = false;
  station._playerHasExited = false;
  stations.push(station);

  const anchors = station.collectibleAnchors();
  anchors.shardPoints.forEach((p, i) => {
    const shard = new StarShard('top', p.x, [0, 0], canvas.width, pickNextShardPalette());
    shard.x = p.x; shard.y = p.y; shard.vx = 0; shard.vy = 0;
    shard._stationAttached = true;
    shard._stationRef = station; // which station owns it — now that back-to-back stations can briefly coexist (see canSpawnNextStation()), index-0-only assumptions no longer hold
    shard._anchorIndex = i;
    starShards.push(shard);
  });

  const orb = new EnergyOrb('top', anchors.orbPoint.x, [0, 0], canvas.width, pickNextOrbPalette(), { alwaysCollidable: true });
  orb.x = anchors.orbPoint.x; orb.y = anchors.orbPoint.y; orb.vx = 0; orb.vy = 0;
  orb._stationAttached = true;
  orb._stationRef = station;
  energyOrbs.push(orb);

  return station;
}

// Doesn't use pickSpawnPoint() either, same reason Station doesn't — it's
// not a small object entering on some trajectory, it's a huge structure
// (much taller than Station, even) descending straight down the whole
// canvas width.
//
// Per the user's explicit follow-up spec: a maze also brings its own FIXED
// set of static shards/orbs (see Maze.js's own SHARD_COUNT/ORB_COUNT and
// collectibleAnchors()) instead of the normal randomly-flying ones (see the
// `mazeActive` gating in animate()) — same `_mazeAttached`/`_mazeRef`/
// `_anchorIndex` pattern spawnStation() already established for its own
// attached collectibles, just against Maze's own anchor set.
// A sequence step can pin its own maze difficulty via an explicit `level`
// key (`{ "obstacles": ["maze"], "quantity": n, "level": "easy" }`, per
// the user's explicit follow-up spec) — falls back to the dev-panel's own
// "Maze Difficulty" selector (`selectedMazeDifficulty`) whenever there's
// no active sequence step, or the current step simply doesn't specify one
// (an authored sequence can freely mix maze steps that do and don't pin a
// level). Maze's own constructor already defensively falls back to
// 'medium' for anything unrecognized, so no extra validation needed here.
function resolveMazeDifficulty() {
  if (activeObstacleType === 'sequence' && activeSequence) {
    const currentStep = activeSequence.steps[sequenceStepIndex];
    if (currentStep.level) return currentStep.level;
  }
  return selectedMazeDifficulty;
}

function spawnMaze() {
  const maze = new Maze(canvas.width, canvas.height, resolveMazeDifficulty());
  // Per-instance "has the player successfully gone in and come out the
  // exit" tracking — same idea as Station's own _wasEverInside/
  // _playerHasExited, just simpler: "exited" here just means physically
  // above the maze's own top boundary after having been inside, since the
  // boundary is otherwise solid on every other side (see the tracking
  // block in animate()). Drives the one-shot "maze completed" bonus orb.
  maze._wasEverInside = false;
  maze._playerHasExited = false;
  mazes.push(maze);

  const anchors = maze.collectibleAnchors();
  anchors.shardPoints.forEach((p, i) => {
    const shard = new StarShard('top', p.x, [0, 0], canvas.width, pickNextShardPalette());
    shard.x = p.x; shard.y = p.y; shard.vx = 0; shard.vy = 0;
    shard._mazeAttached = true;
    shard._mazeRef = maze;
    shard._anchorIndex = i;
    starShards.push(shard);
  });
  anchors.orbPoints.forEach((p, i) => {
    const orb = new EnergyOrb('top', p.x, [0, 0], canvas.width, pickNextOrbPalette(), { alwaysCollidable: true });
    orb.x = p.x; orb.y = p.y; orb.vx = 0; orb.vy = 0;
    orb._mazeAttached = true;
    orb._mazeRef = maze;
    orb._anchorIndex = i;
    energyOrbs.push(orb);
  });

  return maze;
}

// Per the user's explicit "when a maze or a space station is completed"
// reward: a single bonus orb, worth 10 points and 2x normal size, flies
// straight across the canvas left-to-right at ordinary orb speed — forced
// to an exact 90-degree (pure horizontal) heading rather than
// pickSpawnPoint()'s usual diagonal-biased range, since it needs to
// traverse the FULL canvas width, not just enter it. `alwaysCollidable`
// for the same reason Station's own fixed orb needs it: a normal orb's
// ~1.6s visibility plateau would fade it out long before a multi-second
// crossing finishes. One per completion (see the call sites' own
// `_playerHasExited` one-shot latch) — not tied to the normal orb spawn
// timer at all.
//
// Doesn't spawn immediately at the exit moment, and doesn't spawn at a
// fixed canvas.height/2 either — per the user's bug report, that landed
// the orb visually on top of the very maze/station the player just
// cleared, since either can still occupy most of the canvas at that
// instant. Queued instead (queueCompletionBonusOrb(), called from the two
// exit-detection sites) — waits BONUS_ORB_SPAWN_DELAY, then positions
// itself fresh off the source obstacle's CURRENT extent once the delay
// elapses (it's still descending the whole time, not a stale snapshot
// from the trigger moment), safely above its top edge.
const BONUS_ORB_RADIUS = 36; // EnergyOrb's own SIZE (18) x the sizeMultiplier passed below (2)

function queueCompletionBonusOrb(sourceType, sourceRef) {
  pendingBonusOrbs.push({ timer: BONUS_ORB_SPAWN_DELAY, sourceType, sourceRef });
}

// Picks a spawn Y above the source obstacle's current top edge (with a
// margin), clamped to stay fully on-screen so it's never spawned already
// past the top edge and immediately culled — falls back to a safe default
// near the canvas top if the source has somehow already cleared/gone by
// the time the delay elapses (shouldn't normally happen: the delay is
// only 1s and the obstacle has much further left to descend at the point
// this fires).
function spawnCompletionBonusOrb(sourceType, sourceRef) {
  let topY = 40;
  if (sourceType === 'maze' && mazes.includes(sourceRef)) {
    topY = sourceRef.y; // Maze's own top boundary
  } else if (sourceType === 'station' && stations.includes(sourceRef)) {
    topY = sourceRef.y - sourceRef.outerR; // Station.y is its CENTER; outerR is the outer ring's own radius
  }
  const margin = 20;
  const minY = BONUS_ORB_RADIUS + 10, maxY = canvas.height - BONUS_ORB_RADIUS - 10;
  const spawnY = Math.max(minY, Math.min(topY - BONUS_ORB_RADIUS - margin, maxY));

  const orb = new EnergyOrb('left', spawnY, [90, 90], canvas.width, pickNextOrbPalette(), {
    alwaysCollidable: true,
    value: 10,
    sizeMultiplier: 2,
  });
  energyOrbs.push(orb);
}

// Station is large/slow enough that waiting for one to fully clear the
// screen before the next spawns left a very long empty gap between
// back-to-back stations. Per the user's explicit request, a new one is
// now allowed to spawn once the CURRENT leader has descended far enough
// that the gap between its own trailing edge and the new one's leading
// edge will be about 30% of the canvas height — not once the leader is
// fully gone. From that point on the gap stays exactly that size forever
// (both stations move at the identical VERTICAL_SPEED, so the distance
// between them, once set, never closes or widens). Derivation: a station
// spawns with its OWN leading edge exactly at y=0 (canvas top) and its
// center at y=-outerR (Station.js's own spawn convention); the leader's
// trailing edge is at `leader.y - leader.outerR`. Setting
// `(leader.y - leader.outerR) - 0 == GAP` and solving for leader.y gives
// the threshold below.
const STATION_BACK_TO_BACK_GAP_FRAC = 0.3; // fraction of canvas height
const MAX_CONCURRENT_STATIONS = 2; // "back to back" means pairs, not an unbounded pile-up — hard cap regardless of timing

function canSpawnNextStation() {
  if (stations.length === 0) return true;
  if (stations.length >= MAX_CONCURRENT_STATIONS) return false;
  const leader = stations[0]; // earliest-spawned == furthest along, since spawnStation() always appends
  const gapTrigger = leader.outerR + STATION_BACK_TO_BACK_GAP_FRAC * canvas.height;
  return leader.y >= gapTrigger;
}

// Zappers always enter from the top pinned to a wall (see Zapper.js) — no
// need for pickSpawnPoint()'s edge/trajectory logic, just a fresh seed per
// instance so no two zappers' beams look identical.
function spawnZapper(side) {
  const arr = side === 'left' ? zappersLeft : zappersRight;
  arr.push(new Zapper(canvas.width, canvas.height, Math.floor(Math.random() * 1e6), side));
}

// Which obstacle type(s) should be SPAWNING new instances this frame — not
// to be confused with which types have objects currently on screen. In
// plain 'asteroids'/'zapper' mode this is just that one type; in
// 'sequence' mode it's whatever the current step's own `obstacles` list
// says (one type, or several for a combined step). Existing on-screen
// objects of ANY type keep updating/drawing/colliding regardless of
// what's in this list — see animate()'s own comment for why that's what
// makes step transitions "seamless" rather than a hard cut.
function currentlySpawningTypes() {
  if (activeObstacleType === 'sequence' && activeSequence) {
    return activeSequence.steps[sequenceStepIndex].obstacles;
  }
  if (activeObstacleType === 'asteroids' || activeObstacleType === 'zapper' || activeObstacleType === 'clusters' || activeObstacleType === 'worms' || activeObstacleType === 'station' || activeObstacleType === 'maze') {
    return [activeObstacleType];
  }
  return [];
}

// Advances activeSequence to its next step — UNLESS the step that just
// finished was the LAST one, in which case the whole sequence has been
// completed and, per the user's explicit spec, that's a WIN: the round
// ends right here (triggerSequenceWin()) instead of wrapping back to
// step 0 and looping forever the way it used to. Every call site that can
// finish a step (the duration timer, and each quantity type's own
// early-exit/off-screen-fallback checks) funnels through this one
// function, so the win check only needs to live here once. Only a type
// that's NEWLY entering the active set (present in the next step, absent
// from the one just finished) gets its spawn timer/lifetime-budget reset
// — a type that was already active straight across the boundary keeps
// ticking exactly as it was, untouched, which is what makes the join
// feel seamless rather than restarting everything at every step.
function advanceSequenceStep() {
  if (sequenceStepIndex === activeSequence.steps.length - 1) {
    triggerSequenceWin();
    // Critical: if the LAST step happens to be duration-based, this was
    // called from animate()'s own `while (sequenceStepElapsed >=
    // ...duration) { advanceSequenceStep(); }` loop — without resetting
    // sequenceStepElapsed here, that condition would stay permanently
    // true (sequenceStepIndex never advances past this point once
    // isGameOver is set) and spin forever in a synchronous infinite loop,
    // freezing the tab. Resetting it is a no-op for every OTHER call path
    // (the quantity-based ones don't read this variable at all), so this
    // is always safe, not just conditionally needed.
    sequenceStepElapsed = 0;
    return;
  }
  const prevObstacles = activeSequence.steps[sequenceStepIndex].obstacles;
  sequenceStepIndex = (sequenceStepIndex + 1) % activeSequence.steps.length;
  const nextObstacles = activeSequence.steps[sequenceStepIndex].obstacles;

  // A step is either duration-based (the original model — every obstacle
  // type except station/maze) or quantity-based (station or maze, per the
  // user's explicit spec: `{ "obstacles": ["station"], "quantity": n }` /
  // `{ "obstacles": ["maze"], "quantity": n }` instead of a `duration`) —
  // reset all four trackers unconditionally on every step change rather
  // than only the ones the new step actually uses, so a leftover value
  // from whichever kind of step ran before this one can
  // never bleed into the new step's own timing (e.g. a stale elapsed-time
  // remainder from a duration step silently eating into a LATER duration
  // step's own countdown after a quantity step ran in between).
  sequenceStepElapsed = 0;
  sequenceStationSpawnCount = 0;
  sequenceStationQuantityLastRef = null;
  sequenceMazeSpawnCount = 0;
  sequenceMazeQuantityLastRef = null;

  // SEQUENCE_STEP_ENTRY_DELAY (not 0, and not a full rolled interval)
  // before the first instance of a newly-active type appears — a short
  // breathing gap right at the transition instead of stacking on top of
  // the outgoing type's own built-up density, per the user's explicit
  // request (see that constant's own comment). Every spawn AFTER that
  // first one still uses the normal rolled interval.
  if (nextObstacles.includes('asteroids') && !prevObstacles.includes('asteroids')) {
    nextSpawnIn = SEQUENCE_STEP_ENTRY_DELAY;
  }
  if (nextObstacles.includes('clusters') && !prevObstacles.includes('clusters')) {
    nextClusterSpawnIn = SEQUENCE_STEP_ENTRY_DELAY;
  }
  if (nextObstacles.includes('worms') && !prevObstacles.includes('worms')) {
    nextWormSpawnIn = SEQUENCE_STEP_ENTRY_DELAY;
  }
  if (nextObstacles.includes('station') && !prevObstacles.includes('station')) {
    nextStationSpawnIn = SEQUENCE_STEP_ENTRY_DELAY;
  }
  if (nextObstacles.includes('maze') && !prevObstacles.includes('maze')) {
    nextMazeSpawnIn = SEQUENCE_STEP_ENTRY_DELAY;
  }
  if (nextObstacles.includes('zapper') && !prevObstacles.includes('zapper')) {
    zappersSpawnedLeft = 0;
    zappersSpawnedRight = 0;
    nextZapperSpawnInLeft = SEQUENCE_STEP_ENTRY_DELAY; // left wall's first zapper appears after the same breathing gap
    nextZapperSpawnInRight = SEQUENCE_STEP_ENTRY_DELAY + ZAPPER_CREATION_INTERVAL_BASE / 2; // right wall still offset by half a period on top of that, same alternating pattern as always
  }
}

// The player has cleared every step of the sequence — per the user's
// explicit spec, that's a WIN. Per their later "let the game continue for
// 2 seconds" follow-up, this does NOT end the round immediately — it
// starts the SEQUENCE_WIN_DELAY countdown (see its own comment, and the
// countdown block near the top of animate()) so the screen keeps
// scrolling with no new spawns and no lethal risk for a couple of
// seconds first. isGameOver only flips once that countdown reaches 0, at
// which point the existing final-summary block picks up
// `sequenceCompleted` (set here, immediately) to show a congratulations
// message and force the confetti celebration instead of the normal score
// summary.
function triggerSequenceWin() {
  sequenceCompleted = true;
  sequenceWinDelay = SEQUENCE_WIN_DELAY;
}

// Picks a random palette that ISN'T whichever one the last-spawned shard
// used — same "not the same as last time" pattern Bar.js already uses for
// its own neon hues, just applied to shard colors instead.
function pickNextShardPalette() {
  const choices = SHARD_PALETTES.filter((p) => p !== lastShardPalette);
  const palette = choices[Math.floor(Math.random() * choices.length)];
  lastShardPalette = palette;
  return palette;
}

function spawnStarShard() {
  const { edge, coord, angleRangeDeg } = pickSpawnPoint();
  const palette = pickNextShardPalette();
  starShards.push(new StarShard(edge, coord, angleRangeDeg, canvas.width, palette));
}

// Same "not the same as last time" pattern as pickNextShardPalette(), just
// its own separate rotation — an orb never repeats the last ORB color,
// independent of whatever the most recent shard color was.
function pickNextOrbPalette() {
  const choices = ORB_PALETTES.filter((p) => p !== lastOrbPalette);
  const palette = choices[Math.floor(Math.random() * choices.length)];
  lastOrbPalette = palette;
  return palette;
}

// Spawns/moves exactly like spawnStarShard() (same shared pickSpawnPoint()
// helper) — only the class, palette rotation, and timing differ.
function spawnEnergyOrb() {
  const { edge, coord, angleRangeDeg } = pickSpawnPoint();
  const palette = pickNextOrbPalette();
  energyOrbs.push(new EnergyOrb(edge, coord, angleRangeDeg, canvas.width, palette));
}

// Approximate collision radius for an irregular, possibly-elongated
// asteroid: the average of its two axes (size and size*elongation), shrunk
// a little — near-misses at the jagged visual edge should still feel fair
// rather than cheap, same idea flagged in the original design pass. Reused
// for both the player-vs-asteroid and shard-vs-asteroid checks below.
function asteroidCollisionRadius(a) {
  return a.size * ((1 + a.elongation) / 2) * 0.85;
}

function circlesOverlap(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2, dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy) < r1 + r2;
}

// True if the circle (x, y, radius) is touching ANY currently on-screen
// asteroid or zapper (body or beam) — checked unconditionally against
// both arrays regardless of which type(s) are currently SPAWNING. That's
// what makes "seamless join" work: a straggler asteroid left over from a
// step that's since ended is still exactly as hazardous as it always was,
// right up until it drifts off-screen on its own. Used for the player
// check, and for both collectibles' "destroyed before caught" check.
function hitByAnyObstacle(x, y, radius) {
  for (let j = 0; j < asteroids.length; j++) {
    if (circlesOverlap(x, y, radius, asteroids[j].x, asteroids[j].y, asteroidCollisionRadius(asteroids[j]))) return true;
  }
  // Same self-contained hitsCircle() idiom as the zappers below — a Cluster
  // instance decides internally whether that means "hit the intact sphere"
  // or "hit one of its flying shots" depending on its own current phase.
  if (clusters.some((c) => c.hitsCircle(x, y, radius))) return true;
  // Same self-contained hitsCircle() idiom again — a Worm checks every one
  // of its own segments internally, not just the head.
  if (worms.some((w) => w.hitsCircle(x, y, radius))) return true;
  // Station's own hull/rings are NOT lethal — they're a physical constraint
  // instead, resolved separately in animate() via resolveSolid(), per the
  // user's explicit spec. Only its spokes' electric arcs are lethal, same
  // as every other obstacle's touch-to-die rule — see Station.js's own
  // header comment for the full split.
  if (stations.some((s) => s.hitsLethal(x, y, radius))) return true;
  // Maze's own doors/walls are the same non-lethal physical-constraint
  // deal as Station's rings — but the skull that patrols the maze IS
  // lethal, same touch-to-die rule as everything else here (see Maze.js's
  // own header comment on the skull for the full spec).
  if (mazes.some((m) => m.touchesSkull(x, y, radius))) return true;
  return zappersLeft.some((z) => z.hitsCircle(x, y, radius)) || zappersRight.some((z) => z.hitsCircle(x, y, radius));
}

// Same particle burst JEWELZ uses for both its jewel-collect sparkle and
// player-hit explosion — see games/jewelz/index.js's createExplosion() for
// the fuller explanation.
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

function drawEverything() {
  starfield.draw(ctx); // paints the base background color too, so this replaces the old ctx.clearRect()

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

  starShards.forEach((s) => s.draw(ctx));
  energyOrbs.forEach((o) => o.draw(ctx));
  // Always drawn regardless of which type(s) are currently spawning — an
  // empty array here is a harmless no-op, and a straggler from a finished
  // sequence step still needs to be drawn right up until it clears.
  asteroids.forEach((a) => a.draw(ctx));
  clusters.forEach((c) => c.draw(ctx));
  worms.forEach((w) => w.draw(ctx));
  stations.forEach((s) => s.draw(ctx));
  mazes.forEach((m) => m.draw(ctx));
  zappersLeft.forEach((z) => z.draw(ctx));
  zappersRight.forEach((z) => z.draw(ctx));

  if (!isPlayerExploded) {
    // Antenna hidden while inside the station's outer ring, or the maze's
    // own vertical span — a plain cut, no animation, per the user's
    // explicit "no animation required" call (extended to Maze the same way).
    drawPlayerFace(ctx, player.x, player.y, player.radius, survivalTime, !playerInsideStation && !playerInsideMaze);
  }
}

// Builds the end-of-round message, based on how this round's score compares
// to the player's previous best — same structure (and same score === 0
// special case) as JEWELZ's own buildResultLine(). Says "points" rather
// than "star shards caught" since score is now a mix of 1-point shards and
// 3-point energy orbs, not a literal shard count.
//
// Written as real <p> tags (one per sentence), same authoring convention
// as the instructions panel, rather than one string with <br> line breaks
// — that's what lets shared/shell.css's .shell-end-screen__message p rule
// give this the exact same line-height and inter-sentence spacing as the
// instructions panel instead of its own separate rhythm. The first <p>
// also carries shell-end-screen__title so just that line reads as the
// panel's centered title, while the rest stays left-aligned underneath it.
function buildResultLine(finalScore, result) {
  if (finalScore === 0) {
    return `<p class="shell-end-screen__title"><strong>OH NO!! 😢</strong></p><p>You failed to score today</p><p>Better luck tomorrow</p>`;
  }
  const hasNoMeaningfulBest = result.previousBest === null || result.previousBest === 0;
  if (!hasNoMeaningfulBest && result.isNewBest) {
    return `<p class="shell-end-screen__title"><strong>AMAZING!!! 🏆🥇🥳</strong></p><p>You scored ${finalScore} points</p><p>That is a new <strong style="color: var(--shell-accent)">PERSONAL BEST</strong></p>`;
  }
  if (!hasNoMeaningfulBest && result.isTie) {
    return `<p class="shell-end-screen__title"><strong>CONGRATULATIONS 😊</strong></p><p>You equaled your best of ${finalScore} points</p><p>Try for a personal best tomorrow</p>`;
  }
  return `<p class="shell-end-screen__title"><strong>WELL DONE 👍</strong></p><p>You scored ${finalScore} points</p><p>Try and do better tomorrow</p>`;
}

// Shown instead of buildResultLine() when the round ended via
// triggerSequenceWin() (the player cleared every step of the sequence)
// rather than a death — same <p>-per-sentence/title-class convention, but
// a genuine congratulations rather than a score comparison, since
// finishing the whole sequence is the actual achievement here regardless
// of how the score stacks up against a previous best.
function buildVictoryLine(finalScore) {
  return `<p class="shell-end-screen__title"><strong>🎉 YOU WON!!! 🎉</strong></p><p>You made it through every obstacle WARPZ has and scored ${finalScore} points</p><p>Outstanding flying, Commander</p>`;
}

function animate(currentTime) {
  if (finalSummaryProcessed || pageIsUnloading) return;

  // Clamped so a stalled frame (tab backgrounded, GC pause, slow device)
  // can't hand every obstacle a huge dt on the frame it resumes — without
  // this, a fast-moving cluster in particular can jump straight through
  // (and past) the position it was supposed to stop at in a single step.
  const deltaTime = Math.min(0.05, (currentTime - lastTime) / 1000);
  lastTime = currentTime;

  // Always drifts, win/lose/mid-round alike — this is pure background
  // decoration with no gameplay meaning, unlike the asteroids/shards below
  // (which freeze in place once the round ends).
  starfield.update(deltaTime);

  // Counts down the "let the game keep running for a couple seconds"
  // window triggerSequenceWin() started — checked/updated BEFORE the main
  // !isGameOver block below so that once it reaches 0, the very same
  // frame's own spawning/collision checks already see the updated
  // isGameOver.
  if (sequenceCompleted && !isGameOver) {
    sequenceWinDelay -= deltaTime;
    if (sequenceWinDelay <= 0) {
      isGameOver = true;
      isDragging = false;
    }
  }

  if (!isGameOver) {
    survivalTime += deltaTime;
    shell.timer.setSeconds(survivalTime);

    // Sequence engine: advances BEFORE this frame's spawning decisions
    // below, so a step boundary crossed mid-frame takes effect immediately
    // rather than one frame late. A while loop (not if) so a pathologically
    // short step duration or a lag spike can't get stuck mid-transition.
    //
    // Only a DURATION-based step advances here, on a continuous timer — a
    // QUANTITY-based step (station's `{ obstacles: ["station"],
    // quantity: n }` form, or maze's identical `{ obstacles: ["maze"],
    // quantity: n }`, see sequences.json) has no timer at all; it advances
    // instead the moment its nth station/maze has spawned AND been
    // successfully exited, from inside that type's own spawning block
    // further down, since spawn/exit events are discrete rather than
    // something a per-frame elapsed-time check can watch for.
    if (activeObstacleType === 'sequence' && activeSequence) {
      const currentStep = activeSequence.steps[sequenceStepIndex];
      if (currentStep.duration !== undefined) {
        sequenceStepElapsed += deltaTime;
        while (sequenceStepElapsed >= activeSequence.steps[sequenceStepIndex].duration) {
          advanceSequenceStep();
        }
      }
    }

    // Which type(s) are allowed to spawn NEW instances this frame — see
    // currentlySpawningTypes()'s own comment. Existing on-screen objects of
    // every type still update/move/get collision-checked below regardless
    // of this list; only the SPAWNING of new ones is gated by it. In plain
    // 'asteroids'/'zapper' mode this is exactly the same one-type gating
    // this file always had — the refactor only changes behavior once
    // 'sequence' mode can have more than one type active, or a straggler
    // left over from a step that's since ended.
    //
    // Forced empty once sequenceCompleted (the win is decided, just
    // waiting out SEQUENCE_WIN_DELAY before the panel shows) — no new
    // obstacle should appear during that window; existing ones keep
    // moving/drawing/animating completely normally, only NEW spawns are
    // gated by this.
    const spawningTypes = sequenceCompleted ? [] : currentlySpawningTypes();

    // Hard, sequence-agnostic rule per the user's explicit spec: while a
    // station OR MAZE the player hasn't successfully gotten through yet is
    // still around, NO other obstacle type may spawn — full stop,
    // regardless of what the current step's own `obstacles` list says.
    // This is deliberately a second, independent enforcement point on top
    // of the sequence-authoring convention of never listing station/maze
    // alongside another type in the same step.
    //
    // "Hasn't gotten through yet" is `!_playerHasExited` (see
    // spawnStation()'s/spawnMaze()'s own comments) rather than raw
    // presence in the array — per the user's later, explicit correction,
    // once the player has successfully exited a station/maze it's done
    // blocking other obstacles even though it's still visibly descending
    // off the bottom of the canvas; waiting for it to fully leave was the
    // exact behavior they asked to change. One the player never entered
    // still blocks normally until it clears on its own (isOffScreen()
    // removes it from `stations`/`mazes` entirely, at which point it can
    // no longer appear here).
    //
    // Each half scoped to its own `spawningTypes.includes(...)` — only a
    // station/maze belonging to the CURRENT step can block. Without this,
    // a quantity step spawning more than one station (e.g. quantity: 2)
    // has a real gap: the sequence already advances once its LAST station
    // is exited (see sequenceStationQuantityLastRef), but an EARLIER
    // station from that same step can easily still be sitting un-exited
    // in `stations` (the player often never circles back "above" it once
    // they've moved on to the next one) — without this scoping, that
    // straggler blocked every later step forever, a real reported bug.
    // Once the sequence has genuinely moved past 'station'/'maze', a
    // leftover un-exited straggler is just that: a straggler, exactly
    // like every other obstacle type's own stragglers, which are
    // hazardous but never block new spawning. (Maze only ever has 0 or 1
    // instances at once, so its own half of this is simpler in practice,
    // but the same reasoning still applies if that ever changes.)
    const stationBlocking = spawningTypes.includes('station') && stations.some((s) => !s._playerHasExited);
    const mazeBlocking = spawningTypes.includes('maze') && mazes.some((m) => !m._playerHasExited);
    const stillBlocking = stationBlocking || mazeBlocking;
    const effectiveSpawningTypes = stillBlocking
      ? spawningTypes.filter((t) => t === 'station' || t === 'maze')
      : spawningTypes;

    if (effectiveSpawningTypes.includes('asteroids')) {
      nextSpawnIn -= deltaTime;
      if (nextSpawnIn <= 0) {
        spawnAsteroid();
        nextSpawnIn = rollSpawnInterval();
      }
    }
    asteroids.forEach((a) => a.update(deltaTime));
    asteroids = asteroids.filter((a) => !a.isOffScreen(canvas.width, canvas.height));

    // Spawn timing started as a straight reuse of rollSpawnInterval() (the
    // asteroids' own), per the user's original "density... the same as
    // asteroids" request — later given its own faster interval via
    // rollWormSpawnInterval(), see WORM_CREATION_INTERVAL_BASE's own comment.
    if (effectiveSpawningTypes.includes('worms')) {
      nextWormSpawnIn -= deltaTime;
      if (nextWormSpawnIn <= 0) {
        spawnWorm();
        nextWormSpawnIn = rollWormSpawnInterval();
      }
    }
    worms.forEach((w) => w.update(deltaTime));
    worms = worms.filter((w) => !w.isOffScreen(canvas.width, canvas.height));

    // Up to MAX_CONCURRENT_CLUSTERS at a time: the countdown only runs
    // while there's a free slot, so it's really "CLUSTER_RESPAWN_DELAY
    // after a slot opened up" rather than a continuously-ticking
    // independent timer — see that constant's own comment.
    if (effectiveSpawningTypes.includes('clusters') && clusters.length < MAX_CONCURRENT_CLUSTERS) {
      nextClusterSpawnIn -= deltaTime;
      if (nextClusterSpawnIn <= 0) {
        spawnCluster();
        nextClusterSpawnIn = CLUSTER_RESPAWN_DELAY;
      }
    }
    // A plain forEach can't enforce the 1.5s-apart rule below — two
    // clusters both fully charged in the SAME frame would both read
    // cooldown<=0 and both explode together. A sequential for..of lets an
    // explosion earlier in this same loop immediately reset the cooldown
    // before the next cluster in the array gets its turn.
    clusterExplosionCooldown = Math.max(0, clusterExplosionCooldown - deltaTime);
    for (const c of clusters) {
      const wasCharging = c.phase === 'charging';
      c.update(deltaTime, clusterExplosionCooldown <= 0);
      if (wasCharging && c.phase === 'exploding') {
        clusterExplosionCooldown = CLUSTER_EXPLOSION_COOLDOWN; // per the user's explicit "never within 1.5s of each other" request
      }
    }
    clusters = clusters.filter((c) => !c.isDone());

    if (effectiveSpawningTypes.includes('zapper')) {
      nextZapperSpawnInLeft -= deltaTime;
      if (nextZapperSpawnInLeft <= 0) {
        // Timer still rolls even when skipped (either cap), so hitting one
        // doesn't cause a burst once room frees up or... well, the lifetime
        // cap never frees up, but the concurrent one can.
        if (zappersLeft.length < MAX_ZAPPERS_PER_SIDE && zappersSpawnedLeft < TOTAL_ZAPPERS_PER_SIDE) {
          spawnZapper('left');
          zappersSpawnedLeft += 1;
        }
        nextZapperSpawnInLeft = rollZapperSpawnInterval();
      }
      nextZapperSpawnInRight -= deltaTime;
      if (nextZapperSpawnInRight <= 0) {
        if (zappersRight.length < MAX_ZAPPERS_PER_SIDE && zappersSpawnedRight < TOTAL_ZAPPERS_PER_SIDE) {
          spawnZapper('right');
          zappersSpawnedRight += 1;
        }
        nextZapperSpawnInRight = rollZapperSpawnInterval();
      }
    }
    zappersLeft.forEach((z) => z.update(deltaTime));
    zappersRight.forEach((z) => z.update(deltaTime));
    zappersLeft = zappersLeft.filter((z) => !z.isOffScreen());
    zappersRight = zappersRight.filter((z) => !z.isOffScreen());

    // Whether this step's own requested station/maze quantity has already
    // been fully SPAWNED (only meaningful for a quantity-based step) —
    // stops any further spawning once reached, but deliberately does NOT
    // hand off to the next step here. That handoff only happens once the
    // last one has also fully CLEARED the screen (see the checks next to
    // each type's own clear-cleanup below) — advancing the instant it
    // spawned was the actual bug the user reported: the very next
    // obstacle type could start spawning while that last station was
    // still fully on screen.
    let stationQuantityFulfilled = false;
    let mazeQuantityFulfilled = false;
    if (activeObstacleType === 'sequence' && activeSequence) {
      const currentStep = activeSequence.steps[sequenceStepIndex];
      if (currentStep.quantity !== undefined) {
        stationQuantityFulfilled = sequenceStationSpawnCount >= currentStep.quantity;
        mazeQuantityFulfilled = sequenceMazeSpawnCount >= currentStep.quantity;
      }
    }

    // Station: back-to-back ones are allowed a limited overlap now (see
    // canSpawnNextStation()'s own comment) — spawning is otherwise gated
    // the same "newly-active type" way every other field obstacle's timer
    // is.
    if (effectiveSpawningTypes.includes('station') && !stationQuantityFulfilled) {
      nextStationSpawnIn -= deltaTime;
      if (nextStationSpawnIn <= 0 && canSpawnNextStation()) {
        const spawned = spawnStation();
        nextStationSpawnIn = STATION_RESPAWN_DELAY;
        if (activeObstacleType === 'sequence' && activeSequence) {
          const currentStep = activeSequence.steps[sequenceStepIndex];
          if (currentStep.quantity !== undefined) {
            sequenceStationSpawnCount += 1;
            // This is the step's own "last space station" once its count
            // is fulfilled — watched below so the step can advance as soon
            // as the player exits it, per the user's explicit request, well
            // before it necessarily leaves the canvas.
            if (sequenceStationSpawnCount >= currentStep.quantity) sequenceStationQuantityLastRef = spawned;
          }
        }
      }
    }
    // Maze: only one at a time (see MAZE_RESPAWN_DELAY's own comment), no
    // back-to-back overlap logic like Station's — it's tall enough that
    // one alone already takes roughly a minute to fully clear. Quantity
    // form (`{ "obstacles": ["maze"], "quantity": n }`, per the user's
    // explicit spec) works exactly like station's own above, just against
    // `mazes`/`sequenceMazeSpawnCount`/`sequenceMazeQuantityLastRef`.
    if (effectiveSpawningTypes.includes('maze') && !mazeQuantityFulfilled) {
      nextMazeSpawnIn -= deltaTime;
      if (nextMazeSpawnIn <= 0 && mazes.length === 0) {
        const spawned = spawnMaze();
        nextMazeSpawnIn = MAZE_RESPAWN_DELAY;
        if (activeObstacleType === 'sequence' && activeSequence) {
          const currentStep = activeSequence.steps[sequenceStepIndex];
          if (currentStep.quantity !== undefined) {
            sequenceMazeSpawnCount += 1;
            if (sequenceMazeSpawnCount >= currentStep.quantity) sequenceMazeQuantityLastRef = spawned;
          }
        }
      }
    }
    mazes.forEach((m) => m.update(deltaTime));
    const mazesBeforeFilter = mazes;
    mazes = mazes.filter((m) => !m.isOffScreen());
    const clearedMazes = mazesBeforeFilter.filter((m) => !mazes.includes(m));
    if (clearedMazes.length > 0) {
      // Same reasoning as the station-clear cleanup below: a shard/orb
      // anchored to a maze that just cleared the bottom of the screen has
      // nothing left to be anchored to, so it goes with it.
      starShards = starShards.filter((sh) => !sh._mazeAttached || !clearedMazes.includes(sh._mazeRef));
      energyOrbs = energyOrbs.filter((o) => !o._mazeAttached || !clearedMazes.includes(o._mazeRef));

      // Same station-mirroring "quantity step only hands off once
      // everything it spawned has fully cleared" fallback — the normal
      // path is the early-advance-on-exit check further down (fires the
      // instant the player exits, well before this), this only matters if
      // the player never entered at all and the maze had to clear on its
      // own.
      if (mazes.length === 0 && activeObstacleType === 'sequence' && activeSequence) {
        const currentStep = activeSequence.steps[sequenceStepIndex];
        if (currentStep.quantity !== undefined && sequenceMazeSpawnCount >= currentStep.quantity) {
          advanceSequenceStep();
        }
      }
    }

    // player.x/y here is last frame's fully-resolved position (this
    // frame's own solid resolution hasn't run yet) — a one-frame-old read
    // is fine for deciding whether a door should hold open, same tolerance
    // every other per-frame decision in this file already has.
    stations.forEach((s) => s.update(deltaTime, player.x, player.y));
    const stationsBeforeFilter = stations;
    stations = stations.filter((s) => !s.isOffScreen());
    const clearedStations = stationsBeforeFilter.filter((s) => !stations.includes(s));
    if (clearedStations.length > 0) {
      // One or more stations just cleared the bottom of the screen — any
      // shard/orb anchored to ONE OF THOSE SPECIFIC stations goes with it
      // (nothing left for it to be anchored to), rather than freezing in
      // place forever. Checked per-station (not just "did the count reach
      // zero") since back-to-back stations can now briefly coexist (see
      // canSpawnNextStation()) — the leader clearing first must not touch
      // the follower's own still-active collectibles.
      starShards = starShards.filter((sh) => !sh._stationAttached || !clearedStations.includes(sh._stationRef));
      energyOrbs = energyOrbs.filter((o) => !o._stationAttached || !clearedStations.includes(o._stationRef));

      // A quantity-based station step only hands off to the next step
      // once EVERY station it spawned has fully cleared (not just one of
      // several currently-coexisting ones), and not the instant the last
      // one spawned either (see stationQuantityFulfilled's own comment
      // above) — this is the exact moment that's true, so it's the right
      // place to check.
      if (stations.length === 0 && activeObstacleType === 'sequence' && activeSequence) {
        const currentStep = activeSequence.steps[sequenceStepIndex];
        if (currentStep.quantity !== undefined && sequenceStationSpawnCount >= currentStep.quantity) {
          advanceSequenceStep();
        }
      }
    }

    // Physical-constraint resolution runs unconditionally against whatever
    // stations currently exist (same "a straggler is still just as
    // hazardous" pattern hitByAnyObstacle already follows for lethal
    // obstacles) — every frame, not just on drag input, since the
    // station's OWN descent can carry its hull into a player who hasn't
    // moved at all. Per the user's explicit "slide along the surface"
    // choice, this only corrects the axis actually being penetrated —
    // player.x/y are updated in place so every later read this frame
    // (collision checks, drawing) sees the corrected position.
    stations.forEach((s) => {
      const resolved = s.resolveSolid(player.x, player.y, player.radius);
      player.x = resolved.x;
      player.y = resolved.y;
    });
    // Same physical-constraint treatment for Maze — its own doors/walls
    // block movement exactly the same way, per the user's explicit "very
    // much like the station" spec.
    mazes.forEach((m) => {
      const resolved = m.resolveSolid(player.x, player.y, player.radius);
      player.x = resolved.x;
      player.y = resolved.y;
    });

    // Absolute, unconditional safety net: the canvas edge is a harder
    // constraint than any obstacle's own solid geometry, and needs
    // enforcing here too, not just in onMove's drag clamp. The outer
    // ring's own reach (rOuter + player radius) is actually WIDER than the
    // canvas can accommodate while staying outside it — dead center-side
    // (and dead bottom, as the station exits the screen), "held outside"
    // would require going past the canvas edge entirely. That gap is real
    // geometry (the ring is deliberately sized nearly as wide as the
    // canvas specifically so there's no way around it — see Station.js's
    // own header comment), not a bug to design around: the correct
    // behavior is the player gets physically pinned at the canvas edge,
    // unable to slide any further around that side, rather than sliding
    // straight off it. This clamp is what turns "ring pushed them past the
    // edge" into "pinned at the edge" instead of "off-canvas."
    player.x = Math.max(player.radius, Math.min(player.x, canvas.width - player.radius));
    player.y = Math.max(player.radius, Math.min(player.y, canvas.height - player.radius));

    // Per the user's explicit rule: pinned at the canvas's BOTTOM edge
    // while touching either ring is a crush death — but the same contact
    // at the left, right, or top edges is not (the player can still be
    // carried/slid along there, no death). containsPlayer()'s own
    // dead-center "trapped inside" branch below can't catch this: a player
    // pinned at a bottom CORNER stays well outside containsPlayer()'s
    // distance-from-center threshold even while genuinely squeezed
    // between the floor (the canvas clamp above already stopped them
    // going any further down) and the ring's material pressing from
    // above — so this needs its own check, scoped tightly to the bottom
    // edge specifically. (An earlier, broader "crush from outside" check
    // that fired at ANY edge was removed for false-positiving at the
    // left/right edges — this one is deliberately bottom-only, per the
    // user's own correction, not a return to that removed check.)
    if (!isGameOver && !sequenceCompleted) {
      const atBottomEdge = player.y >= canvas.height - player.radius - 0.5;
      if (
        atBottomEdge &&
        (stations.some((s) => s.touchesRing(player.x, player.y, player.radius)) ||
          mazes.some((m) => m.touchesWall(player.x, player.y, player.radius)))
      ) {
        isGameOver = true;
        isDragging = false;
        isPlayerExploded = true;
        createExplosion(player.x, player.y, '#1e90ff', 6, 25);
        createExplosion(player.x, player.y, '#ffa502', 4, 15);
      }
    }

    // Per-station "was inside, now fully clear" tracking (see
    // spawnStation()'s own comment on _wasEverInside/_playerHasExited).
    // `_wasEverInside` still rides on the same containsPlayer() check
    // playerInsideStation itself needs — but `_playerHasExited` uses the
    // STRICTER hasFullyExitedOuterRing() (past the ring's OUTER face, not
    // just its inner one), per the user's own bugfix report: using
    // containsPlayer() here let the next obstacle/sequence step resume
    // while the player was still mid-crossing through the door, still
    // physically within the ring's own hull thickness — see that
    // method's own comment in Station.js.
    playerInsideStation = false;
    stations.forEach((s) => {
      const inside = s.containsPlayer(player.x, player.y);
      if (inside) {
        playerInsideStation = true;
        s._wasEverInside = true;
      }
      // `!s._playerHasExited` makes this fire exactly once per station —
      // `_playerHasExited` itself is the one-shot latch, per the user's
      // explicit "when a station is completed" bonus-orb request.
      if (s._wasEverInside && !s._playerHasExited && s.hasFullyExitedOuterRing(player.x, player.y)) {
        s._playerHasExited = true;
        queueCompletionBonusOrb('station', s);
      }
    });

    // Maze antenna-hide + completion tracking. `_wasEverInside` rides on
    // the same containsPlayer() check playerInsideMaze itself needs.
    // "Exited" is simpler than Station's own hasFullyExitedOuterRing(): the
    // maze's boundary is solid on every side except the single top exit
    // gap and single bottom entrance gap, so a player who was once inside
    // and is now physically above the maze's own top edge (`player.y <
    // m.y`) can only have gotten there by passing through that exit gap —
    // no separate "outer face" concept needed the way a ring has one.
    // `!m._playerHasExited` makes the bonus-orb spawn a one-shot per maze,
    // same latch pattern as Station's own block just above.
    playerInsideMaze = false;
    mazes.forEach((m) => {
      const inside = m.containsPlayer(player.x, player.y);
      if (inside) {
        playerInsideMaze = true;
        m._wasEverInside = true;
      }
      if (m._wasEverInside && !m._playerHasExited && player.y < m.y) {
        m._playerHasExited = true;
        queueCompletionBonusOrb('maze', m);
      }
    });

    // Fire any queued completion bonus orbs whose delay has elapsed — see
    // queueCompletionBonusOrb()'s own comment for why this waits instead
    // of spawning immediately at the exit moment.
    pendingBonusOrbs.forEach((p) => { p.timer -= deltaTime; });
    pendingBonusOrbs.filter((p) => p.timer <= 0).forEach((p) => spawnCompletionBonusOrb(p.sourceType, p.sourceRef));
    pendingBonusOrbs = pendingBonusOrbs.filter((p) => p.timer > 0);

    // Quantity-based sequence step, early advance: per the user's explicit
    // request, don't wait for this step's own "last space station" to
    // leave the canvas — advance the moment the player has successfully
    // exited it. (If the player never enters it at all, this simply never
    // fires and the existing off-screen-based fallback in the station-
    // clear cleanup block above still applies, so the sequence can never
    // get stuck waiting on an exit that isn't coming.)
    // Guarded with !sequenceCompleted: without it, once the LAST step's
    // exit triggers a win, sequenceStationQuantityLastRef/_playerHasExited
    // stay true forever and this would re-fire advanceSequenceStep() (and
    // therefore triggerSequenceWin(), resetting sequenceWinDelay back to
    // SEQUENCE_WIN_DELAY) on every single subsequent frame — the win-delay
    // countdown could then never reach zero, so isGameOver never flips and
    // no end screen ever shows. Non-last-step advances don't need this
    // (they null out *QuantityLastRef as part of the normal reset), only
    // the win path leaves those refs set afterward.
    if (!sequenceCompleted && sequenceStationQuantityLastRef && sequenceStationQuantityLastRef._playerHasExited
      && activeObstacleType === 'sequence' && activeSequence) {
      const currentStep = activeSequence.steps[sequenceStepIndex];
      if (currentStep.quantity !== undefined && sequenceStationSpawnCount >= currentStep.quantity) {
        advanceSequenceStep();
      }
    }
    // Same early-advance, mirrored for maze's own quantity form.
    if (!sequenceCompleted && sequenceMazeQuantityLastRef && sequenceMazeQuantityLastRef._playerHasExited
      && activeObstacleType === 'sequence' && activeSequence) {
      const currentStep = activeSequence.steps[sequenceStepIndex];
      if (currentStep.quantity !== undefined && sequenceMazeSpawnCount >= currentStep.quantity) {
        advanceSequenceStep();
      }
    }

    if (playerInsideStation && !isGameOver && !sequenceCompleted) {
      // Carried down with the station while trapped inside, per the user's
      // explicit "if the user cannot find a way out by the time [they]
      // reach the bottom of the canvas, they explode" rule — reusing the
      // same bottom clamp the drag input already respects. Checked here
      // (not folded into the hitByAnyObstacle block below) since this
      // isn't a touch-something-lethal death, it's a separate "ran out of
      // room" one, but it reuses the exact same explosion effect.
      player.y = Math.min(canvas.height - player.radius, player.y + STATION_CARRY_SPEED * deltaTime);
      if (player.y >= canvas.height - player.radius - 0.01) {
        isGameOver = true;
        isDragging = false;
        isPlayerExploded = true;
        createExplosion(player.x, player.y, '#1e90ff', 6, 25);
        createExplosion(player.x, player.y, '#ffa502', 4, 15);
      }
    }

    updateObstacleDebugLabel(); // keeps the on-screen (N/MAX)/sequence-step text live every frame

    // Shard/orb spawning+movement is independent of which obstacle type is
    // active in general (established for shards, extended to orbs the same
    // way) — EXCEPT while station is the only thing eligible to spawn, per
    // the user's explicit "stop flying across the canvas" request for
    // station mode: a station brings its own fixed, anchored set instead
    // (see spawnStation()), so the normal random spawn timers are simply
    // paused rather than also producing free-flying ones alongside them.
    //
    // Resuming is tied to `effectiveSpawningTypes` (whether some NON-
    // station type is actually eligible to spawn right now), not to
    // whether a station still physically exists on screen — per the
    // user's explicit correction, shard/orb spawning should resume the
    // moment the NEXT obstacle (asteroids, or whatever the sequence lines
    // up next) starts being eligible, same moment the exclusivity guard
    // above relaxes, not linger until the station has fully scrolled off
    // — UNLESS that next obstacle is ALSO a station, in which case they
    // stay paused (its own anchored set takes over instead, same as now).
    // Maze gets the identical treatment now that it brings its own
    // attached shard/orb set too (see spawnMaze()'s own comment).
    const otherObstaclesSpawning = effectiveSpawningTypes.some((t) => t !== 'station' && t !== 'maze');

    if (otherObstaclesSpawning) {
      nextShardSpawnIn -= deltaTime;
      if (nextShardSpawnIn <= 0) {
        spawnStarShard();
        nextShardSpawnIn = rollShardSpawnInterval();
      }
    }
    if (otherObstaclesSpawning) {
      nextOrbSpawnIn -= deltaTime;
      if (nextOrbSpawnIn <= 0) {
        spawnEnergyOrb();
        nextOrbSpawnIn = rollOrbSpawnInterval();
      }
    }

    // Repositioning any STILL-EXISTING attached shards/orb is a separate
    // concern from the spawn-gating above — as long as a station instance
    // is physically present (regardless of exit status), its own attached
    // collectibles still need tracking every frame until it actually
    // clears (see the station-clear cleanup block above), so this stays
    // tied to raw presence, not `otherObstaclesSpawning`.
    const stationActive = stations.length > 0;

    // Station-anchored shards/orb are repositioned from THEIR OWN station's
    // (already updated earlier this frame) collectibleAnchors() — each
    // one's own `_stationRef`, not stations[0], since back-to-back
    // stations can now briefly coexist (see canSpawnNextStation()) and a
    // follower's collectibles must never be positioned using the leader's
    // geometry. Done BEFORE the normal update()/isOffScreen() pass below,
    // so that pass always sees each one's fresh position rather than a
    // frame-stale one — matters right as a station clears the bottom
    // edge, where a stale position could wrongly delay removal by a frame.
    if (stationActive) {
      starShards.forEach((shard) => {
        if (!shard._stationAttached) return;
        const anchors = shard._stationRef.collectibleAnchors();
        const p = anchors.shardPoints[shard._anchorIndex];
        shard.x = p.x; shard.y = p.y;
      });
      energyOrbs.forEach((orb) => {
        if (!orb._stationAttached) return;
        const anchors = orb._stationRef.collectibleAnchors();
        orb.x = anchors.orbPoint.x; orb.y = anchors.orbPoint.y;
      });
    }

    // Same idea as stationActive above, just against Maze's own anchor set
    // — a maze's static shards/orbs need repositioning every frame it's
    // physically present, independent of otherObstaclesSpawning.
    const mazeActive = mazes.length > 0;
    if (mazeActive) {
      starShards.forEach((shard) => {
        if (!shard._mazeAttached) return;
        const anchors = shard._mazeRef.collectibleAnchors();
        const p = anchors.shardPoints[shard._anchorIndex];
        shard.x = p.x; shard.y = p.y;
      });
      energyOrbs.forEach((orb) => {
        if (!orb._mazeAttached) return;
        const anchors = orb._mazeRef.collectibleAnchors();
        const p = anchors.orbPoints[orb._anchorIndex];
        orb.x = p.x; orb.y = p.y;
      });
    }

    // update() is still called unconditionally for every shard/orb,
    // attached or not — vx/vy are zeroed on an attached one (see
    // spawnStation()), so this only advances its angle/age for the
    // facet-spin/pulse animation, harmless alongside the position override
    // above.
    starShards.forEach((s) => s.update(deltaTime));
    // An attached shard/orb is deliberately EXCLUDED from this generic
    // isOffScreen() filter — StarShard/EnergyOrb's own isOffScreen() checks
    // all four edges (built for a normal collectible that can legitimately
    // exit any side), but an attached one starts with the same deeply
    // off-screen-above y the station/maze itself spawns with (see
    // Station.js's own `this.y = -outerR` / Maze.js's own
    // `this.y = -TOTAL_HEIGHT`), which that four-edge check reads as
    // "already exited" — killing every attached shard/orb the very first
    // frame, before the station/maze ever had a chance to descend into
    // view. Their removal is instead handled entirely by the "cleared"
    // cleanup blocks a few lines up, which is also a better match for the
    // user's "they do not disappear but remain in place" spec than having
    // them peel off individually as each one's own position happens to
    // drift past an edge.
    starShards = starShards.filter((s) => s._stationAttached || s._mazeAttached || !s.isOffScreen(canvas.width, canvas.height));
    energyOrbs.forEach((o) => o.update(deltaTime));
    energyOrbs = energyOrbs.filter((o) => o._stationAttached || o._mazeAttached || !o.isOffScreen(canvas.width, canvas.height));
  }

  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= deltaTime * 1.5;
    p.alpha = Math.max(0, p.life);
  });
  particles = particles.filter((p) => p.life > 0);

  drawEverything();

  if (!isGameOver && !sequenceCompleted) {
    if (hitByAnyObstacle(player.x, player.y, player.radius)) {
      isGameOver = true;
      isDragging = false;
      isPlayerExploded = true;
      // Two overlapping explosion bursts, same as JEWELZ's death effect.
      createExplosion(player.x, player.y, '#1e90ff', 6, 25);
      createExplosion(player.x, player.y, '#ffa502', 4, 15);
    }
  }

  // Star shard collisions — checked separately from the player-vs-asteroid
  // check above, and skipped once the round's already over (matching every
  // other piece of gameplay state, which freezes on game over too).
  if (!isGameOver) {
    // Iterating backwards since a shard can be removed mid-loop — see
    // Asteroid.js's own crater-generation comment for the fuller
    // explanation of why backwards avoids skipping the item that slides
    // into a just-removed index.
    for (let i = starShards.length - 1; i >= 0; i--) {
      const shard = starShards[i];

      // Caught by the player: same explosion effect either way (see
      // below), plus a point and the live score update.
      if (circlesOverlap(player.x, player.y, player.radius, shard.x, shard.y, shard.radius)) {
        createExplosion(shard.x, shard.y, `rgb(${shard.palette.glow})`, 4, 12);
        score += 1;
        starShards.splice(i, 1);
        liveScoreEl.innerHTML = `Score: ${score} pts`;
        continue;
      }

      // Destroyed by any on-screen obstacle before the player could reach
      // it — same "explode" effect either way, but no point. Checked
      // unconditionally against every obstacle type currently on screen
      // (see hitByAnyObstacle()'s own comment), not just whichever is
      // actively spawning — a straggler is still just as hazardous.
      if (hitByAnyObstacle(shard.x, shard.y, shard.radius)) {
        createExplosion(shard.x, shard.y, `rgb(${shard.palette.glow})`, 4, 12);
        starShards.splice(i, 1);
      }
    }
  }

  // Energy orb collisions — same structure/rules as the star shard block
  // above (catch for points, destroyed by an obstacle for none), just its
  // own per-orb point value (orb.value — 3 normally, 10 for the maze/
  // station completion bonus orb, see spawnCompletionBonusOrb()) instead
  // of the shard's flat 1, and gated behind isCollidable() — an orb can't
  // be caught OR destroyed while it's invisible/fading (see EnergyOrb.js's
  // own visibility-cycle comment), only during its fully-visible plateau.
  if (!isGameOver) {
    for (let i = energyOrbs.length - 1; i >= 0; i--) {
      const orb = energyOrbs[i];
      if (!orb.isCollidable()) continue;

      if (circlesOverlap(player.x, player.y, player.radius, orb.x, orb.y, orb.radius)) {
        createExplosion(orb.x, orb.y, `rgb(${orb.palette.glow})`, 4, 12);
        score += orb.value || 3;
        energyOrbs.splice(i, 1);
        liveScoreEl.innerHTML = `Score: ${score} pts`;
        continue;
      }

      if (hitByAnyObstacle(orb.x, orb.y, orb.radius)) {
        createExplosion(orb.x, orb.y, `rgb(${orb.palette.glow})`, 4, 12);
        energyOrbs.splice(i, 1);
      }
    }
  }

  // Waits for the explosion to fully finish (particles.length === 0) before
  // showing the results, same as JEWELZ.
  if (isGameOver && particles.length === 0 && !finalSummaryProcessed) {
    finalSummaryProcessed = true;

    const seconds = Math.floor(survivalTime);
    const result = submitScore(GAME_ID, score, { higherIsBetter: true });
    saveTodayScore(GAME_ID, score);
    // Completing the whole sequence gets its own congratulations message
    // instead of the normal score-comparison one, and always celebrates
    // (a win is a win regardless of how the score stacks up) — everything
    // else about ending the round (score submission, saved progress,
    // resume-later display) stays identical either way.
    const resultLine = sequenceCompleted ? buildVictoryLine(score) : buildResultLine(score, result);
    saveProgress(GAME_ID, { score, seconds, resultLine }, { completed: true });
    saveTodayOutcome(GAME_ID, {
      revealed: false, usedHelp: false, failed: sequenceCompleted ? false : score === 0,
      isNewBest: result.isNewBest, isTie: result.isTie,
    });

    liveScoreEl.textContent = '';
    shell.showEndScreen({
      message: resultLine,
      shareText: sequenceCompleted ? `☄️ WARPZ — beat the whole gauntlet and scored ${score} points today!` : `☄️ WARPZ — scored ${score} points today!`,
      celebrate: sequenceCompleted || score > 0,
      score,
    });
    return;
  }

  requestAnimationFrame(animate);
}

function startGame() {
  activeObstacleType = selectedObstacleType; // locked in for the whole round, however the dev panel is set at THIS moment
  if (activeObstacleType === 'sequence') {
    activeSequence = sequences.find((s) => s.sequence === selectedSequenceNumber) || sequences[0] || null;
    if (!activeSequence) {
      console.warn('WARPZ: "Sequence" selected but no sequence found — falling back to asteroids for this round');
      activeObstacleType = 'asteroids';
    }
  } else {
    activeSequence = null;
  }
  sequenceStepIndex = 0;
  sequenceStepElapsed = 0;
  sequenceStationSpawnCount = 0;
  sequenceStationQuantityLastRef = null;
  sequenceMazeSpawnCount = 0;
  sequenceMazeQuantityLastRef = null;
  sequenceCompleted = false;
  sequenceWinDelay = 0;
  updateObstacleDebugLabel();
  asteroids = [];
  clusters = [];
  worms = [];
  stations = [];
  playerInsideStation = false;
  // Bug found in a post-hoc audit: this whole maze reset (both this array
  // and nextMazeSpawnIn below) was missing entirely — every OTHER
  // obstacle type gets reset here, but Maze never did. A maze still
  // active at game-over (mid-skull-chase, doors mid-transition,
  // `_playerHasExited` possibly already true from the finished round)
  // would otherwise survive untouched into the next round, blocking a
  // fresh spawn (spawnMaze()'s own `mazes.length === 0` gate) and able to
  // instant-kill the new round's freshly-reset player via its still-live
  // skull.
  mazes = [];
  playerInsideMaze = false;
  starShards = [];
  energyOrbs = [];
  pendingBonusOrbs = [];
  zappersLeft = [];
  zappersRight = [];
  zappersSpawnedLeft = 0;
  zappersSpawnedRight = 0;
  particles = [];
  isGameStarted = true;
  isGameOver = false;
  isPlayerExploded = false;
  finalSummaryProcessed = false;
  survivalTime = 0;
  score = 0;
  // Zero (not a rolled interval) so the very first asteroid/cluster/worm/
  // station/zapper of the round appears immediately rather than leaving a
  // gap at the start — per the user's explicit request. Same reasoning as
  // advanceSequenceStep() uses for a newly-active step; every spawn AFTER
  // the first one still uses the normal rolled interval. Shard/orb timers
  // are unaffected — only field obstacles were called out.
  nextSpawnIn = 0;
  nextClusterSpawnIn = 0;
  nextWormSpawnIn = 0;
  nextStationSpawnIn = 0;
  nextMazeSpawnIn = 0;
  nextShardSpawnIn = rollShardSpawnInterval();
  nextOrbSpawnIn = rollOrbSpawnInterval();
  nextZapperSpawnInLeft = 0;
  // Right wall still offset by half a period behind the left wall — same
  // alternating pattern as always (see advanceSequenceStep()'s matching
  // comment), just no longer ALSO delayed by a full interval first.
  nextZapperSpawnInRight = ZAPPER_CREATION_INTERVAL_BASE / 2;
  lastShardPalette = null;
  lastOrbPalette = null;
  lastWormPalette = null;
  player.x = 225;
  player.y = 400;

  liveScoreEl.innerHTML = `Score: ${score} pts`;
  lastTime = performance.now();
  requestAnimationFrame(animate);
}

enableCanvasPointerDrag({
  canvas,
  onStart: (pos) => {
    if (!isGameStarted || isGameOver || isPlayerExploded) return;
    const dx = pos.x - player.x;
    const dy = pos.y - player.y;
    if (Math.sqrt(dx * dx + dy * dy) <= player.radius) isDragging = true;
  },
  onMove: (pos) => {
    if (!isGameStarted || isGameOver || isPlayerExploded || !isDragging) return;
    const targetX = Math.max(player.radius, Math.min(pos.x, canvas.width - player.radius));
    const targetY = Math.max(player.radius, Math.min(pos.y, canvas.height - player.radius));

    // Station's resolveSolid() only ever validates the FINAL position it's
    // given — it has no concept of whether the straight-line path from the
    // old position to the new one actually crossed through solid material.
    // Committing the raw drag position here and only correcting it next
    // animate() frame (the original approach) caused two real bugs: a
    // visible "goes in, then springs back" lag (the invalid position was
    // on screen for a frame before correction), and — worse — a single
    // large drag delta landing CLEANLY outside on the far side of a ring
    // reads as fully valid at both ends, so nothing ever detects the
    // crossing and the ring gets bypassed entirely.
    //
    // Fixed by resolving synchronously right here (no lag) and marching
    // toward the target in small steps, RE-AIMING FROM THE PLAYER'S ACTUAL
    // POSITION EVERY STEP — not interpolating along the original straight
    // line regardless of what happened. That distinction matters: an
    // earlier version interpolated fixed points along the pre-collision
    // line, so once that line's LATER points happened to clear the ring
    // again (the straight line grazes past it, not through forever), those
    // later steps looked "cleanly outside" on their own and got let
    // through unchanged — silently discarding every bit of blocking the
    // earlier steps had correctly applied. Re-aiming from wherever the
    // player actually ended up after each step is what makes this read as
    // sliding along the ring's surface toward the target, the same way
    // resolveSolid's own per-step correction already behaves, instead of
    // ignoring that correction on the next step.
    let remainingSteps = 400; // hard cap — generous even for a full-canvas drag detouring around a ring, just guards against a pathological infinite loop
    while (remainingSteps-- > 0) {
      const remDx = targetX - player.x, remDy = targetY - player.y;
      const remDist = Math.hypot(remDx, remDy);
      if (remDist < 0.05) break;
      const stepDist = Math.min(5, remDist); // px per step, comfortably under the thinnest solid band (~16px)
      let stepX = player.x + (remDx / remDist) * stepDist;
      let stepY = player.y + (remDy / remDist) * stepDist;
      stations.forEach((s) => {
        const resolved = s.resolveSolid(stepX, stepY, player.radius);
        stepX = resolved.x;
        stepY = resolved.y;
      });
      // Maze needs the exact same per-step resolution stations get — its
      // doors are the thinnest solid bands in the game (WALL_THICKNESS=6),
      // so without this a fast drag tunnels straight through them exactly
      // the way this whole stepped-marching approach was built to prevent
      // for Station's ring (see this function's own header comment). This
      // was the actual cause of the "pass straight through a wall" bug
      // report — the single-shot resolveSolid() call in animate() below
      // only ever validates wherever the drag ALREADY landed; it was never
      // the thing preventing tunneling in the first place.
      mazes.forEach((m) => {
        const resolved = m.resolveSolid(stepX, stepY, player.radius);
        stepX = resolved.x;
        stepY = resolved.y;
      });
      // Same absolute canvas-edge priority as animate()'s own copy of this
      // clamp — see that comment for why the edge has to win even over a
      // station's or maze's own solid push.
      player.x = Math.max(player.radius, Math.min(stepX, canvas.width - player.radius));
      player.y = Math.max(player.radius, Math.min(stepY, canvas.height - player.radius));
    }
  },
  onEnd: () => { isDragging = false; },
});

const liveScoreEl = document.getElementById('liveScore');

const shell = initShell({
  gameId: GAME_ID,
  title: 'WARPZ',
  emojiImage: getPlayerIconDataURL(), // player smiley face, matching the hub tile — swapped in from the plain '☄️' emoji per the user's explicit request
  accentColor: { bg: '#A8D84A', ink: '#243D05', rim: 'rgba(55, 85, 5, 0.30)' },
  instructions: `<p>Move the spaceman ${PLAYER_IMG} with your finger or mouse</p><p>Traverse the obstacles and avoid some that are lethal to life ${SKULL_IMG}</p><p>Collect shards ${STAR_SHARD_IMG} and energy orbs ${ENERGY_ORB_IMG} to earn points</p>`,
  formatScore: (score) => `${score} pts`,
});

if (shell.status.status === 'completed') {
  const { resultLine, seconds, score: finalScore } = shell.status.record.data;
  shell.timer.setSeconds(seconds || 0);
  shell.showEndScreen({ message: resultLine, shareText: `☄️ WARPZ — scored ${finalScore} points today!` });
} else {
  drawEverything(); // static preview behind the start banner
  shell.showStartBanner(startGame);
}
