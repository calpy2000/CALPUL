// ==========================================
// MODULE: THE STATION OBSTACLE CLASS
// ==========================================
//
// A large industrial-hull space station: two concentric rings (nearly as
// wide as the canvas, each spinning slowly — outer clockwise, inner
// counter-clockwise), each with 3 doors that cycle open/sealed on their own
// timer, plus 6 static (non-rotating) radial spokes bridging the channel
// between the rings, each spoke gated by an electric-arc door of its own.
// Descends straight down the canvas center at the starfield's own scroll
// speed. Geometry/material/lighting/door-timing choices below all came out
// of a dedicated mockup-and-approve pass (ring hull style, ring thinness,
// beacon placement, spoke count/sizing, and the electric-squiggle spoke
// door specifically) before this file existed — nothing here is a first
// guess, including the exact fractions (see each constant's own comment
// for where its number came from).
//
// Per the user's explicit spec, Station introduces a second COLLISION
// CATEGORY alongside every other obstacle's lethal-on-touch behavior: the
// two rings (hull + their own doors) and the spoke shafts are a PHYSICAL
// CONSTRAINT — they block the player's movement (with a "slide along the
// surface" response, not a hard stop, per the user's explicit choice) but
// don't end the round. Only the spokes' electric-arc doors are lethal,
// exactly like every other obstacle. Three query methods reflect that
// split for index.js to use: resolveSolid() (physical constraint),
// hitsLethal() (touch = death), and containsPlayer() (topological "have
// they passed through a door into the ring's interior" check, used for the
// antenna-hide and the "carried down, trapped" lose condition — see
// index.js's own comments on both).
//
// The solid-collision primitives themselves (circle-vs-annulus-with-gaps,
// circle-vs-rotated-rect) live in solid-collision.js, written obstacle-
// agnostic on purpose — the user's already flagged a second, solid-only
// obstacle coming later that reuses that same file rather than duplicating
// this resolution logic.

import { resolveCircleAgainstAnnulus, resolveCircleAgainstRect, resolveCircleAgainstShapes } from './solid-collision.js';
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

const TAU = Math.PI * 2;
function degToRad(d) { return (d * Math.PI) / 180; }
// Clock-angle convention used throughout WARPZ's obstacle code: 0 = up,
// increasing clockwise.
function polar(cx, cy, r, angle) { return { x: cx + Math.sin(angle) * r, y: cy - Math.cos(angle) * r }; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function normalizeAngleDelta(delta) {
  let d = delta % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function glow(ctx, color, blur, draw) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

// Shortest distance from point (px,py) to the line segment (ax,ay)-(bx,by)
// — same technique Zapper.js uses for its own beam-vs-player check.
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

// ---- door timing (shared by both rings and all 6 spokes) ----
//
// Doors are an explicit finite state machine per door — SEALED -> OPENING
// -> OPEN -> CLOSING -> SEALED. Per the user's explicit request, the
// SEALED wait and the OPEN dwell are now RANDOMIZED per door, per cycle
// (average 4s / average 2s, both +/-30%), rerolled fresh every time a
// door re-enters SEALED — rather than the fixed, staggered-offset cyclic
// timing this used before.
//
// Two coordination rules layered on top of that per-door randomness, per
// the user's explicit spec (and mid-turn clarification):
//   - RING doors (outer, separately inner): no door may begin a NEW
//     opening before every other door in that same ring has had its own
//     turn to begin one — a round-robin fairness QUEUE, not mutual
//     exclusion. The user explicitly confirmed multiple doors in the same
//     ring CAN be open at the same time; this only governs the ORDER
//     doors are allowed to START a new opening in, not whether their open
//     windows can overlap with the door that opened right before them.
//   - SPOKE ("electric zap") doors: no two ADJACENT spokes may ever be
//     OPEN at the same time — checked only at the moment a spoke would
//     begin opening (if a neighbor is already non-SEALED, it just keeps
//     waiting, same "held past its own timer until the gating condition
//     clears" pattern the occupancy-hold rule below already uses).
//
// The original four occupancy rules from before are unchanged and still
// apply to every door (ring or spoke) on top of all of the above:
//   1. passable only once truly OPEN (no fuzzy "open enough" threshold)
//   2. the OPEN -> CLOSING transition alone is gated on the door's own
//      space being unoccupied — nothing else is
//   3. CLOSING (and SEALED/OPENING) are never passable
//   4. OPENING and CLOSING always run to completion once started —
//      occupancy is never consulted during those two phases, only OPEN
const DOOR_TRANSITION = 0.35; // fixed swing speed for the open/close animation itself — not randomized, only the SEALED wait and OPEN dwell are
const DOOR_SEALED_BASE = 2.0 / 1.5; // average seconds a door waits before it next opens — opening FREQUENCY increased 1.5x per explicit request, so this wait duration is divided by 1.5 (was 2.0)
const DOOR_OPEN_BASE = 2.0; // average seconds a door stays open
const DOOR_TIMING_VARIATION = 0.3; // +/-30%, applied independently to both durations, rerolled every cycle

function rollVaried(base, variation) {
  return base * (1 + (Math.random() * 2 - 1) * variation);
}

// A freshly SEALED door, ready to start counting down toward its own next
// (independently rolled) opening.
function freshSealedDoor() {
  return {
    phase: 'SEALED',
    phaseElapsed: 0,
    sealedDuration: rollVaried(DOOR_SEALED_BASE, DOOR_TIMING_VARIATION),
    openDuration: rollVaried(DOOR_OPEN_BASE, DOOR_TIMING_VARIATION),
  };
}

function opennessForPhase(phase, phaseElapsed) {
  if (phase === 'SEALED') return 0;
  if (phase === 'OPENING') return clamp01(phaseElapsed / DOOR_TRANSITION);
  if (phase === 'OPEN') return 1;
  return clamp01(1 - phaseElapsed / DOOR_TRANSITION); // CLOSING
}

// ---- TESTING MODE: every door (ring and spoke) forced permanently open ----
// Per the user's explicit "for now, in testing mode" request — flip the
// hand toggle below back to `false` to revert to the real tuned timing
// above exactly as it was; nothing else needs to change. Deliberately
// implemented as a READ-TIME override (effectiveDoorState() below) rather
// than mutating any door's actual phase/phaseElapsed — the real FSM keeps
// advancing normally in the background the whole time this is on,
// completely unused, so re-enabling the real behavior is a single boolean
// flip with nothing left over to clean up or resync.
//
// Also gated on IS_DEV_TOOLS (per the user's explicit follow-up request) —
// this is a fast-iteration convenience for dev testing, not something
// that should ever reach testers/real players even if the hand toggle
// above is accidentally left on `true` when TOOL_MODE flips away from
// 'dev' for a release.
const DOORS_ALWAYS_OPEN_TESTING_HAND_TOGGLE = true;
const DOORS_ALWAYS_OPEN_TESTING = getToolMode() === 'dev' && DOORS_ALWAYS_OPEN_TESTING_HAND_TOGGLE;
function effectiveDoorState(door) {
  return DOORS_ALWAYS_OPEN_TESTING ? { phase: 'OPEN', phaseElapsed: 0 } : door;
}

// Advances one door's FSM state by dt. `occupied` is ONLY consulted for
// the OPEN phase's exit transition (rule 2). `canOpen` is ONLY consulted
// for the SEALED phase's exit transition — false just holds it there past
// its own rolled sealedDuration until the caller says otherwise (a ring's
// queue-turn gate, or a spoke's neighbor-adjacency gate). OPENING and
// CLOSING always run to completion regardless of either (rule 4).
function advanceDoorPhase(door, dt, occupied, canOpen) {
  door.phaseElapsed += dt;
  switch (door.phase) {
    case 'SEALED':
      if (door.phaseElapsed >= door.sealedDuration && canOpen) {
        door.phase = 'OPENING';
        door.phaseElapsed -= door.sealedDuration;
      }
      break;
    case 'OPENING':
      if (door.phaseElapsed >= DOOR_TRANSITION) { door.phase = 'OPEN'; door.phaseElapsed -= DOOR_TRANSITION; }
      break;
    case 'OPEN':
      if (door.phaseElapsed >= door.openDuration && !occupied) { door.phase = 'CLOSING'; door.phaseElapsed -= door.openDuration; }
      break;
    case 'CLOSING':
      if (door.phaseElapsed >= DOOR_TRANSITION) { door.phase = 'SEALED'; door.phaseElapsed -= DOOR_TRANSITION; }
      break;
    default:
      break;
  }
}

// Fisher-Yates shuffle of [0..n-1] — used to build each ring's own
// round-robin "who's allowed to open next" order. `avoidFirst`, when
// given, swaps the first slot away from that index if the shuffle
// happened to land it there — used when refilling an exhausted queue so
// the door that JUST had its turn can never immediately cut back in line
// as the very next one too.
function shuffledIndices(n, avoidFirst) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (avoidFirst !== undefined && arr.length > 1 && arr[0] === avoidFirst) {
    const swapWith = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapWith]] = [arr[swapWith], arr[0]];
  }
  return arr;
}

