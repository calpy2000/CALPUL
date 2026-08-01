// ==========================================
// MODULE: THE MAZE OBSTACLE CLASS
// ==========================================
//
// A tall grid maze — 6 columns by 20 rows of nodes-and-doors — that
// descends the canvas at the same speed Station.js uses, much taller than
// one screen so (like Station) it scrolls into and out of view over time.
// The player enters through a single gap at the bottom boundary and has
// to navigate up through the grid to a single gap at the top boundary.
//
// Per the user's explicit spec ("very much like the station"): every door
// is a PHYSICAL CONSTRAINT, not lethal — contact blocks the player's own
// movement (same "slide along the surface" resolution Station.js and
// solid-collision.js already provide) rather than ending the round. This
// is the second, solid-only obstacle solid-collision.js was written
// obstacle-agnostic for from the start.
//
// Doors aren't just open/shut — every closed door doubles as a live-
// action open animation (1s-ish color-shift to neon green with its
// border fading out, then a quick "Particle Dust" burst) and every open
// door doubles as the close animation (an electric-shock arc that
// solidifies into a green panel, then a color-shift back to the resting
// bronze/red look) — both picked from a dedicated mockup-and-approve pass
// (see the memory notes / conversation history for the other options
// tried and rejected: Spark Burst, Shatter Fragments, Plasma Pop, Ring
// Shockwave for the burst; blink/amber-glow/marching-stripes/pulse-ring
// for the "about to move" signal, none of which were kept in the end —
// the color-shift IS the signal here).
//
// ---- the connectivity guarantee ----
// Per the user's explicit rules: (1) there is always at least one path
// from the bottom entrance to the top exit, (2) every cell is reachable —
// no area can end up fully walled off — and (3) BOTH of those stay true
// after every single door change, forever, not just at spawn. This is a
// real graph-theory guarantee, not a "probably fine" one: the maze's open
// doors form a graph over its cells, and standard graph theory says an
// edge can only disconnect that graph if it's a BRIDGE (no alternate route
// between the two cells it connects). So the rule this file follows is —
// opening a door is always safe (adding a connection can't disconnect
// anything), but a door is only ever a candidate for CLOSING if it is
// currently NOT a bridge (see findBridges() below, Tarjan's bridge-finding
// algorithm — checked fresh before each individual close this tick, since
// closing one door can turn a previously-safe door into a bridge for the
// next one). Since generation always starts from a spanning tree (fully
// connected, see generateCells()/generateCellsPrim()) and every later
// change provably preserves connectivity, the invariant holds by
// induction for the maze's entire lifetime. See DIFFICULTY_PRESETS below
// for how many doors change and how often.

