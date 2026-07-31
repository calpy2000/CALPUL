// ==========================================
// MODULE: THE ZAPPER OBSTACLE CLASS
// ==========================================
//
// An Organic Bio-Node (picked across several rounds of visual exploration —
// see the design chat this came out of) that enters from the top of the
// canvas pinned against a wall, drifts straight down at the starfield's own
// scroll speed, and periodically fires a branching shock out across the
// canvas while it descends. index.js now spawns several of these over time
// on BOTH the left and right walls (up to a per-side cap) rather than just
// one on one side — see this file's own history for the original "single
// instance, left wall only" version. Every instance's own geometry (body,
// beam, branches) is built in coordinates LOCAL to its own wall — 0 = flush
// against that wall, +x = growing away from it — and only converted to real
// canvas coordinates via `_toScreenX()` at the last moment, so a
// right-pinned instance is a genuine mirror image of a left-pinned one
// rather than a separately-authored shape. Size stays fixed per-instance
// (no variation like Asteroid gets), but each SHOT's own firing frequency,
// angle, speed, and reach all re-roll independently — see _shotParams().

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpPoint(a, b, frac) {
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// Rotates point `p` by `angleRad` around `origin` — used to tilt a whole
// beam (built dead-horizontal by buildZigzagPoints) by its shot's own
// rolled angle, without buildZigzagPoints itself needing to know about
// angles at all.
function rotatePoint(p, origin, angleRad) {
  const dx = p.x - origin.x, dy = p.y - origin.y;
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

// Shortest distance from point (px,py) to the line SEGMENT from (ax,ay) to
// (bx,by) — used for beam-vs-player collision, since the beam is a jagged
// polyline rather than a single circle like every other object in this
// game. Standard "clamp the projection onto the segment" technique.
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

const REACH = 26; // px the node's body extends out from its own wall before its bulb — the "flush to wall" distance picked earlier
const VERTICAL_SPEED = 38; // px/sec — matches the starfield's own "near" layer speed (see Starfield.js), the fastest/most foreground one
const TOP_MARGIN = 60; // spawns this far above y=0 so it's fully off-screen (not popping in half-formed) before entering

const SEGMENTS = 32;
const SEGMENT_VARIATION = 0.2; // +/-20%
const AMPLITUDE = 16;
const BRANCH_INDICES = [4, 8, 12, 16, 19, 23, 26, 29];
const BRANCH_BASE_LEN = 19;
const BRANCH_VARIATION = 0.4; // +/-40%

// How far a shot reaches, how fast it gets there, and which way it tilts —
// all re-rolled independently PER SHOT (see _shotParams() below), so grow/
// retract duration is now a DERIVED value (reach / speed) rather than the
// fixed 1-second constant this used to be.
const BASE_BEAM_SPEED = 270; // px/sec, the growth/retract rate before the +/-20% roll — chosen so an average-length shot still takes ~1s, matching the original fixed-duration feel
const BEAM_SPEED_VARIATION = 0.2; // +/-20%
const BEAM_ANGLE_VARIATION_DEG = 20; // +/-20 degrees off dead-horizontal, picked per shot
// Reach range: the shortest possible shot still crosses a third of the way
// across the canvas; the longest stops shy of where an opposing wall's own
// zapper's bulb sits, so a beam can never physically reach far enough to zap
// another zapper — its body's own hit-radius is REACH*0.6 (+/- ~30, see
// hitsCircle() below), and OPPOSITE_WALL_CLEARANCE is comfortably bigger.
const OPPOSITE_WALL_CLEARANCE = 50;
const MIN_REACH_FRACTION = 1 / 3; // shortest shot still reaches this far across the canvas, measured from its own wall

// Quick "Electric Fork" spark at the beam's fully-extended tip — three short
// jagged mini-forks plus a bright flash, straddling the exact grow->retract
// seam (half before, half after) so it reads as firing right as the beam
// finishes extending and just before it starts pulling back. Picked from a
// mockup gallery of 4 options over Spark Burst/Plasma Pop/Shatter Fragments.
// Overlaid on top of the existing grow/retract timeline rather than adding
// to it, so it doesn't touch ZAP_FREQUENCY_BASE or the cycle-length clamp.
const BURST_DURATION = 0.25;
// "Zap frequency" — how often a new shot STARTS, grow+retract+pause all
// included, re-rolled independently every cycle (same +/-N% re-rolled-per-
// cycle pattern used everywhere else in this game, e.g. the asteroid/shard
// spawn intervals in index.js). Clamped (per-shot, since grow/retract
// duration now varies per shot too) to never go below that shot's own
// grow+retract time — a roll under that just means zero pause (back-to-back
// firing) rather than compressing the grow/retract animation itself to fit.
const ZAP_FREQUENCY_BASE = 4.0;
const ZAP_FREQUENCY_VARIATION = 0.5; // +/-50%
const BEAM_HIT_HALF_THICKNESS = 5; // collision half-thickness around the drawn beam line — thicker than the visible stroke so a near-miss at the glow's edge still feels fair

function rollCycleDuration(growDuration) {
  const freq = ZAP_FREQUENCY_BASE * (1 + (Math.random() * 2 - 1) * ZAP_FREQUENCY_VARIATION);
  return Math.max(growDuration * 2, freq); // grow and retract each take growDuration, same rate both ways
}

function buildZigzagPoints(startX, y, length, seed) {
  const rand = mulberry32(seed);
  const baseSegLen = length / SEGMENTS;
  const pts = [{ x: startX, y }];
  let cx = startX;
  for (let i = 1; i <= SEGMENTS; i++) {
    const segLen = baseSegLen * (1 + (rand() * 2 - 1) * SEGMENT_VARIATION);
    cx += segLen;
    pts.push({ x: cx, y: y + (rand() - 0.5) * AMPLITUDE * 2 });
  }
  return pts;
}

export default class Zapper {
  constructor(canvasWidth, canvasHeight, seed, side = 'left') {
    this.side = side; // 'left' or 'right' — which wall this instance is pinned to; drives _toScreenX() below
    this.x = side === 'left' ? 0 : canvasWidth; // pinned to its wall for its whole lifetime — only y moves
    this.y = -TOP_MARGIN;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.age = 0; // drives only the Bio-Node's own idle pulse now — the firing cycle uses its own independent clock, see below
    this.seedBase = seed;
    this.shotNumber = 0; // increments every new cycle, folded into that shot's own path seed so no two shots look identical
    this.cycleElapsed = 0; // how far into the CURRENT cycle this instance is
    this.cycleDuration = rollCycleDuration(this._shotParams(0).growDuration); // this cycle's own total length — re-rolled every time a cycle finishes, see update()
  }

  // Converts an x measured LOCALLY (0 = flush against this instance's own
  // wall, growing away from it) into a real canvas x. Left-pinned instances
  // are already in canvas coordinates; right-pinned instances get mirrored
  // around the right wall. Used for every beam/branch point and the body's
  // collision center so a right-side instance is a true mirror of a left
  // one rather than separately-coded geometry.
  _toScreenX(localX) {
    return this.side === 'left' ? localX : this.canvasWidth - localX;
  }

  // Every shot's own reach/speed/angle, derived deterministically from a
  // seed keyed on (this instance, this shot number) — recomputed on demand
  // rather than stored, same "pure function of shotNumber" pattern the rest
  // of this file already uses (see buildZigzagPoints's own seed). Called
  // both from update() (to know how long THIS shot needs before rolling the
  // next cycleDuration) and _currentShot() (to build its geometry) — always
  // returns the same values for a given shotNumber, so calling it twice is
  // just re-deriving, not re-rolling.
  _shotParams(shotNumber) {
    const rand = mulberry32(3000 + this.seedBase + shotNumber * 7919);
    const angleRad = ((rand() * 2 - 1) * BEAM_ANGLE_VARIATION_DEG * Math.PI) / 180;
    const speed = BASE_BEAM_SPEED * (1 + (rand() * 2 - 1) * BEAM_SPEED_VARIATION);
    const tipXLocal = REACH + 14;
    const minLen = this.canvasWidth * MIN_REACH_FRACTION - tipXLocal; // far end reaches at least a third of the way across the canvas
    const maxLen = this.canvasWidth - OPPOSITE_WALL_CLEARANCE - tipXLocal; // stops shy of the opposite wall's own zapper bulb
    const beamLength = minLen + rand() * (maxLen - minLen);
    const growDuration = beamLength / speed;
    return { angleRad, speed, beamLength, growDuration, tipXLocal };
  }

  update(dt) {
    this.y += VERTICAL_SPEED * dt;
    this.age += dt;

    this.cycleElapsed += dt;
    if (this.cycleElapsed >= this.cycleDuration) {
      this.cycleElapsed -= this.cycleDuration; // carries any overshoot into the new cycle instead of losing/gaining a frame's worth of time
      this.shotNumber += 1;
      this.cycleDuration = rollCycleDuration(this._shotParams(this.shotNumber).growDuration);
    }
  }

  isOffScreen() {
    return this.y - TOP_MARGIN > this.canvasHeight;
  }

  // Computes this frame's visible shot — null while in the pause window
  // (nothing to draw or collide with), otherwise this shot's own fixed
  // reach/angle/speed path plus how much of it (and which branches) are
  // currently showing. Recomputed fresh every call rather than cached,
  // since it depends on `this.y` (which changes every frame as the node
  // drifts down).
  _currentShot() {
    const cycleT = this.cycleElapsed;
    const { angleRad, beamLength, growDuration, tipXLocal } = this._shotParams(this.shotNumber);
    const retractDuration = growDuration; // same rate back, per earlier confirmation
    if (cycleT >= growDuration + retractDuration) return null; // in this cycle's pause window (only possible when cycleDuration > grow+retract)

    const progress = cycleT < growDuration
      ? cycleT / growDuration
      : 1 - (cycleT - growDuration) / retractDuration;

    // Everything below is built in LOCAL coordinates (0 = flush against this
    // instance's own wall, +x = growing away from it, exactly as if it were
    // left-pinned and dead-horizontal) — the geometry/angle math is
    // identical for both sides. buildZigzagPoints stays horizontal; the
    // whole path is then tilted by this shot's own angleRad around its
    // origin (the wall-attachment point). Only the final mainPts/branches
    // conversion below maps into real canvas coordinates via _toScreenX(),
    // mirroring right-pinned instances.
    const seed = this.seedBase + this.shotNumber * 7919;
    const origin = { x: tipXLocal, y: this.y };
    const fullPtsLocal = buildZigzagPoints(tipXLocal, this.y, beamLength, seed)
      .map((p) => rotatePoint(p, origin, angleRad));

    const visibleFloat = progress * SEGMENTS;
    const wholeCount = Math.min(SEGMENTS, Math.floor(visibleFloat));
    const frac = visibleFloat - wholeCount;
    const mainPtsLocal = fullPtsLocal.slice(0, wholeCount + 1);
    if (wholeCount < SEGMENTS) {
      mainPtsLocal.push(lerpPoint(fullPtsLocal[wholeCount], fullPtsLocal[wholeCount + 1], frac));
    }

    const branchRand = mulberry32(1200 + seed);
    const branchesLocal = [];
    BRANCH_INDICES.forEach((idx, bi) => {
      if (idx > wholeCount || idx >= fullPtsLocal.length) return;
      const branchOrigin = fullPtsLocal[idx];
      const branchLen = BRANCH_BASE_LEN * (1 + (branchRand() * 2 - 1) * BRANCH_VARIATION);
      const angle = angleRad + (branchRand() - 0.5) * 1.0 + (bi % 2 === 0 ? -1.0 : 1.0);
      branchesLocal.push({
        x1: branchOrigin.x, y1: branchOrigin.y,
        x2: branchOrigin.x + Math.cos(angle) * branchLen, y2: branchOrigin.y + Math.sin(angle) * branchLen,
      });
    });

    const mainPts = mainPtsLocal.map((p) => ({ x: this._toScreenX(p.x), y: p.y }));
    const branches = branchesLocal.map((b) => ({
      x1: this._toScreenX(b.x1), y1: b.y1,
      x2: this._toScreenX(b.x2), y2: b.y2,
    }));

    // Burst window: half of BURST_DURATION before the seam, half after —
    // null outside that window (the common case), so draw()/callers only
    // pay for it right around the seam. Fork length grows with burstProgress
    // (0 at the window's start, full by its end) while draw()'s own fade
    // (see _drawBurst) shrinks the alpha faster, giving a quick outward
    // "kick" rather than a fork that lingers at full length.
    const burstHalf = BURST_DURATION / 2;
    let burst = null;
    if (cycleT >= growDuration - burstHalf && cycleT <= growDuration + burstHalf) {
      const burstProgress = (cycleT - (growDuration - burstHalf)) / BURST_DURATION;
      const forkRand = mulberry32(2400 + seed);
      const tipLocal = fullPtsLocal[fullPtsLocal.length - 1];
      const forks = [];
      for (let i = 0; i < 3; i++) {
        const angle = angleRad + (-0.9 + i * 0.9 + (forkRand() - 0.5) * 0.3); // spreads roughly forward/up/down relative to this shot's own tilt, same convention as the branch angles above
        const len = burstProgress * (22 + forkRand() * 14);
        const jitter = 4 + forkRand() * 4;
        let cx = tipLocal.x, cy = tipLocal.y;
        const ptsLocal = [{ x: cx, y: cy }];
        for (let s = 1; s <= 3; s++) {
          cx += (Math.cos(angle) * len) / 3;
          cy += (Math.sin(angle) * len) / 3 + (s % 2 === 0 ? jitter : -jitter);
          ptsLocal.push({ x: cx, y: cy });
        }
        forks.push(ptsLocal.map((pt) => ({ x: this._toScreenX(pt.x), y: pt.y })));
      }
      burst = { progress: burstProgress, tip: { x: this._toScreenX(tipLocal.x), y: tipLocal.y }, forks };
    }

    return { mainPts, branches, burst };
  }

  // The node's own body is solid (touching it ends the round just like an
  // asteroid does), approximated as one circle over its organic shape,
  // IN ADDITION to whichever part of the beam is currently visible. Takes
  // a plain circle (x, y, radius) rather than assuming a player-shaped
  // object, so the exact same hit-test works for both the player (see
  // hitsPlayer() below) and a star shard caught in the beam (see index.js
  // — a shard "explodes" the same way it does when an asteroid hits it).
  // This body check runs unconditionally (not gated on a shot being
  // active), so bumping the node itself always ends the round — same as
  // touching the beam.
  hitsCircle(x, y, radius) {
    const bodyDist = Math.hypot(x - this._toScreenX(REACH * 0.6), y - this.y);
    if (bodyDist < radius + 30) return true;

    const shot = this._currentShot();
    if (!shot) return false;

    for (let i = 0; i < shot.mainPts.length - 1; i++) {
      const a = shot.mainPts[i], b = shot.mainPts[i + 1];
      if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) < radius + BEAM_HIT_HALF_THICKNESS) return true;
    }
    for (const br of shot.branches) {
      if (pointSegmentDistance(x, y, br.x1, br.y1, br.x2, br.y2) < radius + BEAM_HIT_HALF_THICKNESS) return true;
    }
    return false;
  }

  hitsPlayer(player) {
    return this.hitsCircle(player.x, player.y, player.radius);
  }

  draw(ctx) {
    this._drawBioNode(ctx);
    const shot = this._currentShot();
    if (!shot) return;
    this._strokePoints(ctx, shot.mainPts, '#9fe0ff', 2.5, 10, 1);
    shot.branches.forEach((br) => {
      this._strokePoints(ctx, [{ x: br.x1, y: br.y1 }, { x: br.x2, y: br.y2 }], '#9fe0ff', 1.4, 6, 0.6, 0.6);
    });
    if (shot.burst) this._drawBurst(ctx, shot.burst);
  }

  // The "Electric Fork" tip explosion — a bright flash plus three short
  // jagged sparks kicking off the fully-extended tip, both fading out over
  // the burst window (see BURST_DURATION/_currentShot() above).
  _drawBurst(ctx, burst) {
    const { progress: p, tip, forks } = burst;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flashAlpha = Math.max(0, 1 - p * 2.2);
    if (flashAlpha > 0) {
      ctx.globalAlpha = flashAlpha * 0.5;
      ctx.fillStyle = '#eaf9ff';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const forkAlpha = Math.max(0, 1 - p * 1.2);
    if (forkAlpha > 0) {
      forks.forEach((pts) => {
        this._strokePoints(ctx, pts, '#c9e8ff', 1.8, 9, 0.8, forkAlpha);
      });
    }
  }

  _strokePoints(ctx, pts, color, lineWidth, glowBlur, coreWidth, alpha) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = glowBlur;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    ctx.lineWidth = coreWidth;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
  }

  // Drawn entirely as if left-pinned (wall at local x=0, body extending
  // toward +x) — for a right-pinned instance, a translate+scale(-1,1)
  // mirrors that same drawing around the right wall instead of duplicating
  // the shape math. Simpler than threading _toScreenX() through every
  // curve/gradient coordinate in here, and exact since it's a true mirror.
  _drawBioNode(ctx) {
    const reach = REACH, y = this.y, t = this.age;
    ctx.save();
    if (this.side === 'right') {
      ctx.translate(this.canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = '#3a2f45';
    ctx.beginPath();
    ctx.moveTo(0, y - 26);
    ctx.quadraticCurveTo(reach * 0.6, y - 20, reach, y - 14);
    ctx.lineTo(reach, y + 14);
    ctx.quadraticCurveTo(reach * 0.6, y + 20, 0, y + 26);
    ctx.closePath();
    ctx.fill();

    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.beginPath();
    ctx.ellipse(reach - 6, y, 20, 15 + pulse * 2, 0, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(reach - 6, y, 2, reach - 6, y, 20);
    grad.addColorStop(0, '#e8b6ff');
    grad.addColorStop(1, '#5a2f7a');
    ctx.fillStyle = grad;
    ctx.shadowColor = `rgba(220,150,255,${0.5 + pulse * 0.4})`;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(230,180,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y - 20); ctx.quadraticCurveTo(reach * 0.4, y - 10, reach - 15, y - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y + 20); ctx.quadraticCurveTo(reach * 0.4, y + 10, reach - 15, y + 5); ctx.stroke();
    ctx.restore();
  }
}