// Used only for the "is the player currently standing in this door's own
// space" check that gates a door's OPEN -> CLOSING transition (rule 2),
// for both ring doors and spoke doors. Deliberately a plain approximation
// of the real player's radius (25, see index.js's own player.radius)
// rather than threaded through from the caller: this is a hold-open check,
// not core physics, so exact precision doesn't matter — a slightly
// generous margin just means the hold starts a beat earlier/later than a
// pixel-perfect check would.
const PLAYER_RADIUS_APPROX = 25;

// How long a player can sit inside an open gap, un-resolved, before
// resolveSolid gives up waiting for a genuine crossing and just holds them
// on whichever side they were already on. A defensive backstop for the
// pathological case of a player parked exactly on a gap's edge where
// occupancy detection itself might flicker frame to frame — the door FSM
// above already guarantees a door can't seal on an occupying player by
// construction, so this should essentially never fire in normal play.
const MAX_GAP_DWELL = 2.5;

// Tolerance for touchesRing()'s "currently pressed against this ring's
// face" distance check — a little looser than CLEARANCE_MARGIN (2, see
// solid-collision.js) since a player being actively pushed by the ring's
// own descent can sit a couple extra px off the exact resolved boundary
// between frames, not just exactly on it.
const RING_CONTACT_EPS = 4;

// Matches Starfield.js's near layer / the same convention Zapper.js and
// Cluster.js already use for their own straight-down drift, per the user's
// original "moves down the screen slowly, at the rate of the star field"
// spec.
const VERTICAL_SPEED = 38;

// ---- ring geometry — fractions of canvasWidth, exactly the numbers the
// approved mockup settled on after the inner-ring pinch-point fix. ----
const OUTER_R_OUTER_FRAC = 0.46;
const OUTER_R_INNER_FRAC = 0.415; // thinned from an original 0.40 to free up radial budget for the inner ring
const OUTER_HALF_ANGLE_DEG = 14;
const OUTER_ROTATION_SPEED = 0.165; // rad/sec, clockwise (1.5x'd from an original 0.11 per explicit request)
const OUTER_DOOR_COUNT = 4; // increased from 3 per the user's explicit request — half-angle left unchanged, so each door's own physical width is identical to before, just spaced 90° apart instead of 120°

const INNER_R_OUTER_FRAC = 0.23; // grown from an original 0.17 — see this file's own note below on why
const INNER_R_INNER_FRAC = 0.195;
const INNER_HALF_ANGLE_DEG = 27; // tightened from an original 35 once the bigger ring no longer needed as wide a door to stay passable
const INNER_ROTATION_SPEED = -0.165; // contra-rotating, per the approved mockup (1.5x'd from an original -0.11 per explicit request)
const INNER_DOOR_COUNT = 3;