import { resolveCircleAgainstRect, resolveCircleAgainstShapes } from './solid-collision.js';
import { getToolMode } from '../../shared/core/tool-mode.js';

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgbStr(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// A deliberate, currently-OFF testing toggle — mirrors Station.js's own
// DOORS_ALWAYS_OPEN_TESTING in spirit (a one-line flip back to false when
// done, nothing else to resync). Set the hand toggle below true to shrink
// the maze from its real 20 rows down to just 6, for fast iteration
// without waiting through a full-height maze every test run. Simpler than
// Station's own toggle needed to be: ROWS is a pure structural constant,
// not simulated per-frame state, so changing its own value here is
// enough — every generator/pathing/drawing call in this file already
// treats ROWS as the single source of truth for grid height, so nothing
// downstream needs its own special-case.
//
// Also gated on IS_DEV_TOOLS, same reasoning/wording as Station.js's own
// DOORS_ALWAYS_OPEN_TESTING — a dev-only convenience that must never reach
// testers/real players even if the hand toggle is accidentally left on.
const SHORT_MAZE_TESTING_HAND_TOGGLE = true;
const SHORT_MAZE_TESTING = getToolMode() === 'dev' && SHORT_MAZE_TESTING_HAND_TOGGLE;

// ---- grid geometry ----
// 6 columns / 20 rows per the user's explicit spec (or 6 rows with
// SHORT_MAZE_TESTING on, above). GRID_MARGIN keeps the outer boundary
// walls a few px clear of the canvas edge (same request already applied
// to every mockup); CELL_H is a fixed row pitch (NOT canvasHeight/ROWS) —
// the whole point of 20 rows is that the maze is much taller than one
// screen and has to scroll, exactly like Station.
export const COLS = 6;
export const ROWS = SHORT_MAZE_TESTING ? 6 : 20;
const GRID_MARGIN = 6;
const WALL_THICKNESS = 6;
const CELL_H = 80;
const TOTAL_HEIGHT = ROWS * CELL_H;
// Matches Station.js's own VERTICAL_SPEED exactly, per explicit request.
const VERTICAL_SPEED = 38;

// ---- door timing ----
// Opening: 2s color-shift to neon green (border fading to nothing) then a
// 0.8s Particle Dust burst. Closing: a 0.9s electric-shock emerge that
// solidifies into a flat green panel, then a 2s color-shift back to the
// resting bronze/red look. All four durations were tuned live against a
// published mockup before landing here (the color/explode durations were
// explicitly doubled from an initial 1s/0.4s pass once the user could see
// them in motion).
const COLOR_DUR = 2.0;
const EXPLODE_DUR = 0.8;
const EMERGE_DUR = 0.9;

// ---- difficulty presets ----
// Per maze-generation research (recursive backtracker gives long, winding,
// low-branching corridors with few dead ends — easier to read; randomized
// Prim's gives many short dead-ends scattered everywhere — a "punishing"
// feel) plus "braiding" (opening a percentage of the extra, non-tree walls
// right after generation to add loops/shortcuts — the standard way to
// soften a maze by removing dead-end confusion). `retoggleInterval` /
// `opensPerToggle` / `closesPerToggle` are WARPZ's own extra lever on top
// of that base texture — how much and how often the maze reshapes itself
// over time. Every retoggle, regardless of preset, still obeys the
// connectivity guarantee above — braiding/generator choice only ever
// affects the STARTING texture, never whether the maze can become
// unsolvable.
//
// Opens and closes are DELIBERATELY separate counts, not one shared
// "doorsPerToggle" — a structural consequence of the connectivity
// guarantee itself is that opening a door is always unrestricted, but
// closing one is gated behind a live bridge check (see findBridges()).
// Near a spanning tree almost every open door IS a bridge, so requested
// closes keep getting rejected — the maze SELF-LIMITS right around the
// spanning-tree floor (open-door fraction = (cells-1)/totalDoors) once
// closes are favored, and self-limits toward wide-open once opens are
// favored. That means the open:close RATIO, not the raw counts, is what
// actually sets a preset's long-run equilibrium — confirmed empirically
// (see test8-difficulty-tuning.mjs in the session scratchpad): an early
// pass using 2:1/2:3/1:5 left medium and hard converging to nearly the
// same floor (~0.56 open fraction each) since both were close-biased.
// The three ratios below are deliberately spread apart instead — clearly
// open-biased (easy), balanced (medium), clearly close-biased (hard) — so
// each settles at its own distinct equilibrium rather than two of the
// three collapsing toward the same one.
const DIFFICULTY_PRESETS = {
  easy: { generator: 'backtracker', braidPercent: 0.25, retoggleInterval: 5.0, opensPerToggle: 3, closesPerToggle: 1 },
  medium: { generator: 'backtracker', braidPercent: 0.08, retoggleInterval: 3.5, opensPerToggle: 2, closesPerToggle: 2 },
  hard: { generator: 'prim', braidPercent: 0.0, retoggleInterval: 2.5, opensPerToggle: 1, closesPerToggle: 5 },
};

// ---- the skull (lethal, moving) ----
// Per the user's explicit spec: unlike every other lethal WARPZ obstacle,
// the skull doesn't fly a ballistic path — it TRAVERSES THE MAZE ITSELF,
// entering at the exit (top) and working its way down to the entrance
// (bottom), only ever moving through currently-open doors (never a
// detour down a dead branch), at 3x the maze's own VERTICAL_SPEED. Its
// route is recomputed via BFS (see bfsNextHop() below) every time it
// arrives at a new cell — the connectivity guarantee above means a route
// to the entrance always exists, so it can never get stuck, but the
// SPECIFIC route can change mid-transit if the maze reshapes around it;
// the overall direction is top-to-bottom, but per the user's own
// clarification, the shortest currently-open route can require genuine
// local detours upward, same as the player's own route might.
// One skull at a time: per the user's explicit "1 second after the
// preceding skull has exited" spec, the next one waits out
// SKULL_RESPAWN_DELAY once the previous reaches the entrance and
// despawns (see _updateSkull()) before it's allowed to spawn — same
// "gap after a slot frees up" idea index.js's own MAZE_RESPAWN_DELAY/
// STATION_RESPAWN_DELAY already use for their own respawn timing, just
// living inside Maze.js since the skull is entirely internal to it. The
// FIRST one doesn't wait for the maze's own top edge to scroll into view
// (that can take tens of seconds) — it spawns once the maze's ENTRANCE
// (the edge that scrolls into view first) reaches the canvas's own
// vertical midpoint, per the user's explicit "half way down the canvas"
// spec. Spawning stops for good once the player has successfully exited
// the maze (`_playerHasExited` — set externally by index.js, the same
// one-shot flag that fires the maze/station completion bonus orb).
const SKULL_SPEED = VERTICAL_SPEED * 3; // 114px/s, per explicit request
const SKULL_RESPAWN_DELAY = 1.0;
// Visual scale — the finalized skull design (true ellipse braincase union
// a rounded-rectangle jaw, width ratio 0.70 / length ratio 1.10, picked
// over several mockup rounds) sized to comfortably fit within one maze
// cell (~73x80px) as it moves through corridors. Per the user's explicit
// "pulse every two seconds, reducing then increasing in size" request,
// the DRAWN size breathes ±15% around this base radius on a 2s cycle —
// see drawSkull()'s own sizePulse — collision radius stays fixed
// regardless, since a shrink/grow visual shouldn't make contact feel
// inconsistent moment to moment.
const SKULL_DRAW_R = 42;
const SKULL_SIZE_PULSE_PERIOD = 2.0;
const SKULL_SIZE_PULSE_AMOUNT = 0.15;
const SKULL_JAW_WIDTH = 0.70;
const SKULL_JAW_LENGTH = 1.10;
const SKULL_HUE = '255,70,60'; // the approved hazard-red
// Collision radius — a plain circle rather than tracing the skull's own
// jagged silhouette (contact is instant death for both, so fairness
// matters more than pixel-perfect precision), similar order to the
// player's own 25px radius.
const SKULL_COLLISION_R = 20;

// ---- static collectibles ----
// A modest, scattered selection of star shards and energy orbs sit at fixed
// cell centers throughout the grid — per the user's original "laid static
// in the maze to collect" spec, and the later explicit follow-up asking for
// exactly this instead of the normal randomly-flying spawns while a maze is
// active (see index.js's own spawnMaze()/otherObstaclesSpawning comments).
// A cell's CENTER is always clear open space no matter which doors around
// it are open or sealed right now, so placement here never needs to dodge
// door state. Counts are modest relative to the 120-cell (6x20) grid so
// they read as scattered rewards, not wall-to-wall coverage.
const SHARD_COUNT = 10;
const ORB_COUNT = 3;

// ---- door colors ----
const NORMAL_TOP = [0x5c, 0x4a, 0x2c], NORMAL_BOTTOM = [0x33, 0x26, 0x0f]; // Warm Bronze
const GREEN_TOP = [140, 255, 180], GREEN_BOTTOM = [40, 200, 100];
const EDGE_RGB = '255,90,90'; // Warning Red border
const NODE_RGB = '255,196,90'; // Warm Amber

// A small guaranteed gap between the player's circle and any solid wall
// face, same convention/value as solid-collision.js's own CLEARANCE_MARGIN
// and Station.js's RING_CONTACT_EPS — used only by touchesWall()'s own
// "currently pressed against a face" tolerance, not by the actual physics.
const WALL_CONTACT_EPS = 4;

// ---- per-door FSM ----
// { phase, phaseElapsed, dust } — SEALED and OPEN are the two resting
// states (see the header comment for what each transition looks like).
// `canOpen`/occupancy holds aren't a thing here — Maze doors close on
// their own random schedule regardless of whether the player happens to
// be standing in them, per the user's spec (no hold-open rule was asked
// for, unlike Station's explicit one).
function freshDoor(phase, len, rand) {
  return { phase, phaseElapsed: 0, dust: buildDust(rand, len) };
}
function isBlockingPhase(phase) {
  // SEALED/colorToGreen/emerge/colorToNormal are all still solid panels
  // (colorToGreen hasn't shrunk yet; emerge is treated as "already back"
  // for collision even though the visual is still an arc, a deliberate
  // simplification — see the header comment). Only EXPLODE (panel has
  // already visually vanished for nearly all of that phase) and OPEN are
  // passable.
  return phase !== 'explode' && phase !== 'open';
}
function advanceDoorPhase(door, dt) {
  door.phaseElapsed += dt;
  switch (door.phase) {
    case 'colorToGreen':
      if (door.phaseElapsed >= COLOR_DUR) { door.phase = 'explode'; door.phaseElapsed = 0; }
      break;
    case 'explode':
      if (door.phaseElapsed >= EXPLODE_DUR) { door.phase = 'open'; door.phaseElapsed = 0; }
      break;
    case 'emerge':
      if (door.phaseElapsed >= EMERGE_DUR) { door.phase = 'colorToNormal'; door.phaseElapsed = 0; }
      break;
    case 'colorToNormal':
      if (door.phaseElapsed >= COLOR_DUR) { door.phase = 'sealed'; door.phaseElapsed = 0; }
      break;
    default:
      break; // sealed/open just wait for _retoggleDoors() to trigger them
  }
}

// Deterministic per-door dust geometry (fixed points/angles/distances) so
// a given door's own burst doesn't look randomly different every time it
// happens to open — only the progress along that fixed path animates.
// Count and spray radius are both 2x the version shown in the options
// mockup, per explicit request.
function buildDust(rand, len) {
  const dots = [];
  for (let i = 0; i < 44; i++) {
    const along = rand() * len;
    const ang = rand() * Math.PI * 2;
    dots.push({ along, ang, dist: 28 + rand() * 68, size: 1 + rand() * 1.8, wob: rand() * 10 });
  }
  return dots;
}

function drawFlatPanel(ctx, panelLen, topRgb, bottomRgb, borderAlpha) {
  const grad = ctx.createLinearGradient(0, -2, 0, 2);
  grad.addColorStop(0, rgbStr(topRgb)); grad.addColorStop(1, rgbStr(bottomRgb));
  ctx.fillStyle = grad;
  ctx.fillRect(0, -2, panelLen, 4);
  if (borderAlpha > 0.01) {
    ctx.save();
    ctx.shadowColor = `rgba(${EDGE_RGB},${borderAlpha})`; ctx.shadowBlur = 2.5;
    ctx.fillStyle = `rgba(${EDGE_RGB},${borderAlpha})`;
    ctx.fillRect(0, -3, panelLen, 1);
    ctx.fillRect(0, 2, panelLen, 1);
    ctx.restore();
  }
}

function drawExplodeDust(ctx, p, dust) {
  const a = Math.max(0, 1 - p);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(160,255,190,1)'; ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(200,255,215,1)';
  dust.forEach((d) => {
    const dist = d.dist * p;
    const dx = d.along + Math.cos(d.ang) * dist, dy = Math.sin(d.ang) * dist - d.wob * p * p;
    ctx.beginPath(); ctx.arc(dx, dy, d.size, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function drawEmergeArc(ctx, len, p, t) {
  const jitterAmp = (1 - p) * 7;
  const arcAlpha = 0.4 + p * 0.6;
  const segs = 7;
  ctx.save();
  ctx.globalAlpha = arcAlpha;
  ctx.strokeStyle = 'rgba(150,255,190,1)';
  ctx.lineWidth = Math.max(1.2, 2 + p * 2);
  ctx.shadowColor = 'rgba(150,255,190,0.9)'; ctx.shadowBlur = 9;
  ctx.beginPath();
  for (let s = 0; s <= segs; s++) {
    const x = (len * s) / segs;
    const jitter = (s === 0 || s === segs) ? 0 : (Math.sin(t * 40 + s * 5.3) * jitterAmp);
    if (s === 0) ctx.moveTo(x, jitter); else ctx.lineTo(x, jitter);
  }
  ctx.stroke();
  ctx.restore();
  if (p > 0.6) {
    const solidP = (p - 0.6) / 0.4;
    ctx.save();
    ctx.globalAlpha = solidP;
    drawFlatPanel(ctx, len, GREEN_TOP, GREEN_BOTTOM, 0);
    ctx.restore();
  }
}

// ---- node glow/flash animation ----
// Two overlapping sine waves (randomized frequency/phase per node) give a
// semi-random breathing curve, plus an independent randomized schedule of
// brief bright flash spikes layered on top — flash rate tuned down to
// 0.2x a first pass (so flashes read as occasional, not constant).
const FLASH_RATE = 0.2, FLASH_CYCLE = 6.0 / FLASH_RATE;
function buildNodeAnim(rand) {
  const flashes = [];
  let t = (rand() * 2.5) / FLASH_RATE;
  while (t < FLASH_CYCLE) { flashes.push(t); t += (1.2 + rand() * 3.2) / FLASH_RATE; }
  return { freq1: 0.45 + rand() * 1.3, phase1: rand() * Math.PI * 2, freq2: 0.2 + rand() * 0.8, phase2: rand() * Math.PI * 2, flashes };
}
function nodeState(anim, age) {
  let glow = 0.5 + 0.25 * Math.sin(age * anim.freq1 + anim.phase1) + 0.25 * Math.sin(age * anim.freq2 + anim.phase2);
  glow = Math.max(0.08, Math.min(1, glow));
  const cyclePos = age % FLASH_CYCLE;
  let flash = 0;
  for (const ft of anim.flashes) {
    const dt = cyclePos - ft;
    if (dt >= 0 && dt < 0.4) { flash = dt < 0.08 ? dt / 0.08 : Math.max(0, 1 - (dt - 0.08) / 0.32); break; }
  }
  return { glow, flash };
}
function drawNode(ctx, x, y, glow, flash) {
  ctx.save();
  const r = 3 + glow * 4.5 + flash * 3;
  // Extended soft glow during a flash rather than a hard-edged ring/halo.
  if (flash > 0.03) {
    const glowR = r + flash * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(${NODE_RGB},${(flash * 0.55).toFixed(2)})`);
    g.addColorStop(0.5, `rgba(${NODE_RGB},${(flash * 0.18).toFixed(2)})`);
    g.addColorStop(1, `rgba(${NODE_RGB},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowColor = `rgba(${NODE_RGB},1)`;
  ctx.shadowBlur = 10 + glow * 22 + flash * 30;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, `rgba(${NODE_RGB},${(0.65 + glow * 0.35).toFixed(2)})`);
  grad.addColorStop(1, `rgba(${NODE_RGB},0)`);
  ctx.fillStyle = grad; ctx.fill();
  ctx.restore();
}

// Shared by both generators below — the four grid directions, each with
// the wall-side name it clears on both the cell it leaves and the one it
// enters.
const CELL_DIRS = [
  { dr: -1, dc: 0, from: 'N', to: 'S' }, { dr: 1, dc: 0, from: 'S', to: 'N' },
  { dr: 0, dc: -1, from: 'W', to: 'E' }, { dr: 0, dc: 1, from: 'E', to: 'W' },
];

function blankCells() {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    cells.push([]);
    for (let c = 0; c < COLS; c++) cells[r].push({ N: true, S: true, E: true, W: true });
  }
  return cells;
}

// Recursive-backtracker maze generation over the ROWS x COLS cell grid —
// returns cells[r][c] = { N, S, E, W } (true = wall present in the
// INITIAL structure; the retoggle system takes over from there, always
// preserving the connectivity this starts with — see the header comment).
// Long, winding, low-branching corridors with few dead ends — the EASY/
// MEDIUM base texture (see DIFFICULTY_PRESETS).
function generateCells(rand) {
  const cells = blankCells();
  const visited = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const startR = ROWS - 1, startC = Math.floor(COLS / 2);
  const stack = [[startR, startC]];
  visited[startR][startC] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const options = [];
    for (const d of CELL_DIRS) {
      const nr = r + d.dr, nc = c + d.dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !visited[nr][nc]) options.push({ nr, nc, d });
    }
    if (options.length === 0) { stack.pop(); continue; }
    const { nr, nc, d } = options[Math.floor(rand() * options.length)];
    cells[r][c][d.from] = false; cells[nr][nc][d.to] = false;
    visited[nr][nc] = true; stack.push([nr, nc]);
  }
  return cells;
}

// Randomized Prim's maze generation — same output shape as generateCells().
// Grows the maze from a single starting cell by repeatedly picking a
// uniformly random edge off the current FRONTIER (every wall between an
// already-visited cell and an unvisited neighbor), rather than always
// extending from the most-recently-visited cell the way the backtracker's
// stack does. That breadth-ish, any-active-front growth is what produces
// its distinctive texture: many short dead-end stubs scattered everywhere
// instead of a few long corridors — the HARD base texture (see
// DIFFICULTY_PRESETS).
function generateCellsPrim(rand) {
  const cells = blankCells();
  const visited = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const startR = ROWS - 1, startC = Math.floor(COLS / 2);
  visited[startR][startC] = true;

  const frontier = [];
  const addFrontier = (r, c) => {
    for (const d of CELL_DIRS) {
      const nr = r + d.dr, nc = c + d.dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !visited[nr][nc]) frontier.push({ r, c, nr, nc, d });
    }
  };
  addFrontier(startR, startC);

  while (frontier.length) {
    const i = Math.floor(rand() * frontier.length);
    const { r, c, nr, nc, d } = frontier[i];
    frontier.splice(i, 1);
    if (visited[nr][nc]) continue; // reached by an earlier frontier pick since being queued
    cells[r][c][d.from] = false; cells[nr][nc][d.to] = false;
    visited[nr][nc] = true;
    addFrontier(nr, nc);
  }
  return cells;
}

// Braiding: after generation, open some fraction of the remaining sealed
// internal walls right away — softens the maze by adding shortcuts/loops
// so fewer of its dead ends stay true dead ends. Always safe regardless of
// how much is applied: every wall opened here only ADDS a connection to an
// already-fully-connected spanning tree, which can never disconnect it.
// 0 for Hard (keep it a "perfect" maze, maximum dead-end density); higher
// for Easy (see DIFFICULTY_PRESETS).
function applyBraiding(cells, rand, braidPercent) {
  if (braidPercent <= 0) return;
  for (let r = 1; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (cells[r - 1][c].S && rand() < braidPercent) { cells[r - 1][c].S = false; cells[r][c].N = false; }
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 1; c < COLS; c++) {
      if (cells[r][c - 1].E && rand() < braidPercent) { cells[r][c - 1].E = false; cells[r][c].W = false; }
    }
  }
}

// Picks up to `n` random distinct items out of `arr` — used by
// _retoggleDoors() to choose which doors open/close each tick.
function pickRandom(arr, n) {
  const pool = arr.slice();
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

// Tarjan's bridge-finding algorithm, O(cells + doors) — see the header
// comment's "connectivity guarantee" for why this is what _retoggleDoors()
// checks before ever closing a door. `adj` is an adjacency list, one entry
// per cell (index = r*COLS+c), each an array of { to, door } for every
// currently-passable door leading out of that cell. Returns a Set of the
// door objects that are currently bridges (closing one would disconnect
// the graph) — standard low-link DFS: a door from u to v is a bridge iff
// v's subtree can't reach back up to u or above through any OTHER edge.
function findBridges(adj) {
  const n = adj.length;
  const disc = new Array(n).fill(-1);
  const low = new Array(n).fill(-1);
  const bridges = new Set();
  let timer = 0;
  // Iterative DFS (explicit stack) — avoids any recursion-depth concern,
  // though at 120 cells a recursive version would have been fine too.
  for (let start = 0; start < n; start++) {
    if (disc[start] !== -1) continue;
    const stack = [{ u: start, parentDoor: null, i: 0 }];
    disc[start] = low[start] = timer++;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const { u } = frame;
      if (frame.i < adj[u].length) {
        const { to: v, door } = adj[u][frame.i++];
        if (door === frame.parentDoor) continue; // don't walk straight back the way we came
        if (disc[v] === -1) {
          disc[v] = low[v] = timer++;
          stack.push({ u: v, parentDoor: door, i: 0 });
        } else {
          low[u] = Math.min(low[u], disc[v]);
        }
      } else {
        stack.pop();
        if (stack.length) {
          const parent = stack[stack.length - 1];
          low[parent.u] = Math.min(low[parent.u], low[u]);
          if (low[u] > disc[parent.u]) bridges.add(frame.parentDoor);
        }
      }
    }
  }
  return bridges;
}

// Plain BFS shortest path (unweighted — every door counts as one step)
// from `fromIdx` to `targetIdx` over `adj` (same adjacency-list shape as
// findBridges() takes), returning just the FIRST hop's cell index — all
// the skull ever needs, since it recomputes this fresh every time it
// arrives at a new cell (see the skull's own header comment for why:
// the maze keeps reshaping, so a full precomputed path could go stale
// before the skull finishes walking it). Returns null only if `fromIdx`
// is already `targetIdx`, or — shouldn't be reachable given the
// connectivity guarantee — no path exists at all.
function bfsNextHop(adj, fromIdx, targetIdx) {
  if (fromIdx === targetIdx) return null;
  const n = adj.length;
  const visited = new Array(n).fill(false);
  const parent = new Array(n).fill(-1);
  const queue = [fromIdx];
  visited[fromIdx] = true;
  while (queue.length) {
    const u = queue.shift();
    if (u === targetIdx) break;
    for (const { to: v } of adj[u]) {
      if (visited[v]) continue;
      visited[v] = true;
      parent[v] = u;
      queue.push(v);
    }
  }
  if (!visited[targetIdx]) return null;
  let cur = targetIdx;
  while (parent[cur] !== fromIdx) cur = parent[cur];
  return cur;
}

// Same BFS as bfsNextHop() but returns the FULL cell-index path from
// `fromIdx` to `targetIdx` (inclusive of both ends) rather than just the
// first hop — used once per spawn (see _spawnSkullOnRoute()) to find
// where along its real route a skull should actually appear. Every other
// caller in this file wants bfsNextHop() instead: replanning a full path
// every frame would be wasted work when only the next step ever matters
// once the skull is already moving.
function bfsFullPath(adj, fromIdx, targetIdx) {
  const n = adj.length;
  const visited = new Array(n).fill(false);
  const parent = new Array(n).fill(-1);
  const queue = [fromIdx];
  visited[fromIdx] = true;
  while (queue.length) {
    const u = queue.shift();
    if (u === targetIdx) break;
    for (const { to: v } of adj[u]) {
      if (visited[v]) continue;
      visited[v] = true;
      parent[v] = u;
      queue.push(v);
    }
  }
  if (!visited[targetIdx]) return null;
  const path = [targetIdx];
  let cur = targetIdx;
  while (cur !== fromIdx) { cur = parent[cur]; path.push(cur); }
  path.reverse();
  return path;
}

// Ease-in-out cubic — firm hold at each extreme of the size pulse's own
// cycle, snappier transition through the middle, picked ("Option 3") over
// 5 other curves (linear/sine/quart/elastic/back) shown side by side in a
// dedicated mockup, replacing the plain sine the pulse originally shipped
// with. `t` is cycle position in [0,1); returns a value in [-1,1] — see
// drawSkull()'s own sizePulse for how this becomes an actual size
// multiplier.
function easeInOutCubic(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function skullPulseCurve(t) {
  if (t < 0.5) { const u = t / 0.5; return -1 + 2 * easeInOutCubic(u); }
  const u = (t - 0.5) / 0.5; return 1 - 2 * easeInOutCubic(u);
}

// ---- skull geometry/drawing ----
// The finalized design, ported directly from the approved mockup: a TRUE
// union of a full ellipse (braincase) and a full rounded rectangle (jaw)
// — one continuous outline built from the actual angle where a rectangle
// of the jaw's own width crosses the ellipse's boundary, not an
// approximated "shoulder" (an earlier mockup attempt at that flattened
// the ellipse's own lower edge — a real bug, fixed during that design
// pass; see the memory notes for the fuller history). Angular eyes
// tapering to a sharp point, a triangular nasal cavity, a bared-teeth
// grin, flat hazard-red fill, thin outline, no hull/diamond backing —
// all per the user's own explicit picks across several mockup rounds.
function skullLandmarks(R) {
  const Rc = R * 0.56;
  const cy0 = -R * 0.12;
  const jawHalfW = Rc * SKULL_JAW_WIDTH;
  const thetaRight = Math.acos(SKULL_JAW_WIDTH);
  const intersectY = cy0 + Rc * Math.sin(thetaRight);
  const jawBottom = cy0 + Rc * SKULL_JAW_LENGTH;
  return { Rc, cy0, jawHalfW, thetaRight, intersectY, jawBottom };
}

function skullOutline(ctx, R) {
  const { Rc, cy0, jawHalfW, thetaRight, intersectY, jawBottom } = skullLandmarks(R);
  const cornerR = Rc * 0.16;
  ctx.beginPath();
  ctx.ellipse(0, cy0, Rc, Rc, 0, thetaRight, Math.PI - thetaRight, true);
  ctx.lineTo(-jawHalfW, jawBottom - cornerR);
  ctx.arcTo(-jawHalfW, jawBottom, -jawHalfW + cornerR, jawBottom, cornerR);
  ctx.lineTo(jawHalfW - cornerR, jawBottom);
  ctx.arcTo(jawHalfW, jawBottom, jawHalfW, jawBottom - cornerR, cornerR);
  ctx.lineTo(jawHalfW, intersectY);
  ctx.closePath();
}

function skullEyeSocket(ctx, Rc, cy0, mirror) {
  const pts = [[0.10, -0.30], [0.62, -0.24], [0.72, 0.06], [0.44, 0.34], [0.10, 0.10]];
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = x * Rc * mirror, py = cy0 + y * Rc;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function skullNasalCavity(ctx, Rc, cy0) {
  ctx.beginPath();
  ctx.moveTo(-0.16 * Rc, cy0 + 0.22 * Rc);
  ctx.lineTo(0.16 * Rc, cy0 + 0.22 * Rc);
  ctx.lineTo(0, cy0 + 0.5 * Rc);
  ctx.closePath();
}

function skullGrin(ctx, jawHalfW, cy0, jawBottom, darkColor, lightColor) {
  const bandTop = cy0 + (jawBottom - cy0) * 0.42;
  ctx.fillStyle = darkColor;
  ctx.fillRect(-jawHalfW * 0.92, bandTop, jawHalfW * 1.84, (jawBottom - bandTop) * 0.92);
  const n = 7, totalW = jawHalfW * 1.7, toothW = (totalW / n) * 0.7, gap = (totalW / n) * 0.3;
  const startX = -totalW / 2;
  ctx.fillStyle = lightColor;
  for (let i = 0; i < n; i++) {
    const x0 = startX + i * (toothW + gap);
    const topY = bandTop;
    const tipY = topY + (jawBottom - bandTop) * 0.72 * (i % 2 === 0 ? 1 : 0.6);
    ctx.beginPath();
    ctx.moveTo(x0, topY);
    ctx.lineTo(x0 + toothW, topY);
    ctx.lineTo(x0 + toothW * 0.6, tipY);
    ctx.lineTo(x0 + toothW * 0.4, tipY);
    ctx.closePath();
    ctx.fill();
  }
}

// "Bevel + Rim Light" — Option 3 of 6 shading treatments shown in a
// dedicated mockup (the flat single-tone fill it replaces read as
// noticeably flatter than every other maze element, which all already
// use gradients/glow), picked over Flat/Soft Gradient/Recessed Features/
// Glossy Highlight/Chrome. A strong directional light gradient across the
// body, a bright rim-light arc along the lit (upper-left) edge and a dark
// rim along the shadowed (lower-right) edge, plus a small specular
// highlight — the eyes/nose/teeth stay flat dark cutouts, unchanged from
// before (that's the "Recessed Features" option's own territory, not
// this one's).
function drawSkull(ctx, x, y, R, pulse) {
  ctx.save();
  ctx.translate(x, y);

  const glowR = R * (1.55 + pulse * 0.35);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
  glow.addColorStop(0, `rgba(${SKULL_HUE},${0.4 + pulse * 0.25})`);
  glow.addColorStop(0.6, `rgba(${SKULL_HUE},${0.12 + pulse * 0.1})`);
  glow.addColorStop(1, `rgba(${SKULL_HUE},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();

  const { Rc, cy0, jawHalfW, jawBottom } = skullLandmarks(R);

  // Body — directional bevel gradient (light upper-left to dark
  // lower-right) instead of a flat fill.
  skullOutline(ctx, R);
  const bodyGrad = ctx.createLinearGradient(-R * 0.6, -R * 0.8, R * 0.5, R * 0.6);
  bodyGrad.addColorStop(0, '#ffb3a0');
  bodyGrad.addColorStop(0.45, '#ff5540');
  bodyGrad.addColorStop(1, '#5c0e08');
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.lineWidth = R * 0.02;
  ctx.strokeStyle = '#0a0c13';
  ctx.stroke();

  // Rim light along the lit edge, dark rim along the shadowed edge —
  // clipped to the outline so both arcs only ever paint over the body,
  // never spill past the silhouette.
  ctx.save();
  skullOutline(ctx, R);
  ctx.clip();
  ctx.lineWidth = R * 0.05;
  ctx.strokeStyle = 'rgba(255,220,200,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.1, R * 0.95, R * 0.95, 0, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.1, R * 0.95, R * 0.95, 0, Math.PI * 0.05, Math.PI * 0.55);
  ctx.stroke();
  ctx.restore();

  // Eyes/nose/teeth — unchanged flat dark cutouts.
  ctx.save();
  skullOutline(ctx, R);
  ctx.clip();
  ctx.fillStyle = '#0a0c13';
  skullEyeSocket(ctx, Rc, cy0, 1); ctx.fill();
  skullEyeSocket(ctx, Rc, cy0, -1); ctx.fill();
  skullNasalCavity(ctx, Rc, cy0); ctx.fill();
  skullGrin(ctx, jawHalfW, cy0, jawBottom, '#0a0c13', `rgba(${SKULL_HUE},1)`);
  ctx.restore();

  // Specular highlight, on top of everything.
  const hl = ctx.createRadialGradient(-R * 0.24, -R * 0.5, 0, -R * 0.24, -R * 0.5, R * 0.22);
  hl.addColorStop(0, 'rgba(255,255,255,0.5)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.5, R * 0.22, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

export default class Maze {
  // `difficulty` — 'easy' | 'medium' | 'hard', see DIFFICULTY_PRESETS —
  // falls back to 'medium' for anything unrecognized (including omitted).
  constructor(canvasWidth, canvasHeight, difficulty = 'medium') {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.age = 0;
    // Spawns fully off-screen above (its own bottom edge exactly at the
    // canvas top), same "own extent as margin" convention every other
    // WARPZ obstacle uses.
    this.y = -TOTAL_HEIGHT;

    const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.medium;
    this.difficulty = DIFFICULTY_PRESETS[difficulty] ? difficulty : 'medium';
    this._opensPerToggle = preset.opensPerToggle;
    this._closesPerToggle = preset.closesPerToggle;
    this._retoggleInterval = preset.retoggleInterval;

    const genRand = mulberry32(Math.floor(Math.random() * 1e6));
    const cells = preset.generator === 'prim' ? generateCellsPrim(genRand) : generateCells(genRand);
    applyBraiding(cells, genRand, preset.braidPercent);
    this.entranceCol = Math.floor(genRand() * COLS);
    this.exitCol = Math.floor(genRand() * COLS);
    if (COLS > 1 && this.exitCol === this.entranceCol) this.exitCol = (this.exitCol + 1) % COLS;

    // Distinct random cells for the static shards/orbs (see SHARD_COUNT/
    // ORB_COUNT's own comment) — a Fisher-Yates shuffle over every cell in
    // the grid, using the same seeded genRand as the rest of construction
    // so a given maze's layout is otherwise reproducible, then the shards
    // and orbs each take their own slice so neither set can land on the
    // same cell as the other.
    const cellPool = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cellPool.push({ r, c });
    for (let i = cellPool.length - 1; i > 0; i--) {
      const j = Math.floor(genRand() * (i + 1));
      [cellPool[i], cellPool[j]] = [cellPool[j], cellPool[i]];
    }
    this._shardCells = cellPool.slice(0, SHARD_COUNT);
    this._orbCells = cellPool.slice(SHARD_COUNT, SHARD_COUNT + ORB_COUNT);

    const cellW = (canvasWidth - GRID_MARGIN * 2) / COLS;
    this.cellW = cellW;

    // hDoors[r][c]: horizontal edge between node(r,c) and node(r,c+1), for
    // r=1..ROWS-1 (internal only — r=0/r=ROWS are the fixed top/bottom
    // boundary, handled separately in resolveSolid()/draw() since they're
    // never toggleable). vDoors[r][c]: vertical edge between node(r,c)
    // and node(r+1,c), for c=1..COLS-1 (internal only — c=0/c=COLS are
    // the fixed left/right boundary, always sealed, no gaps ever).
    this.hDoors = Array.from({ length: ROWS + 1 }, () => new Array(COLS).fill(null));
    this.vDoors = Array.from({ length: ROWS }, () => new Array(COLS + 1).fill(null));
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const open = !cells[r - 1][c].S; // equivalently !cells[r][c].N
        this.hDoors[r][c] = freshDoor(open ? 'open' : 'sealed', cellW, genRand);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 1; c < COLS; c++) {
        const open = !cells[r][c - 1].E; // equivalently !cells[r][c].W
        this.vDoors[r][c] = freshDoor(open ? 'open' : 'sealed', CELL_H, genRand);
      }
    }

    this._retoggleTimer = this._retoggleInterval;

    this._nodeAnims = [];
    for (let i = 0; i < (ROWS + 1) * (COLS + 1); i++) this._nodeAnims.push(buildNodeAnim(genRand));

    // The skull — see its own header comment above (right before
    // SKULL_SPEED) for the full spec. `_playerHasExited` starts undefined
    // (falsy) and is set to `true` externally by index.js the same one-shot
    // way it already drives the completion bonus orb — read here, never
    // written here.
    this._skull = null;
    this._hasSpawnedFirstSkull = false;
    this._nextSkullDelay = 0; // counts down after a skull despawns, before the NEXT one may spawn — see SKULL_RESPAWN_DELAY's own comment
  }

  nodeX(c) { return GRID_MARGIN + c * this.cellW; }
  nodeY(r) { return this.y + r * CELL_H; }

  // Fixed anchor points for the maze's own static collectibles — same
  // "recompute fresh from current position every call" contract as
  // Station's own collectibleAnchors(), since index.js repositions each
  // attached shard/orb from this every frame as the maze descends.
  collectibleAnchors() {
    const cellCenter = ({ r, c }) => ({ x: this.nodeX(c) + this.cellW / 2, y: this.nodeY(r) + CELL_H / 2 });
    return {
      shardPoints: this._shardCells.map(cellCenter),
      orbPoints: this._orbCells.map(cellCenter),
    };
  }

  update(dt) {
    this.age += dt;
    this.y += VERTICAL_SPEED * dt;

    for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) advanceDoorPhase(this.hDoors[r][c], dt);
    for (let r = 0; r < ROWS; r++) for (let c = 1; c < COLS; c++) advanceDoorPhase(this.vDoors[r][c], dt);

    this._retoggleTimer -= dt;
    if (this._retoggleTimer <= 0) {
      this._retoggleTimer += this._retoggleInterval;
      this._retoggleDoors();
    }

    this._updateSkull(dt);
  }

  // Adjacency list over the maze's cells (index = r*COLS+c), one entry per
  // currently-PASSABLE door (see isBlockingPhase) — this is the graph
  // findBridges() runs against, so it reflects real-time physical
  // passability, not "will be open soon" (a door mid-way through its
  // OPENING animation is still blocking; see isBlockingPhase's own
  // comment), matching the connectivity guarantee's own requirement that
  // it hold at every instant, not just once transitions finish.
  _buildPassableGraph() {
    const adj = Array.from({ length: ROWS * COLS }, () => []);
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const d = this.hDoors[r][c];
        if (isBlockingPhase(d.phase)) continue;
        const a = (r - 1) * COLS + c, b = r * COLS + c;
        adj[a].push({ to: b, door: d }); adj[b].push({ to: a, door: d });
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 1; c < COLS; c++) {
        const d = this.vDoors[r][c];
        if (isBlockingPhase(d.phase)) continue;
        const a = r * COLS + (c - 1), b = r * COLS + c;
        adj[a].push({ to: b, door: d }); adj[b].push({ to: a, door: d });
      }
    }
    return adj;
  }

  // ==================== the skull ====================

  _cellCenter(r, c) {
    return { x: this.nodeX(c) + this.cellW / 2, y: this.nodeY(r) + CELL_H / 2 };
  }

  // EVERY spawn — first skull and every one after it — uses this, per the
  // user's explicit follow-up: spawning at the literal exit (row 0) can
  // put a skull far off-screen above at the moment it's triggered, not
  // just for the first one. The maze's own top edge doesn't scroll into
  // view for tens of seconds after spawn, and a later skull's own
  // SKULL_RESPAWN_DELAY-gated trigger is just as likely to land while the
  // exit is still off-screen as the first one was. So every spawn computes
  // the FULL exit->entrance route once (bfsFullPath(), unlike every other
  // pathing call in this file which only ever wants the next hop) and
  // starts the skull at the LAST cell along THAT REAL ROUTE that's still
  // OFF-screen, one hop before the route first becomes visible — per the
  // user's explicit live-testing follow-up, spawning already inside the
  // visible area made the skull just materialize out of nowhere with no
  // warning; starting one hop short means _updateSkull()'s own normal
  // movement carries it across the boundary on the very next hop, so it
  // visibly travels in from outside rather than popping in. If the exit
  // itself is already visible, there's no earlier off-screen cell to fall
  // back to, so this is still just the exit cell (a strict generalization
  // of "spawn at the exit," not a different behavior in that case).
  _spawnSkullOnRoute() {
    const exitIdx = 0 * COLS + this.exitCol;
    const entranceIdx = (ROWS - 1) * COLS + this.entranceCol;
    const path = bfsFullPath(this._buildPassableGraph(), exitIdx, entranceIdx);
    let spawnIdx = exitIdx;
    if (path) {
      for (const idx of path) {
        const r = Math.floor(idx / COLS);
        const cy = this.nodeY(r) + CELL_H / 2;
        if (cy >= 0 && cy <= this.canvasHeight) break; // first on-screen cell — spawn at the still-off-screen cell right before it instead
        spawnIdx = idx;
      }
    }
    const r = Math.floor(spawnIdx / COLS), c = spawnIdx % COLS;
    this._skull = { r, c, targetR: r, targetC: c, progress: 0, exiting: false };
  }

  // Advances the skull one frame: if it's currently sitting still at a
  // cell (targetR/targetC === r/c), that means it just arrived (or just
  // spawned) and needs its next hop planned fresh — a live BFS over the
  // CURRENT passable graph toward the entrance cell (see bfsNextHop()'s
  // own comment for why this is recomputed here rather than once at
  // spawn). Reaching the entrance cell doesn't despawn it immediately —
  // per the user's explicit "actually exit fully" request, it takes one
  // more straight hop DOWN THROUGH the entrance gap (s.exiting, no
  // further pathing needed) so it visually clears the maze's own bottom
  // boundary before vanishing, rather than disappearing mid-cell.
  // SKULL_RESPAWN_DELAY only starts counting down once that final leg
  // actually completes — the following skull spawns once THAT elapses,
  // not instantly.
  _updateSkull(dt) {
    if (!this._skull && !this._playerHasExited) {
      if (!this._hasSpawnedFirstSkull) {
        // First skull: wait for the ENTRANCE (the edge that scrolls into
        // view first, right at spawn) to reach the canvas's own vertical
        // midpoint — not the exit, which can take tens of seconds longer
        // to even become visible. Per the user's explicit spec.
        if (this.y + TOTAL_HEIGHT >= this.canvasHeight / 2) {
          this._spawnSkullOnRoute();
          this._hasSpawnedFirstSkull = true;
        }
      } else {
        this._nextSkullDelay -= dt;
        if (this._nextSkullDelay <= 0) this._spawnSkullOnRoute();
      }
    }
    if (!this._skull) return;

    const s = this._skull;
    if (s.exiting) {
      // Final leg: straight down through the gap, one cell-height's
      // worth, no pathing involved — just travel to clear the boundary.
      s.progress += (SKULL_SPEED * dt) / CELL_H;
      if (s.progress >= 1) { this._skull = null; this._nextSkullDelay = SKULL_RESPAWN_DELAY; }
      return;
    }

    if (s.r === s.targetR && s.c === s.targetC) {
      const entranceIdx = (ROWS - 1) * COLS + this.entranceCol;
      const curIdx = s.r * COLS + s.c;
      if (curIdx === entranceIdx) { s.exiting = true; s.progress = 0; return; }
      const nextIdx = bfsNextHop(this._buildPassableGraph(), curIdx, entranceIdx);
      if (nextIdx === null) return; // shouldn't happen given the connectivity guarantee — retries next frame
      s.targetR = Math.floor(nextIdx / COLS);
      s.targetC = nextIdx % COLS;
      s.progress = 0;
    }

    const vertical = s.targetR !== s.r;
    const edgeLen = vertical ? CELL_H : this.cellW;
    s.progress += (SKULL_SPEED * dt) / edgeLen;
    if (s.progress >= 1) { s.r = s.targetR; s.c = s.targetC; s.progress = 0; }
  }

  _skullScreenPos() {
    if (!this._skull) return null;
    const s = this._skull;
    const from = this._cellCenter(s.r, s.c);
    if (s.exiting) {
      // Straight down through the gap, one cell-height's worth — no
      // second grid cell involved, so this doesn't go through
      // _cellCenter() for its target the way a normal hop does.
      return { x: from.x, y: from.y + CELL_H * s.progress };
    }
    if (s.r === s.targetR && s.c === s.targetC) return from;
    const to = this._cellCenter(s.targetR, s.targetC);
    return { x: from.x + (to.x - from.x) * s.progress, y: from.y + (to.y - from.y) * s.progress };
  }

  // Lethal — unlike every door/wall in this file, contact with the skull
  // ends the round for the player (see the skull's own header comment).
  // A plain circle-circle check against SKULL_COLLISION_R; no "slide"
  // resolution the way solid geometry gets, since this isn't physical
  // constraint, it's a hit test.
  touchesSkull(x, y, radius) {
    const pos = this._skullScreenPos();
    if (!pos) return false;
    return Math.hypot(x - pos.x, y - pos.y) < radius + SKULL_COLLISION_R;
  }

  // Every retoggleInterval seconds: opensPerToggle currently-SEALED doors
  // start opening, and up to closesPerToggle currently-OPEN doors start
  // closing — but a close is only ever picked if it's currently NOT a
  // bridge (see the header's own "connectivity guarantee" comment), so
  // the maze can never be reshaped into an unsolvable or partially-cut-off
  // state. Opens are applied first — always safe regardless of order, but
  // NOT because they free up same-tick slack for the closes below: a door
  // that just started opening is in the 'colorToGreen' phase, which is
  // still blocking (see isBlockingPhase) for its own ~2.8s animation, so
  // it doesn't become a real alternate route until a later tick. Closes
  // are picked one at a time, each preceded by a fresh bridge check
  // against the graph as it stands right now — including any closes
  // already applied this same tick, since closing one door can turn a
  // previously-safe door into a bridge for the next pick. A door already
  // mid-transition is simply not in either candidate pool — never
  // interrupted, same as before.
  _retoggleDoors() {
    const sealedCandidates = [];
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const d = this.hDoors[r][c];
        if (d.phase === 'sealed') sealedCandidates.push(d);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 1; c < COLS; c++) {
        const d = this.vDoors[r][c];
        if (d.phase === 'sealed') sealedCandidates.push(d);
      }
    }
    pickRandom(sealedCandidates, this._opensPerToggle).forEach((d) => { d.phase = 'colorToGreen'; d.phaseElapsed = 0; });

    for (let i = 0; i < this._closesPerToggle; i++) {
      const bridges = findBridges(this._buildPassableGraph());
      const closable = [];
      for (let r = 1; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const d = this.hDoors[r][c];
          if (d.phase === 'open' && !bridges.has(d)) closable.push(d);
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 1; c < COLS; c++) {
          const d = this.vDoors[r][c];
          if (d.phase === 'open' && !bridges.has(d)) closable.push(d);
        }
      }
      if (closable.length === 0) break; // nothing safe to close right now
      const pick = closable[Math.floor(Math.random() * closable.length)];
      pick.phase = 'emerge'; pick.phaseElapsed = 0;
    }
  }

  isOffScreen() {
    return this.y > this.canvasHeight;
  }

  // Topological "somewhere within the maze's own vertical span" check —
  // used for the antenna-hide, same idea as Station's containsPlayer().
  // The maze spans (almost) the full canvas width already (6px margin
  // each side), so only the Y span is worth checking.
  containsPlayer(x, y) {
    return y >= this.y && y <= this.y + TOTAL_HEIGHT;
  }

  // ==================== physical constraint (solid) ====================

  resolveSolid(x, y, radius) {
    const shapes = [];
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r === 0 && c === this.exitCol) || (r === ROWS && c === this.entranceCol)) continue; // permanent gaps
        const blocking = (r === 0 || r === ROWS) ? true : isBlockingPhase(this.hDoors[r][c].phase);
        if (!blocking) continue;
        const x0 = this.nodeX(c), x1 = this.nodeX(c + 1), yy = this.nodeY(r);
        const cx = (x0 + x1) / 2, halfW = (x1 - x0) / 2;
        shapes.push({ resolve: (px, py, rr) => resolveCircleAgainstRect(px, py, rr, cx, yy, 0, halfW, WALL_THICKNESS / 2) });
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const blocking = (c === 0 || c === COLS) ? true : isBlockingPhase(this.vDoors[r][c].phase);
        if (!blocking) continue;
        const xx = this.nodeX(c), y0 = this.nodeY(r), y1 = this.nodeY(r + 1);
        const cy = (y0 + y1) / 2, halfW = (y1 - y0) / 2;
        shapes.push({ resolve: (px, py, rr) => resolveCircleAgainstRect(px, py, rr, xx, cy, Math.PI / 2, halfW, WALL_THICKNESS / 2) });
      }
    }
    return resolveCircleAgainstShapes(x, y, radius, shapes);
  }

  // Stateless "currently pressed against a wall face" check, same purpose
  // as Station's touchesRing() — used for index.js's bottom-edge crush
  // rule. Mirrors resolveCircleAgainstRect's own closest-point math but
  // only measures distance, never pushes.
  _touchingRect(x, y, radius, cx, cy, angle, halfW, halfH) {
    const dx = x - cx, dy = y - cy;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const closestX = Math.max(-halfW, Math.min(halfW, localX));
    const closestY = Math.max(-halfH, Math.min(halfH, localY));
    const dist = Math.hypot(localX - closestX, localY - closestY);
    return dist < radius + WALL_CONTACT_EPS;
  }

  touchesWall(x, y, radius) {
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r === 0 && c === this.exitCol) || (r === ROWS && c === this.entranceCol)) continue;
        const blocking = (r === 0 || r === ROWS) ? true : isBlockingPhase(this.hDoors[r][c].phase);
        if (!blocking) continue;
        const x0 = this.nodeX(c), x1 = this.nodeX(c + 1), yy = this.nodeY(r);
        if (this._touchingRect(x, y, radius, (x0 + x1) / 2, yy, 0, (x1 - x0) / 2, WALL_THICKNESS / 2)) return true;
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const blocking = (c === 0 || c === COLS) ? true : isBlockingPhase(this.vDoors[r][c].phase);
        if (!blocking) continue;
        const xx = this.nodeX(c), y0 = this.nodeY(r), y1 = this.nodeY(r + 1);
        if (this._touchingRect(x, y, radius, xx, (y0 + y1) / 2, Math.PI / 2, (y1 - y0) / 2, WALL_THICKNESS / 2)) return true;
      }
    }
    return false;
  }

  // ==================== drawing ====================

  _drawDoorPanel(ctx, x0, y0, x1, y1, door) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    ctx.save();
    ctx.translate(x0, y0); ctx.rotate(Math.atan2(dy, dx));
    switch (door.phase) {
      case 'sealed':
        drawFlatPanel(ctx, len, NORMAL_TOP, NORMAL_BOTTOM, 1);
        break;
      case 'colorToGreen': {
        const p = clamp01(door.phaseElapsed / COLOR_DUR);
        drawFlatPanel(ctx, len, lerp3(NORMAL_TOP, GREEN_TOP, p), lerp3(NORMAL_BOTTOM, GREEN_BOTTOM, p), 1 - p);
        break;
      }
      case 'explode': {
        const p = clamp01(door.phaseElapsed / EXPLODE_DUR);
        const shrinkP = Math.min(1, p / 0.2);
        const panelLen = len * (1 - shrinkP);
        if (panelLen > 0.5) drawFlatPanel(ctx, panelLen, GREEN_TOP, GREEN_BOTTOM, 0);
        drawExplodeDust(ctx, p, door.dust);
        break;
      }
      case 'open':
        break;
      case 'emerge':
        drawEmergeArc(ctx, len, clamp01(door.phaseElapsed / EMERGE_DUR), this.age);
        break;
      case 'colorToNormal': {
        const p = clamp01(door.phaseElapsed / COLOR_DUR);
        drawFlatPanel(ctx, len, lerp3(GREEN_TOP, NORMAL_TOP, p), lerp3(GREEN_BOTTOM, NORMAL_BOTTOM, p), p);
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  _drawStaticWall(ctx, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    ctx.save();
    ctx.translate(x0, y0); ctx.rotate(Math.atan2(dy, dx));
    drawFlatPanel(ctx, len, NORMAL_TOP, NORMAL_BOTTOM, 1);
    ctx.restore();
  }

  draw(ctx) {
    // Only rows within (or just past) the visible canvas are worth
    // drawing — the grid is 1600px tall against an 800px canvas, so more
    // than half of it is off-screen at any given moment.
    const minRow = Math.max(0, Math.floor((0 - this.y) / CELL_H) - 1);
    const maxRow = Math.min(ROWS, Math.ceil((this.canvasHeight - this.y) / CELL_H) + 1);

    for (let r = minRow; r <= maxRow && r <= ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r === 0 && c === this.exitCol) || (r === ROWS && c === this.entranceCol)) continue;
        const x0 = this.nodeX(c), x1 = this.nodeX(c + 1), yy = this.nodeY(r);
        if (r === 0 || r === ROWS) this._drawStaticWall(ctx, x0, yy, x1, yy);
        else this._drawDoorPanel(ctx, x0, yy, x1, yy, this.hDoors[r][c]);
      }
    }
    for (let r = minRow; r < maxRow && r < ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const xx = this.nodeX(c), y0 = this.nodeY(r), y1 = this.nodeY(r + 1);
        if (c === 0 || c === COLS) this._drawStaticWall(ctx, xx, y0, xx, y1);
        else this._drawDoorPanel(ctx, xx, y0, xx, y1, this.vDoors[r][c]);
      }
    }
    for (let r = minRow; r <= maxRow && r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const idx = r * (COLS + 1) + c;
        const { glow, flash } = nodeState(this._nodeAnims[idx], this.age);
        drawNode(ctx, this.nodeX(c), this.nodeY(r), glow, flash);
      }
    }

    const skullPos = this._skullScreenPos();
    if (skullPos) {
      const pulse = 0.5 + 0.5 * Math.sin(this.age * 2.2);
      // Size breathes on its own SKULL_SIZE_PULSE_PERIOD-second cycle,
      // independent of the glow pulse above — eased via skullPulseCurve()
      // (ease-in-out cubic, picked over 5 other curves in a dedicated
      // mockup — see that function's own comment) rather than a plain
      // sine, for a firmer hold at each extreme.
      const cyclePos = (this.age % SKULL_SIZE_PULSE_PERIOD) / SKULL_SIZE_PULSE_PERIOD;
      const sizePulse = 1 + SKULL_SIZE_PULSE_AMOUNT * skullPulseCurve(cyclePos);
      drawSkull(ctx, skullPos.x, skullPos.y, SKULL_DRAW_R * sizePulse, pulse);
    }
  }
}