// ---- spokes ----
// Six static (non-rotating) radial struts bridging the channel between the
// rings. Because they're straight struts (not wedges), the gap between two
// adjacent spokes is narrowest right where they meet the INNER ring, not
// at mid-channel — measuring that exact pinch point (not just eyeballing
// mid-channel) is what drove INNER_R_OUTER_FRAC up to 0.23 above; at the
// original 0.17 the pinch point only cleared the player by ~1.17x, not
// "easily." At the current numbers it clears by ~1.8x.
const SPOKE_COUNT = 6;
const SPOKE_HALFWIDTH_FRAC = 0.016;
const SPOKE_DOOR_LEN_FRAC = 0.161; // leaves a ~0.012-of-size solid cap at each end where a spoke meets a ring

const RIVET_COUNTS = { outer: 10, inner: 7 };

function buildRivets(rand, segmentCount, perSegment) {
  return Array.from({ length: segmentCount }, () =>
    Array.from({ length: perSegment }, () => ({ af: rand(), rf: 0.15 + rand() * 0.7 })));
}

export default class Station {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.x = canvasWidth / 2; // fixed for its whole lifetime — Station doesn't drift sideways like the field obstacles do
    const outerR = OUTER_R_OUTER_FRAC * canvasWidth;
    this.outerR = outerR; // cached for isOffScreen()
    this.y = -outerR; // spawns fully off-screen above, same "own radius as margin" convention Asteroid/Cluster use

    // Decorative-only RNG (rivet placement) — no gameplay meaning, so a
    // fresh Math-seeded roll per instance is fine (unlike e.g. a shot's
    // path seed, nothing here needs to be reproducible).
    const rand = mulberry32(Math.floor(Math.random() * 1e6));
    this.outerRivets = buildRivets(rand, OUTER_DOOR_COUNT, RIVET_COUNTS.outer);
    this.innerRivets = buildRivets(rand, INNER_DOOR_COUNT, RIVET_COUNTS.inner);

    // Which side of each ring the player is currently on — undefined until
    // resolveSolid() has actually run once. Owned by THIS instance (not
    // passed in from outside) specifically so it can never be measured
    // against a stale/moving reference frame — see solid-collision.js's
    // header note for why a remembered POSITION doesn't work once the
    // ring itself is moving (which Station always is).
    this._playerOuterIsOutside = undefined;
    this._playerInnerIsOutside = undefined;
    // this.age this ring's current open-gap dwell started at, or null if
    // not currently sitting in one — see resolveSolid()'s own comment on
    // MAX_GAP_DWELL for why this exists.
    this._outerGapDwellStart = null;
    this._innerGapDwellStart = null;

    this.age = 0;
    // Per-door FSM state — { phase, phaseElapsed, sealedDuration,
    // openDuration } — advanced every frame in update(). See this file's
    // door-timing header comment for the full design (randomized timing,
    // ring fairness queues, spoke adjacency rule).
    this._outerDoorStates = Array.from({ length: OUTER_DOOR_COUNT }, () => freshSealedDoor());
    this._innerDoorStates = Array.from({ length: INNER_DOOR_COUNT }, () => freshSealedDoor());
    this._spokeDoorStates = Array.from({ length: SPOKE_COUNT }, () => freshSealedDoor());
    // Round-robin "who's allowed to start a NEW opening next" order, one
    // per ring — see the door-timing header comment. Only the door at
    // queue[0] ever actually counts down its own SEALED wait; every other
    // door in that ring sits frozen at phaseElapsed=0 until it becomes
    // queue[0] itself, at which point _advanceRingDoor() resets+rerolls
    // it fresh — this is what keeps the ring's overall opening cadence
    // close to the requested ~4s average instead of every door's
    // independent timer having already elapsed long before its turn
    // actually comes around.
    this._outerQueue = shuffledIndices(OUTER_DOOR_COUNT);
    this._innerQueue = shuffledIndices(INNER_DOOR_COUNT);
  }

  // True if (playerX, playerY) is currently within the physical space of
  // the ring door at `doorAngle` — same angular half-width the door itself
  // uses, radially across the ring's own band (+/- a player-sized margin,
  // since this only needs to be "close enough to be mid-crossing," not
  // pixel-exact). Used only to decide whether that door's own timer should
  // pause this frame, not for collision.
  _isInRingDoorSpace(playerX, playerY, doorAngle, halfAngle, rOuter, rInner) {
    const dx = playerX - this.x, dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dx, -dy);
    const angleDiff = normalizeAngleDelta(angle - doorAngle);
    return Math.abs(angleDiff) < halfAngle &&
      dist >= rInner - PLAYER_RADIUS_APPROX && dist <= rOuter + PLAYER_RADIUS_APPROX;
  }

  // Same idea for a spoke's door zone — transforms into the spoke's own
  // local frame (identical convention to solid-collision.js's rect
  // resolver) and checks both the tangential (within the spoke's width)
  // and radial (within the door's own span) extents, each padded by a
  // player-sized margin.
  _isInSpokeDoorSpace(playerX, playerY, spokeAngle, hw, doorInnerBoundR, doorOuterBoundR) {
    const dx = playerX - this.x, dy = playerY - this.y;
    const localX = dx * Math.cos(spokeAngle) + dy * Math.sin(spokeAngle);
    const localY = -dx * Math.sin(spokeAngle) + dy * Math.cos(spokeAngle);
    const localRadius = -localY;
    return Math.abs(localX) < hw + PLAYER_RADIUS_APPROX &&
      localRadius >= doorInnerBoundR - PLAYER_RADIUS_APPROX && localRadius <= doorOuterBoundR + PLAYER_RADIUS_APPROX;
  }

  // `playerX`/`playerY` are optional (omit for e.g. a quick simulation
  // that doesn't care about door-holding) — when omitted, every door's
  // timer just advances normally, same as before this feature existed.
  update(dt, playerX, playerY) {
    this.age += dt;
    this.y += VERTICAL_SPEED * dt;

    const size = this.canvasWidth;
    const hasPlayer = playerX !== undefined && playerY !== undefined;

    const outerHalfAngle = degToRad(OUTER_HALF_ANGLE_DEG);
    const outerRotation = this._outerRotation();
    for (let i = 0; i < OUTER_DOOR_COUNT; i++) {
      const doorAngle = degToRad(i * (360 / OUTER_DOOR_COUNT)) + outerRotation;
      const occupied = hasPlayer && this._isInRingDoorSpace(
        playerX, playerY, doorAngle, outerHalfAngle, OUTER_R_OUTER_FRAC * size, OUTER_R_INNER_FRAC * size,
      );
      this._advanceRingDoor(this._outerDoorStates, this._outerQueue, i, dt, occupied);
    }

    const innerHalfAngle = degToRad(INNER_HALF_ANGLE_DEG);
    const innerRotation = this._innerRotation();
    for (let i = 0; i < INNER_DOOR_COUNT; i++) {
      const doorAngle = degToRad(i * (360 / INNER_DOOR_COUNT)) + innerRotation;
      const occupied = hasPlayer && this._isInRingDoorSpace(
        playerX, playerY, doorAngle, innerHalfAngle, INNER_R_OUTER_FRAC * size, INNER_R_INNER_FRAC * size,
      );
      this._advanceRingDoor(this._innerDoorStates, this._innerQueue, i, dt, occupied);
    }

    const hw = SPOKE_HALFWIDTH_FRAC * size;
    const outerR = OUTER_R_INNER_FRAC * size, innerR = INNER_R_OUTER_FRAC * size;
    const doorCenterR = (outerR + innerR) / 2;
    const halfLen = (SPOKE_DOOR_LEN_FRAC * size) / 2;
    const doorOuterBoundR = doorCenterR + halfLen, doorInnerBoundR = doorCenterR - halfLen;
    // Single, sequential pass, checking each spoke's neighbors' CURRENT
    // state at the moment of ITS OWN check (not a snapshot taken before
    // any of them moved this frame) — that's deliberate, not an oversight:
    // a snapshot-based version was tried first and let two neighbors that
    // both happened to be simultaneously eligible each see the OTHER as
    // still SEALED and both start opening in the same frame, violating
    // the no-adjacent-opens rule outright. Checking live means whichever
    // of a pair is processed first (by index order) "wins" for that frame
    // and the other one correctly sees it's no longer SEALED and waits —
    // an arbitrary but deterministic tie-break, and the only way to
    // actually guarantee the invariant every frame regardless of how many
    // neighbors become eligible at once.
    for (let i = 0; i < SPOKE_COUNT; i++) {
      const spokeAngle = degToRad((360 / SPOKE_COUNT) * i);
      const occupied = hasPlayer && this._isInSpokeDoorSpace(playerX, playerY, spokeAngle, hw, doorInnerBoundR, doorOuterBoundR);
      const door = this._spokeDoorStates[i];
      const left = (i - 1 + SPOKE_COUNT) % SPOKE_COUNT, right = (i + 1) % SPOKE_COUNT;
      const canOpen = this._spokeDoorStates[left].phase === 'SEALED' && this._spokeDoorStates[right].phase === 'SEALED';
      const wasSealed = door.phase === 'SEALED';
      advanceDoorPhase(door, dt, occupied, canOpen);
      if (!wasSealed && door.phase === 'SEALED') {
        // Finished a full cycle — reroll its own next wait/open durations
        // for the next time it comes around.
        door.sealedDuration = rollVaried(DOOR_SEALED_BASE, DOOR_TIMING_VARIATION);
        door.openDuration = rollVaried(DOOR_OPEN_BASE, DOOR_TIMING_VARIATION);
      }
    }
  }

  // Advances ring door `i`'s FSM by dt, gated on this ring's own
  // round-robin fairness queue — see the door-timing header comment and
  // the constructor's own comment for the full design. Only the door
  // currently at queue[0] ever ticks while SEALED; every other door in
  // the ring sits completely frozen (its own phaseElapsed doesn't advance
  // at all, not just gated) until it's promoted to queue[0], at which
  // point it's reset+rerolled fresh right here. A door that's already
  // past SEALED (mid OPENING/OPEN/CLOSING from an earlier turn) always
  // keeps ticking regardless of queue position — the queue only controls
  // the ORDER doors are allowed to BEGIN a new opening in, not anything
  // about doors already mid-cycle, which is what lets multiple doors in
  // the same ring be open at once.
  _advanceRingDoor(doorStates, queue, i, dt, occupied) {
    const door = doorStates[i];
    const isFront = queue[0] === i;
    if (door.phase === 'SEALED' && !isFront) return;

    const wasSealed = door.phase === 'SEALED';
    advanceDoorPhase(door, dt, occupied, true); // reaching this line while SEALED means isFront was true
    if (wasSealed && door.phase !== 'SEALED') {
      // Just started opening — had its turn, hand off to the next door in
      // the queue (refilling with a fresh shuffle if this was the last
      // one), resetting+rerolling it right now so ITS OWN wait starts
      // counting from this moment, not from whenever it happened to last
      // reset — see the constructor's own comment for why that matters.
      queue.shift();
      if (queue.length === 0) queue.push(...shuffledIndices(doorStates.length, i));
      const nextFront = doorStates[queue[0]];
      nextFront.phase = 'SEALED';
      nextFront.phaseElapsed = 0;
      nextFront.sealedDuration = rollVaried(DOOR_SEALED_BASE, DOOR_TIMING_VARIATION);
      nextFront.openDuration = rollVaried(DOOR_OPEN_BASE, DOOR_TIMING_VARIATION);
    }
  }

  isOffScreen() {
    return this.y - this.outerR > this.canvasHeight;
  }

  // ==================== shared geometry queries ====================

  _outerRotation() { return this.age * OUTER_ROTATION_SPEED; }
  _innerRotation() { return this.age * INNER_ROTATION_SPEED; }

  // Every door of a ring, as { angle, halfAngle, openness, label } — used
  // by both draw() and the solid/lethal queries below so they can never
  // disagree with what's actually on screen. `doorStates` is this ring's
  // own per-door FSM state array (this._outerDoorStates or
  // this._innerDoorStates) — each door's openness/label comes from ITS OWN
  // FSM state, advanced every frame in update().
  _ringDoors(rotation, halfAngleDeg, doorCount, doorStates) {
    const halfAngle = degToRad(halfAngleDeg);
    const doors = [];
    for (let i = 0; i < doorCount; i++) {
      const angle = degToRad(i * (360 / doorCount)) + rotation;
      const st = effectiveDoorState(doorStates[i]);
      doors.push({ angle, halfAngle, openness: opennessForPhase(st.phase, st.phaseElapsed), label: st.phase });
    }
    return doors;
  }

  _spokeDoors() {
    const doors = [];
    for (let i = 0; i < SPOKE_COUNT; i++) {
      const angle = degToRad((360 / SPOKE_COUNT) * i);
      const st = effectiveDoorState(this._spokeDoorStates[i]);
      doors.push({ angle, openness: opennessForPhase(st.phase, st.phaseElapsed), label: st.phase });
    }
    return doors;
  }

  // Topological "inside the outer ring" check — used for the antenna-hide
  // and the trapped/carried-down lose condition, independent of whether
  // the player happens to be touching any solid material right now.
  containsPlayer(x, y) {
    const dist = Math.hypot(x - this.x, y - this.y);
    return dist < OUTER_R_INNER_FRAC * this.canvasWidth;
  }

  // True once (x, y) is fully clear of the outer ring's own hull material
  // (past its OUTER face, not merely past its inner face like
  // containsPlayer() checks — see that gap's own history below) AND
  // positioned ABOVE the ring's current center, per the user's explicit
  // spec: "outside the outer ring and above it," not merely outside in
  // any direction. That second half matters on its own: a player who
  // only grazed a door briefly (in and straight back out the same side,
  // without a genuine deliberate crossing) can satisfy "outside the
  // ring's radius" without ever having gotten meaningfully clear of it —
  // requiring them to end up ABOVE the ring's own descending position
  // means they've actually gotten ahead of/past it, which only happens
  // from a real traversal (or, at worst, once the ring's own continued
  // descent eventually carries its center below wherever they ended up —
  // still a bounded wait, never permanently stuck).
  //
  // The outer-vs-inner-face distinction: containsPlayer() reads false the
  // instant a player crosses back over the ring's INNER edge while
  // exiting through a door — at that exact moment they're still
  // physically standing within the ring's own radial thickness
  // (mid-doorway), not actually clear of it yet. index.js's own "player
  // has successfully exited the station" tracking (which gates when the
  // next obstacle type/sequence step is allowed to resume) needs this
  // stricter, fully-clear definition — using containsPlayer() there let
  // the next step start while the player was still crossing through the
  // door, a real reported bug.
  hasFullyExitedOuterRing(x, y) {
    const dist = Math.hypot(x - this.x, y - this.y);
    return dist >= OUTER_R_OUTER_FRAC * this.canvasWidth && y < this.y;
  }

  // Fixed anchor points for "station mode"'s own collectibles, per the
  // user's explicit spec: one star shard centered in each of the 6
  // channel compartments between the rings and two adjacent (static,
  // non-rotating) spokes, plus one energy orb dead center of the inner
  // ring. index.js reads this fresh every frame (not just once at spawn)
  // to reposition its own attached shard/orb instances — every point here
  // only needs to track this.y (the station's own descent), never this
  // ring's rotation, since the spokes themselves never rotate and this.x
  // never drifts once spawned; recomputing from scratch each frame is
  // simpler and just as cheap as caching a one-time offset.
  collectibleAnchors() {
    const size = this.canvasWidth;
    const outerR = OUTER_R_INNER_FRAC * size, innerR = INNER_R_OUTER_FRAC * size;
    const channelCenterR = (outerR + innerR) / 2;
    const shardPoints = [];
    for (let i = 0; i < SPOKE_COUNT; i++) {
      // Halfway between spoke i and spoke i+1 (spokes sit at multiples of
      // 360/SPOKE_COUNT) — the middle of that channel "space."
      const angle = degToRad((360 / SPOKE_COUNT) * (i + 0.5));
      shardPoints.push(polar(this.x, this.y, channelCenterR, angle));
    }
    return { shardPoints, orbPoint: { x: this.x, y: this.y } };
  }

  // Is (x, y) currently pressed up against either ring's own solid face —
  // from any side (outside pressing on the outer ring's outer face, in the
  // channel pressing on either ring's inner/outer face, or in the core
  // pressing on the inner ring's inner face) — as opposed to sitting in an
  // open doorway. Used for the "pinned at the bottom edge AND squeezed by
  // a ring" crush check in index.js, which containsPlayer() alone can't
  // catch: a player pinned at a bottom CORNER can be genuinely crushed
  // against the canvas floor by the ring's material without ever being
  // close enough to the station's center to read as "inside" (see
  // index.js's own comment on why that's a real, distinct case). A
  // stateless read done purely by distance-to-boundary, deliberately NOT
  // reusing resolveSolid()'s own hint-based state — this needs to answer
  // "touching right now," not "which side does the caller's own move
  // history put them on."
  touchesRing(x, y, radius) {
    const size = this.canvasWidth;
    const outerDoors = this._ringDoors(this._outerRotation(), OUTER_HALF_ANGLE_DEG, OUTER_DOOR_COUNT, this._outerDoorStates);
    const outerGaps = outerDoors.filter((d) => d.label === 'OPEN').map((d) => ({ center: d.angle, halfWidth: d.halfAngle }));
    if (this._touchingAnnulusFace(x, y, radius, OUTER_R_OUTER_FRAC * size, OUTER_R_INNER_FRAC * size, outerGaps)) return true;

    const innerDoors = this._ringDoors(this._innerRotation(), INNER_HALF_ANGLE_DEG, INNER_DOOR_COUNT, this._innerDoorStates);
    const innerGaps = innerDoors.filter((d) => d.label === 'OPEN').map((d) => ({ center: d.angle, halfWidth: d.halfAngle }));
    return this._touchingAnnulusFace(x, y, radius, INNER_R_OUTER_FRAC * size, INNER_R_INNER_FRAC * size, innerGaps);
  }

  _touchingAnnulusFace(x, y, radius, rOuter, rInner, gaps) {
    const dx = x - this.x, dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dx, -dy);
    if (gaps.some((g) => Math.abs(normalizeAngleDelta(angle - g.center)) < g.halfWidth)) return false; // standing in an open doorway, not touching material
    const outerFaceDist = rOuter + radius; // held here when outside, pressed against this ring's outer face
    const innerFaceDist = rInner - radius; // held here when inside, pressed against this ring's inner face
    return Math.abs(dist - outerFaceDist) < RING_CONTACT_EPS || Math.abs(dist - innerFaceDist) < RING_CONTACT_EPS;
  }

  // ==================== physical constraint (solid) ====================

  // Resolves (x, y) against every solid part of the station — both rings'
  // hulls+doors and all 6 spokes' caps — and returns the corrected
  // position. A ring door counts as passable ONLY while its FSM state is
  // strictly OPEN (rules 1 and 3 — no fuzzy "open enough" threshold, and
  // CLOSING is immediately impassable again); spokes' own door gaps are
  // NEVER solid (see this file's header note — the electric arc is a
  // hazard, not a wall), only their caps are.
  //
  // Which side of each ring the player is on lives on THIS instance
  // (this._playerOuterIsOutside / _playerInnerIsOutside), not passed in —
  // see the constructor's own comment for why a caller-supplied previous
  // POSITION doesn't work once the ring itself is moving.
  // Wraps resolveCircleAgainstAnnulus with the MAX_GAP_DWELL cap: if the
  // player has sat continuously in this ring's open gap (per `inGap`) for
  // longer than that, stop waiting for a genuine crossing and hold them on
  // whichever side they're still classified as, ignoring the technically-
  // still-open gap — same math the normal "solid, hold at boundary" path
  // uses, just triggered by dwell time instead of a closed door. `hintKey`/
  // `dwellKey` name this instance's own state fields for whichever ring is
  // being resolved (outer or inner), so this one method serves both.
  _resolveRing(px, py, r, rOuter, rInner, gaps, hintKey, dwellKey) {
    const result = resolveCircleAgainstAnnulus(px, py, r, this.x, this.y, rOuter, rInner, gaps, this[hintKey]);
    if (!result.inGap) {
      this[dwellKey] = null;
      this[hintKey] = result.isOutside;
      return result;
    }
    if (this[dwellKey] === null) this[dwellKey] = this.age;
    if (this.age - this[dwellKey] <= MAX_GAP_DWELL) {
      this[hintKey] = result.isOutside;
      return result;
    }
    const wasOutside = result.isOutside;
    const outerTarget = rOuter + r, innerTarget = rInner - r;
    const dx = px - this.x, dy = py - this.y;
    const angle = Math.atan2(dx, -dy);
    const newDist = wasOutside ? outerTarget : innerTarget;
    this[dwellKey] = null;
    this[hintKey] = wasOutside;
    return {
      x: this.x + Math.sin(angle) * newDist,
      y: this.y - Math.cos(angle) * newDist,
      isOutside: wasOutside,
      inGap: false,
    };
  }

  resolveSolid(x, y, radius) {
    const size = this.canvasWidth;
    const shapes = [];

    const outerDoors = this._ringDoors(this._outerRotation(), OUTER_HALF_ANGLE_DEG, OUTER_DOOR_COUNT, this._outerDoorStates);
    const outerGaps = outerDoors.filter((d) => d.label === 'OPEN').map((d) => ({ center: d.angle, halfWidth: d.halfAngle }));
    shapes.push({
      resolve: (px, py, r) => this._resolveRing(
        px, py, r, OUTER_R_OUTER_FRAC * size, OUTER_R_INNER_FRAC * size, outerGaps, '_playerOuterIsOutside', '_outerGapDwellStart',
      ),
    });

    const innerDoors = this._ringDoors(this._innerRotation(), INNER_HALF_ANGLE_DEG, INNER_DOOR_COUNT, this._innerDoorStates);
    const innerGaps = innerDoors.filter((d) => d.label === 'OPEN').map((d) => ({ center: d.angle, halfWidth: d.halfAngle }));
    shapes.push({
      resolve: (px, py, r) => this._resolveRing(
        px, py, r, INNER_R_OUTER_FRAC * size, INNER_R_INNER_FRAC * size, innerGaps, '_playerInnerIsOutside', '_innerGapDwellStart',
      ),
    });

    const hw = SPOKE_HALFWIDTH_FRAC * size;
    const outerR = OUTER_R_INNER_FRAC * size, innerR = INNER_R_OUTER_FRAC * size;
    const doorCenterR = (outerR + innerR) / 2;
    const halfLen = (SPOKE_DOOR_LEN_FRAC * size) / 2;
    // Two caps per spoke — one collar attaching to each ring, on either
    // side of the door zone. Worked out directly in radius terms (not
    // local -y) to avoid the sign mix-up that shipped here on the first
    // pass: the door's OUTER boundary (closer to the outer ring) is
    // doorCenterR + halfLen, not - halfLen — verified numerically against
    // _drawSpokes()'s own cap spans before trusting this.
    const doorOuterBoundR = doorCenterR + halfLen;
    const doorInnerBoundR = doorCenterR - halfLen;
    const outerCapCenterR = (outerR + doorOuterBoundR) / 2;
    const outerCapHalfH = (outerR - doorOuterBoundR) / 2;
    const innerCapCenterR = (innerR + doorInnerBoundR) / 2;
    const innerCapHalfH = (doorInnerBoundR - innerR) / 2;

    for (let i = 0; i < SPOKE_COUNT; i++) {
      const angle = degToRad((360 / SPOKE_COUNT) * i);
      const outerCapCenter = polar(this.x, this.y, outerCapCenterR, angle);
      const innerCapCenter = polar(this.x, this.y, innerCapCenterR, angle);
      shapes.push({
        resolve: (px, py, r) => resolveCircleAgainstRect(px, py, r, outerCapCenter.x, outerCapCenter.y, angle, hw, outerCapHalfH),
      });
      shapes.push({
        resolve: (px, py, r) => resolveCircleAgainstRect(px, py, r, innerCapCenter.x, innerCapCenter.y, angle, hw, innerCapHalfH),
      });
    }

    return resolveCircleAgainstShapes(x, y, radius, shapes);
  }

  // ==================== lethal (electric arc) ====================

  hitsLethal(x, y, radius) {
    const size = this.canvasWidth;
    const outerR = OUTER_R_INNER_FRAC * size, innerR = INNER_R_OUTER_FRAC * size;
    const doorCenterR = (outerR + innerR) / 2;
    const halfLen = (SPOKE_DOOR_LEN_FRAC * size) / 2;
    const hitHalfThickness = Math.max(2, SPOKE_HALFWIDTH_FRAC * size * 1.3);

    for (const spoke of this._spokeDoors()) {
      // Safe only while truly OPEN — same rule as the ring doors (rules 1
      // and 3): SEALED, OPENING, and CLOSING are all lethal, not just a
      // late-fade deadzone near the end of the visual arc's alpha fade.
      if (spoke.label === 'OPEN') continue;
      const topR = doorCenterR - halfLen * 0.99, botR = doorCenterR + halfLen * 0.99;
      const top = polar(this.x, this.y, topR, spoke.angle);
      const bot = polar(this.x, this.y, botR, spoke.angle);
      if (pointSegmentDistance(x, y, top.x, top.y, bot.x, bot.y) < radius + hitHalfThickness) return true;
    }
    return false;
  }

  // ==================== drawing ====================

  draw(ctx) {
    const size = this.canvasWidth;
    this._drawRing(ctx, OUTER_R_OUTER_FRAC * size, OUTER_R_INNER_FRAC * size, this._outerRotation(), OUTER_HALF_ANGLE_DEG, OUTER_DOOR_COUNT, this.outerRivets, this._outerDoorStates);
    this._drawRing(ctx, INNER_R_OUTER_FRAC * size, INNER_R_INNER_FRAC * size, this._innerRotation(), INNER_HALF_ANGLE_DEG, INNER_DOOR_COUNT, this.innerRivets, this._innerDoorStates);
    this._drawSpokes(ctx);
  }

  _annulusSectorPath(ctx, rOuter, rInner, a0, a1) {
    const s0 = a0 - Math.PI / 2, s1 = a1 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rOuter, s0, s1, false);
    ctx.arc(this.x, this.y, rInner, s1, s0, true);
    ctx.closePath();
  }

  _drawHullSegment(ctx, rOuter, rInner, a0, a1, rivets) {
    this._annulusSectorPath(ctx, rOuter, rInner, a0, a1);
    const grad = ctx.createRadialGradient(this.x, this.y, rInner, this.x, this.y, rOuter);
    grad.addColorStop(0, '#2c313b');
    grad.addColorStop(1, '#4c5563');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    ctx.save();
    ctx.clip();
    rivets.forEach((rv) => {
      const angle = a0 + rv.af * (a1 - a0);
      const r = lerp(rInner, rOuter, rv.rf);
      const p = polar(this.x, this.y, r, angle);
      const rad = Math.max(1.1, rOuter * 0.012);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, TAU);
      ctx.fillStyle = '#171a20';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x - rad * 0.3, p.y - rad * 0.3, rad * 0.4, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    });
    ctx.restore();
  }

  _drawBeacon(ctx, rOuter, rInner, a0, a1, idx) {
    const mid = a0 + (a1 - a0) / 2;
    const r = (rOuter + rInner) / 2;
    const p = polar(this.x, this.y, r, mid);
    const breathe = 0.55 + 0.45 * Math.sin(this.age * 1.4 + idx * 2.1);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(mid);
    ctx.fillStyle = '#20242c';
    const hw = rOuter * 0.036, hh = rOuter * 0.026;
    ctx.fillRect(-hw / 2, -hh / 2, hw, hh);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-hw / 2, -hh / 2, hw, hh);
    ctx.restore();

    glow(ctx, 'rgba(255,255,255,1)', 8 + breathe * 16, () => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.8, rOuter * 0.017) * (0.7 + breathe * 0.5), 0, TAU);
      ctx.fillStyle = `rgba(255,255,255,${(0.7 + breathe * 0.3).toFixed(2)})`;
      ctx.fill();
    });
  }

  _drawDoorLeaves(ctx, rOuter, rInner, doorAngle, halfAngle, openness) {
    const leftSpan = [doorAngle - halfAngle, doorAngle - openness * halfAngle];
    const rightSpan = [doorAngle + openness * halfAngle, doorAngle + halfAngle];
    [leftSpan, rightSpan].forEach((span, li) => {
      if (Math.abs(span[1] - span[0]) < 0.01) return;
      this._annulusSectorPath(ctx, rOuter, rInner, span[0], span[1]);
      const grad = ctx.createRadialGradient(this.x, this.y, rInner, this.x, this.y, rOuter);
      grad.addColorStop(0, '#3a414d');
      grad.addColorStop(1, '#5b6474');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();

      const edgeAngle = li === 0 ? span[1] : span[0];
      ctx.save();
      this._annulusSectorPath(ctx, rOuter, rInner, span[0], span[1]);
      ctx.clip();
      const stripeCount = 6;
      for (let s = 0; s < stripeCount; s++) {
        const t0 = s / stripeCount, t1 = (s + 0.5) / stripeCount;
        const sa = lerp(rInner, rOuter, t0), sb = lerp(rInner, rOuter, t1);
        const pA = polar(this.x, this.y, sa, edgeAngle), pB = polar(this.x, this.y, sb, edgeAngle);
        ctx.strokeStyle = s % 2 === 0 ? '#e2a83f' : '#14161c';
        ctx.lineWidth = Math.max(1.6, rOuter * 0.03);
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      }
      ctx.restore();
    });

    const lightP = polar(this.x, this.y, rOuter * 0.985, doorAngle);
    const lightColor = openness > 0.5 ? '#57cf7d' : '#ef5350';
    glow(ctx, lightColor, 8, () => {
      ctx.beginPath();
      ctx.arc(lightP.x, lightP.y, Math.max(1.8, rOuter * 0.02), 0, TAU);
      ctx.fillStyle = lightColor;
      ctx.fill();
    });
  }

  _drawRing(ctx, rOuter, rInner, rotation, halfAngleDeg, doorCount, rivets, doorStates) {
    const halfAngle = degToRad(halfAngleDeg);
    const segAngle = degToRad(360 / doorCount);
    for (let i = 0; i < doorCount; i++) {
      const doorAngle = degToRad(i * (360 / doorCount)) + rotation;
      const segStart = doorAngle + halfAngle, segEnd = doorAngle + segAngle - halfAngle;
      this._drawHullSegment(ctx, rOuter, rInner, segStart, segEnd, rivets[i]);
      this._drawBeacon(ctx, rOuter, rInner, segStart, segEnd, i);
    }
    for (let i = 0; i < doorCount; i++) {
      const doorAngle = degToRad(i * (360 / doorCount)) + rotation;
      // Uses this door's OWN FSM state (advanced in update(), gated on
      // occupancy only during OPEN — see the FSM header comment), not the
      // shared this.age, so what's drawn always matches what
      // resolveSolid()/hitsLethal() are actually acting on.
      const st = effectiveDoorState(doorStates[i]);
      this._drawDoorLeaves(ctx, rOuter, rInner, doorAngle, halfAngle, opennessForPhase(st.phase, st.phaseElapsed));
    }
  }

  _drawCapRect(ctx, x0, x1, y0, y1) {
    const yTop = Math.min(y0, y1), yBot = Math.max(y0, y1);
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, '#3a414d');
    grad.addColorStop(1, '#242830');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
    if (yBot - yTop > 4) {
      ctx.fillStyle = '#14161c';
      ctx.beginPath();
      ctx.arc(0, yTop + (yBot - yTop) * 0.5, Math.max(1, (x1 - x0) * 0.16), 0, TAU);
      ctx.fill();
    }
  }

  _drawSquiggleDoor(ctx, hw, doorCenterY, halfLen, openness) {
    const orbR = Math.max(1.6, hw * 0.55);
    const topY = doorCenterY - halfLen * 0.99, botY = doorCenterY + halfLen * 0.99;

    const drawOrb = (y) => {
      const grad = ctx.createRadialGradient(0, y, orbR * 0.15, 0, y, orbR);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#8fecff');
      grad.addColorStop(1, '#1e6b8a');
      glow(ctx, 'rgba(140,230,255,0.9)', 7, () => {
        ctx.beginPath();
        ctx.arc(0, y, orbR, 0, TAU);
        ctx.fillStyle = grad;
        ctx.fill();
      });
    };
    drawOrb(topY);
    drawOrb(botY);

    const arcAlpha = clamp01(1 - openness * 1.15);
    if (arcAlpha > 0.04) {
      const segs = 6;
      const t = this.age;
      glow(ctx, `rgba(190,245,255,${arcAlpha.toFixed(2)})`, 9, () => {
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
          const yy = lerp(topY, botY, s / segs);
          const jitter = s === 0 || s === segs ? 0 :
            Math.sin(t * 26 + s * 6.1 + doorCenterY) * hw * 1.1 + Math.sin(t * 43 + s * 2.7) * hw * 0.5;
          if (s === 0) ctx.moveTo(0, yy); else ctx.lineTo(jitter, yy);
        }
        ctx.strokeStyle = `rgba(215,250,255,${arcAlpha.toFixed(2)})`;
        ctx.lineWidth = Math.max(1.1, this.canvasWidth * 0.0045);
        ctx.stroke();
      });
    }
  }

  _drawSpokes(ctx) {
    const size = this.canvasWidth;
    const hw = SPOKE_HALFWIDTH_FRAC * size;
    const outerR = OUTER_R_INNER_FRAC * size, innerR = INNER_R_OUTER_FRAC * size;
    const doorCenterR = (outerR + innerR) / 2;
    const halfLen = (SPOKE_DOOR_LEN_FRAC * size) / 2;

    for (let i = 0; i < SPOKE_COUNT; i++) {
      const angle = degToRad((360 / SPOKE_COUNT) * i);
      const yOuterEnd = -outerR, yInnerEnd = -innerR, yDoorCenter = -doorCenterR;

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      this._drawCapRect(ctx, -hw, hw, yOuterEnd, yDoorCenter - halfLen);
      this._drawCapRect(ctx, -hw, hw, yDoorCenter + halfLen, yInnerEnd);
      // This spoke door's OWN FSM state (see the door-timing header comment).
      const st = effectiveDoorState(this._spokeDoorStates[i]);
      this._drawSquiggleDoor(ctx, hw, yDoorCenter, halfLen, opennessForPhase(st.phase, st.phaseElapsed));
      ctx.restore();
    }
  }
}
