// ==========================================
// MODULE: THE CLUSTER OBSTACLE CLASS
// ==========================================
//
// A "cluster bomb" obstacle: a frosted-glass sphere packed with triangular
// shrapnel ("shots") that drifts in, arms itself, then bursts into a radial
// spread of independently-hazardous shots. Shape/pattern/glass/animation
// choices below (hex-packed triangles, half-count + shrink, layered-depth
// frosted glass with no border, spin, light-yellow -> deep-red arm-up, even
// radial burst) all came out of a dedicated mockup-and-approve pass before
// this file existed — nothing here is a first guess.
//
// Lifecycle is a small state machine, one phase per step of that approved
// sequence:
//   'entering'  -> flies in from off-screen, same edge/trajectory system
//                  Asteroid/StarShard/EnergyOrb all share (see index.js's
//                  pickSpawnPoint()), at 3x their base speed. Stops at a
//                  RANDOM point along that straight line chosen once at
//                  spawn — see entryStopTime — anywhere its center is at
//                  least EDGE_MARGIN_RADII sphere-radii from every canvas
//                  edge (the "inner canvas"). If the trajectory never
//                  reaches such a point, this instance is marked
//                  `abandoned` immediately and never actually appears —
//                  per the user's explicit "if the cluster cannot achieve
//                  a position inside this range it should not spawn in
//                  the first place."
//   'parked'    -> stops its own lateral motion and switches to drifting
//                  straight down at STARFIELD_SPEED (matching
//                  Starfield.js's own near-layer speed, so it visibly
//                  rides along with the backdrop rather than just
//                  asserting it does).
//   'charging'  -> holds at parked speed for PARK_HOLD, then over exactly
//                  CHARGE_DURATION seconds shifts light-yellow -> deep-red
//                  while an external glow grows from nothing, the glass's
//                  own opacity ramps the rest of the way to fully opaque,
//                  and the whole sphere (glass + shots together) grows up
//                  to 1.3x its resting size.
//   'exploding' -> glass gone; the shots that were packed inside launch
//                  outward in an even radial spread (angles spaced by
//                  2*PI/N from the sphere's own spin angle at the instant
//                  it popped, not their pre-burst positions), each
//                  spinning fast. This phase also carries the shockwave
//                  ring + core flash, both quick one-shot fades. Gated by
//                  two things: a defensive re-check that it's still
//                  within EDGE_MARGIN_RADII of every edge (see
//                  _isSafelyInsideForExplosion — the entry-stop selection
//                  above should already guarantee this, this just catches
//                  drift/growth eating into that margin), and a global
//                  minimum gap between any two clusters' explosions (see
//                  index.js's own CLUSTER_EXPLOSION_COOLDOWN).

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRIANGLE = [
  { x: 0, y: -1 },
  { x: 0.87, y: 0.6 },
  { x: -0.87, y: 0.6 },
];

// Hex-packed shot layout within a sphere of the given radius — identical
// technique to the approved mockup's hexPack(), reused verbatim.
function hexPack(R, spacing, seed) {
  const rand = mulberry32(seed);
  const pts = [];
  const rows = Math.ceil((R * 2) / (spacing * 0.87));
  for (let row = -rows; row <= rows; row++) {
    const y = row * spacing * 0.87;
    if (Math.abs(y) > R - spacing * 0.4) continue;
    const offset = (row % 2 !== 0) ? spacing / 2 : 0;
    const cols = Math.ceil((R * 2) / spacing);
    for (let col = -cols; col <= cols; col++) {
      const x = col * spacing + offset;
      if (Math.hypot(x, y) > R - spacing * 0.42) continue;
      pts.push({ x, y, rot: rand() * Math.PI * 2 });
    }
  }
  return pts;
}

// Concentric-rings shot layout — picked over the previous hex-pack, which
// wasn't actually being used symmetrically (see the constructor's own
// comment on where the size below still comes from). Ring counts
// (1 + 5 + 9 = 15) are hardcoded to the count the constructor targets
// (1.5x hexPack()'s own half/full-derived count, rounded — see its own
// comment) — if that target ever changes, this breakdown needs updating
// alongside it.
function ringPattern(R, seed) {
  const rand = mulberry32(seed);
  const pts = [];
  // Outer ring radius has to leave room for the shot's own silhouette
  // (max vertex reach ~1.06x its radius, which is R*0.3 — see
  // BASE_SHOT_RADIUS/BASE_RADIUS) inside the glass sphere's own radius R,
  // or shots poke out past the rim. 0.6 leaves a comfortable margin
  // (0.6 + ~0.32 = ~0.92R, still inside R) — unchanged from the previous,
  // smaller-count round, since it's a containment constraint on the OUTER
  // ring's radius, not on how many shots sit on it.
  const rings = [
    { r: 0, count: 1 },
    { r: R * 0.42, count: 5 },
    { r: R * 0.6, count: 9 },
  ];
  rings.forEach(({ r, count }, ringIdx) => {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 / count) * i + ringIdx * 0.35; // slight per-ring stagger so rings don't all align radially
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, rot: rand() * Math.PI * 2 });
    }
  });
  return pts;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpRgbStr(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',');
}
function lerpPalette(a, b, t) {
  const ac = hexToRgb(a.center), bc = hexToRgb(b.center);
  const am = hexToRgb(a.mid), bm = hexToRgb(b.mid);
  const ae = hexToRgb(a.edge), be = hexToRgb(b.edge);
  const ag = a.glow.split(',').map(Number), bg = b.glow.split(',').map(Number);
  return {
    center: `rgb(${lerpRgbStr(ac, bc, t)})`,
    mid: `rgb(${lerpRgbStr(am, bm, t)})`,
    edge: `rgb(${lerpRgbStr(ae, be, t)})`,
    glow: lerpRgbStr(ag, bg, t),
  };
}
function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

function rotatePoint(o, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: o.x * c - o.y * s, y: o.x * s + o.y * c };
}

// Shot color — fixed for the shot's whole lifetime, resting or in flight
// (the sphere is what shifts color, not the shrapnel inside it). Neon
// green, swapped in from the earlier Molten Red per the user's explicit
// request — reads more clearly against the sphere's own red/orange glow.
const SHOT_PAL = { center: '#eeffe9', mid: '#3dff6e', edge: '#0e8a2f', glow: '70,255,110' };
// Arming colors — deliberately wide range (near-white yellow down to
// near-black red) per the user's explicit "make the range read ever
// greater" request.
const LIGHT_YELLOW = { center: '#fffef5', mid: '#fff28a', edge: '#ffd83d', glow: '255,240,160' };
const DEEP_RED = { center: '#7a2412', mid: '#4a0d07', edge: '#200302', glow: '140,18,8' };

const BASE_RADIUS = 48; // sphere radius before the half-shot-count shrink below
const BASE_SHOT_RADIUS = BASE_RADIUS * 0.2 * 1.5; // 1.5x the original shot size, independent of the sphere's own radius
const SPHERE_SPIN_RATE = 1.3; // rad/sec — the whole packed cluster (glass + shots) tumbles as one rigid body while intact
// Entry motion — started as Asteroid.js's own BASE_SPEED/SPEED_VARIATION
// (see this file's header comment), then explicitly bumped to 3x that per
// the user's own "increase the speed of the cluster entry 3x" request.
const ENTRY_BASE_SPEED = 90 * 3;
const ENTRY_SPEED_VARIATION = 0.3;
const STARFIELD_SPEED = 38; // px/sec — matches Starfield.js's near layer, what "parked" drifts at
const PARK_HOLD = 1.0;
const CHARGE_DURATION = 1.0;
const BURST_SPEED_BASE = 260;
const BURST_SPEED_VAR = 70;
const DEBRIS_DURATION = 1.7; // how long shots keep flying (and stay collidable) after the burst before this instance is considered done
const SHOCKWAVE_DURATION = 0.4;
const FLASH_DURATION = 0.25;
// How far (in sphere radii) the CENTER must sit from every canvas edge —
// the single margin concept behind both where a cluster is allowed to
// park (see the constructor's entryStopTime derivation) and the stricter
// backstop check gating the actual explosion (_isSafelyInsideForExplosion
// below). Per the user's own explicit spec: "the centre of the circle is
// at least 1.5 radius lengths from the nearest edge."
const EDGE_MARGIN_RADII = 1.5;
// How much bigger the sphere gets by full charge — see _visualRadius().
// Named here too (not just inlined in that method) because the park-point
// selection below needs to reason about the GROWN size, not the resting
// one, to guarantee a spot that's still safe once charging finishes.
const GROWTH_FACTOR = 1.3;
// How far a cluster keeps drifting (straight down, at STARFIELD_SPEED)
// AFTER it parks, before it's actually ready to explode — the two phases
// between 'parked' and the explosion check both still tick this same
// drift. Per the user's explicit "only allow clusters to enter the canvas
// if they will be in a position to explode": the park-point selection
// below has to budget for this drift (which only ever moves it DOWN,
// closer to the bottom edge) or a cluster that parks safely can still end
// up too close to the bottom by the time it's actually charged.
const POST_PARK_DRIFT = STARFIELD_SPEED * (PARK_HOLD + CHARGE_DURATION);
// Safety buffer added on top of the margin above. The window math is exact
// for continuous time, but the game steps in discrete frames (dt clamped
// to at most 0.05s — see index.js's animate()), so a cluster travelling at
// its max possible entry speed can overshoot the exact stop point it was
// aiming for by up to (max speed * max dt) before the 'entering' ->
// 'parked' check even runs. Padding the margin by that worst case means
// even an unlucky overshoot right at the edge of the valid window still
// lands somewhere genuinely safe.
const OVERSHOOT_BUFFER = ENTRY_BASE_SPEED * (1 + ENTRY_SPEED_VARIATION) * 0.05;

// Returns the [tMin, tMax] window (t >= 0) during which p0 + v*t stays
// within [lo, hi], or null if that never happens. Used per-axis (x and y)
// to find where a cluster's straight-line entry trajectory passes through
// the "inner canvas" — see the constructor.
function axisValidRange(p0, v, lo, hi) {
  if (Math.abs(v) < 1e-6) {
    return (p0 >= lo && p0 <= hi) ? [0, Infinity] : null;
  }
  const tA = (lo - p0) / v;
  const tB = (hi - p0) / v;
  const tMin = Math.max(0, Math.min(tA, tB));
  const tMax = Math.max(tA, tB);
  if (tMax < 0) return null;
  return [tMin, tMax];
}

function drawShot(ctx, x, y, size, rot, pal, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  TRIANGLE.forEach((p, i) => {
    const px = p.x * size, py = p.y * size;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, -size * 0.3, size * 0.1, 0, 0, size);
  grad.addColorStop(0, pal.center);
  grad.addColorStop(0.5, pal.mid);
  grad.addColorStop(1, pal.edge);
  ctx.fillStyle = grad;
  ctx.shadowColor = `rgba(${pal.glow},0.8)`;
  ctx.shadowBlur = size * 1.6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// Frosted haze — same seeded soft-blotch technique the asteroid surface
// uses for its own mottling; here it's what reads as "diffusing" rather
// than clear glass. `glow` (0..1, the charge progress) lerps each blob's
// alpha the rest of the way to fully opaque — part of the "opacity ramps
// to zero transparency by the time it's fully charged" pass.
function drawFrostHaze(ctx, cx, cy, R, seed, glow) {
  const rand = mulberry32(seed);
  for (let i = 0; i < 12; i++) {
    const bx = cx + (rand() - 0.5) * R * 1.7;
    const by = cy + (rand() - 0.5) * R * 1.7;
    const br = R * (0.16 + rand() * 0.22);
    const resting = 0.3 + rand() * 0.19;
    const alpha = resting + (1 - resting) * glow;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    bg.addColorStop(0, `rgba(255,245,235,${alpha})`);
    bg.addColorStop(1, 'rgba(255,245,235,0)');
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill();
  }
}

// Approved treatment: "layered depth shells", no border, recolored live
// between LIGHT_YELLOW and DEEP_RED, with an external halo that grows from
// nothing as `glow` goes 0 -> 1 and every opacity (shells/rim/frost) lerps
// the rest of the way to fully opaque over that same span — "no
// transparency" by full charge, per the user's explicit request. `R` is
// expected to already be the caller's grown radius (see Cluster's own
// _visualRadius()) — this function doesn't grow anything itself. `spin`
// rotates the internal shell offsets/frost/specular as one rigid pattern —
// the clip circle itself doesn't need to rotate (it's a circle either
// way), but everything asymmetric inside it does, which is what actually
// sells "this thing is spinning".
function drawSphereGlass(ctx, cx, cy, R, pal, glow, seed, spin) {
  if (glow > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const haloR = R * (1.25 + glow * 1.1);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, haloR);
    halo.addColorStop(0, `rgba(${pal.glow},${0.4 * glow})`);
    halo.addColorStop(1, `rgba(${pal.glow},0)`);
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(spin);

  const shells = [1, 0.78, 0.58, 0.4];
  shells.forEach((f, i) => {
    const rr = R * f;
    const depth = shells.length - 1 - i;
    const sx = -depth * R * 0.045, sy = -depth * R * 0.05;
    const alphaBase = 0.3 + i * 0.15; // resting-state opacity — the "+25%" pass baseline
    const restingAlpha = Math.min(1, alphaBase * 3.2);
    // Ramps the rest of the way to fully opaque as the charge completes —
    // "no transparency" by the time it's fully charged, per the user's
    // explicit request.
    const shellAlpha = restingAlpha + (1 - restingAlpha) * glow;
    const g = ctx.createRadialGradient(sx - rr * 0.3, sy - rr * 0.35, rr * 0.05, sx, sy, rr);
    g.addColorStop(0, `${pal.center}`);
    g.addColorStop(1, `rgba(${pal.glow},${alphaBase * 0.6})`);
    ctx.globalAlpha = shellAlpha; // pal.center has no alpha channel of its own, so alpha is applied here instead
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.globalAlpha = 1;
  });
  const rim = ctx.createRadialGradient(0, 0, R * 0.85, 0, 0, R);
  const restingRimAlpha = 0.75;
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, `rgba(${pal.glow},${restingRimAlpha + (1 - restingRimAlpha) * glow})`); // same lerp-to-fully-opaque treatment
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = rim; ctx.fill();

  drawFrostHaze(ctx, 0, 0, R, seed, glow);

  const spec = ctx.createRadialGradient(-R * 0.32, -R * 0.36, 0, -R * 0.32, -R * 0.36, R * 0.7);
  spec.addColorStop(0, 'rgba(255,255,255,0.42)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = spec; ctx.fill();
  ctx.restore();
}

// Simple incrementing seed source, same pattern Asteroid.js uses — every
// cluster's shot layout is independently and reproducibly varied without
// needing a full PRNG stashed before its own size is even known.
let nextSeed = 1;

export default class Cluster {
  // `edge`/`coord`/`angleRangeDeg` come from index.js's shared
  // pickSpawnPoint() helper — exactly what Asteroid/StarShard/EnergyOrb
  // all take. `canvasWidth`/`canvasHeight` are needed for off-screen
  // placement and for working out where along the entry trajectory it's
  // allowed to stop (see entryStopTime below).
  constructor(edge, coord, angleRangeDeg, canvasWidth, canvasHeight) {
    const seed = nextSeed++;
    const rand = mulberry32(seed * 7919 + 13);
    this.seed = seed;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    const speed = ENTRY_BASE_SPEED * (1 + (rand() * 2 - 1) * ENTRY_SPEED_VARIATION);
    const [minDeg, maxDeg] = angleRangeDeg;
    const theta = ((minDeg + rand() * (maxDeg - minDeg)) * Math.PI) / 180;
    this.vx = Math.sin(theta) * speed;
    this.vy = Math.cos(theta) * speed;

    // Sphere SIZE still comes from the original "half the shots of a full
    // hex-pack, sphere shrunk to match" derivation (area scaled to the
    // half-count so packing density/spacing stays the same as a full-size
    // cluster would use) — that's just a shrink ratio now though; actual
    // shot POSITIONS/COUNT come from ringPattern() below instead of
    // hexPack's own points, per the "concentric rings" approved
    // arrangement round (hexPack's points, decimated every-other, weren't
    // actually symmetric). ringPattern()'s own 15-shot breakdown is
    // 1.5x this halfCount (10), rounded to the nearest integer, per the
    // user's explicit "increase the number of shots by 1.5x" request —
    // hardcoded there rather than computed here since halfCount is always
    // exactly 10 at the current BASE_RADIUS/spacing (see its own comment).
    const full = hexPack(BASE_RADIUS, BASE_RADIUS * 0.34, seed);
    const halfCount = full.filter((_, i) => i % 2 === 0).length;
    this.R = BASE_RADIUS * Math.sqrt(halfCount / full.length);
    const scale = this.R / BASE_RADIUS;
    this.offsets = ringPattern(this.R, seed);
    this.shotR = BASE_SHOT_RADIUS * scale;

    if (edge === 'top') {
      this.x = coord;
      this.y = -this.R;
    } else if (edge === 'left') {
      this.x = -this.R;
      this.y = coord;
    } else {
      this.x = canvasWidth + this.R;
      this.y = coord;
    }

    // Where it stops: per the user's explicit spec, travel the straight
    // entry trajectory until the CENTER is at least EDGE_MARGIN_RADII
    // sphere-radii from every edge (the "inner canvas"), then keep going
    // at most until it would be about to leave that inner zone again on
    // the far side — landing anywhere in between is fine, and WHERE in
    // that window is picked at random so a field of clusters spreads out
    // rather than every one parking at the exact same relative spot.
    // x(t) is monotonic and y(t) strictly increasing for every possible
    // trajectory this game generates (see pickSpawnPoint()'s angle
    // ranges), so each axis has at most one contiguous valid-t window —
    // axisValidRange() finds it, and the two intersect into the window
    // for the actual straight-line path.
    //
    // Critically, this has to solve for where it'll be AT EXPLOSION TIME,
    // not where it parks — per the user's explicit "only allow clusters to
    // enter the canvas if they will be in a position to explode." Two
    // things move between parking and exploding: the sphere GROWS
    // (GROWTH_FACTOR) and it keeps drifting straight down (POST_PARK_DRIFT)
    // — x is unaffected (parked clusters don't move sideways), but y needs
    // both the margin widened to the grown size AND the whole valid band
    // shifted up by POST_PARK_DRIFT, so that y + POST_PARK_DRIFT still
    // clears the (bigger) margin once it actually charges.
    const xMargin = EDGE_MARGIN_RADII * this.R * GROWTH_FACTOR + OVERSHOOT_BUFFER;
    const yMargin = EDGE_MARGIN_RADII * this.R * GROWTH_FACTOR + OVERSHOOT_BUFFER;
    const xRange = axisValidRange(this.x, this.vx, xMargin, canvasWidth - xMargin);
    const yRange = axisValidRange(this.y, this.vy, yMargin - POST_PARK_DRIFT, canvasHeight - yMargin - POST_PARK_DRIFT);
    const windowMin = xRange && yRange ? Math.max(xRange[0], yRange[0]) : null;
    const windowMax = xRange && yRange ? Math.min(xRange[1], yRange[1]) : null;
    // No point on this trajectory ever gets far enough from every edge —
    // per the user's explicit "if the cluster cannot achieve a position
    // inside this range it should not spawn in the first place." Reusing
    // the existing `abandoned` flag achieves exactly that: this instance
    // still gets constructed and briefly enters index.js's array, but
    // isDone() is true immediately, and draw()/hitsCircle() are no-ops in
    // the meantime, so it's never visible or hazardous — functionally
    // identical to never having spawned.
    if (windowMin === null || windowMax === null || windowMin > windowMax) {
      this.abandoned = true;
      this.entryStopTime = 0;
    } else {
      this.abandoned = false;
      this.entryStopTime = windowMin + rand() * (windowMax - windowMin);
    }

    this.spinAngle = rand() * Math.PI * 2;
    this.phase = 'entering';
    this.phaseTime = 0;
    this.entryElapsed = 0;
    this.debrisElapsed = 0; // seconds since the burst — only advances during 'exploding', drives the shockwave/flash fades and isDone()
    // 0 outside 'charging', smoothstep(phaseTime/CHARGE_DURATION) (clamped
    // at 1) during it — drives the color lerp, glow, opacity ramp, AND the
    // 1.3x growth below, all off one number so they all stay in lockstep.
    this.chargeProgress = 0;
    this.shots = [];
  }

  // The sphere's actual drawn/collision radius — grows up to GROWTH_FACTOR
  // (1.3x) this.R as chargeProgress goes 0 -> 1, per the user's explicit
  // "the sphere itself grows through the transition" request.
  _visualRadius() {
    return this.R * (1 + (GROWTH_FACTOR - 1) * this.chargeProgress);
  }

  // Defensive backstop gating the actual explosion (charging -> exploding)
  // — the entryStopTime derivation in the constructor already solves for
  // exactly this condition (at the grown size, after the post-park drift),
  // so this should never actually trigger in normal play; it's just insurance
  // against edge cases (e.g. a mid-flight collision/pause skewing timing)
  // rather than the primary guarantee. Uses the sphere's current grown
  // radius (_visualRadius()) since that's its actual size by the time
  // it's ready to detonate.
  _isSafelyInsideForExplosion() {
    const margin = EDGE_MARGIN_RADII * this._visualRadius();
    return (
      this.x >= margin &&
      this.x <= this.canvasWidth - margin &&
      this.y >= margin &&
      this.y <= this.canvasHeight - margin
    );
  }

  // Pre-burst only — used to catch the (rare, ENTRY_TARGET_DURATION-driven) case
  // where a cluster gets force-parked without ever having geometrically
  // entered, then drifts the rest of the way off-canvas while charging.
  // Per the user's explicit "never let a cluster explode when it has left
  // the canvas" — see the charging branch in update() below.
  _isFullyOffScreen() {
    return (
      this.x + this.R < 0 ||
      this.x - this.R > this.canvasWidth ||
      this.y + this.R < 0 ||
      this.y - this.R > this.canvasHeight
    );
  }

  _explode() {
    this.phase = 'exploding';
    this.debrisElapsed = 0;
    const N = this.offsets.length;
    // Even radial spread FROM THE SPHERE'S CURRENT SPIN ANGLE — each shot's
    // launch direction, not its pre-burst position, is what's evenly
    // spaced, per the user's "equal spread of angles" spec. Launch
    // POSITION still comes from wherever spin actually left that shot at
    // the instant of the burst (see rotatePoint() below), so the burst
    // doesn't visibly snap the shots to new spots before flinging them.
    const angleOffset = Math.random() * Math.PI * 2;
    this.shots = this.offsets.map((o, i) => {
      const p = rotatePoint(o, this.spinAngle);
      const angle = angleOffset + (Math.PI * 2 / N) * i;
      const speed = BURST_SPEED_BASE + (Math.random() - 0.5) * 2 * BURST_SPEED_VAR;
      return {
        x: this.x + p.x,
        y: this.y + p.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + STARFIELD_SPEED * 0.3, // small residual downward drift inherited from the parked speed, so the burst doesn't ignore prior momentum
        rot: Math.random() * Math.PI * 2,
        spin: (10 + Math.random() * 10) * (Math.random() < 0.5 ? -1 : 1),
      };
    });
  }

  // `canExplode` (default true) lets index.js enforce a global minimum gap
  // between any two clusters' explosions (see its own
  // CLUSTER_EXPLOSION_COOLDOWN) — when false, a fully-charged cluster just
  // holds at full charge (chargeProgress clamped to 1, so it stays at
  // max size/opacity/color rather than visibly stalling mid-transition)
  // and re-checks every subsequent frame until it's granted permission.
  update(dt, canExplode = true) {
    if (this.phase === 'exploding') {
      this.debrisElapsed += dt;
      this.shots.forEach((s) => {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.spin * dt;
      });
      return;
    }

    if (this.phase === 'entering') {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.spinAngle += SPHERE_SPIN_RATE * dt;
      this.entryElapsed += dt;
      if (this.entryElapsed >= this.entryStopTime) {
        this.vx = 0;
        this.vy = STARFIELD_SPEED;
        this.phase = 'parked';
        this.phaseTime = 0;
      }
    } else if (this.phase === 'parked') {
      this.y += this.vy * dt;
      this.spinAngle += SPHERE_SPIN_RATE * dt;
      this.phaseTime += dt;
      if (this.phaseTime >= PARK_HOLD) { this.phase = 'charging'; this.phaseTime = 0; }
    } else if (this.phase === 'charging') {
      this.y += this.vy * dt;
      this.spinAngle += SPHERE_SPIN_RATE * dt;
      this.phaseTime += dt;
      this.chargeProgress = smoothstep(Math.min(1, this.phaseTime / CHARGE_DURATION));
      if (this.phaseTime >= CHARGE_DURATION) {
        if (!canExplode) return; // fully charged, just waiting on the global explosion cooldown to clear
        // Defensive re-check, not the primary guarantee — see
        // _isSafelyInsideForExplosion()'s own comment for why this should
        // rarely actually trigger now that entryStopTime picks a parking
        // spot already inside the margin.
        if (!this._isSafelyInsideForExplosion()) {
          this.abandoned = true;
        } else {
          this._explode();
        }
        return;
      }
    }

    // Shared pre-explosion off-screen check — covers 'entering' and
    // 'parked' too, not just the charge-completion moment above.
    if (this._isFullyOffScreen()) this.abandoned = true;
  }

  // Whole thing is finished (removable from index.js's array) either once
  // the post-burst debris window has fully played out, or immediately if
  // it was abandoned (drifted off-canvas pre-burst — see
  // _isFullyOffScreen()) rather than exploded.
  isDone() {
    return this.abandoned || (this.phase === 'exploding' && this.debrisElapsed >= DEBRIS_DURATION);
  }

  collisionRadius() {
    return this._visualRadius() * 0.85; // same fairness-margin idea as asteroidCollisionRadius() in index.js — tracks the sphere's own growth
  }

  // Same self-contained hitsCircle(x, y, radius) idiom Zapper.js uses for
  // its own beam collision — index.js calls this directly, same as
  // `zappersLeft.some((z) => z.hitsCircle(...))`, no internals exposed.
  // Before the burst this is the intact sphere; after, it's ANY currently-
  // flying shot — each shot is its own hazard once released, per the
  // user's explicit "if they make contact ... is a collision" request.
  hitsCircle(x, y, radius) {
    if (this.abandoned) return false;
    if (this.phase === 'exploding') {
      return this.shots.some((s) => Math.hypot(x - s.x, y - s.y) < radius + this.shotR * 0.9);
    }
    return Math.hypot(x - this.x, y - this.y) < radius + this.collisionRadius();
  }

  _drawExplosionEffects(ctx) {
    // Starts from the sphere's own grown size (chargeProgress is still 1
    // here — nothing resets it on entering 'exploding') so the shockwave
    // visibly originates from wherever the glass boundary actually was the
    // instant it burst, not the un-grown base radius.
    const R = this._visualRadius();
    const swT = Math.min(1, this.debrisElapsed / SHOCKWAVE_DURATION);
    if (swT < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, R + swT * R * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${DEEP_RED.glow},${(1 - swT) * 0.8})`;
      ctx.lineWidth = 3 * (1 - swT) + 1;
      ctx.shadowColor = `rgba(${DEEP_RED.glow},0.9)`;
      ctx.shadowBlur = 14 * (1 - swT);
      ctx.stroke();
      ctx.restore();
    }
    const flT = Math.min(1, this.debrisElapsed / FLASH_DURATION);
    if (flT < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fl = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, R * 2.2);
      fl.addColorStop(0, `rgba(255,255,255,${(1 - flT) * 0.85})`);
      fl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fl;
      ctx.beginPath(); ctx.arc(this.x, this.y, R * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  draw(ctx) {
    if (this.abandoned) return; // off-canvas, nothing to draw
    if (this.phase === 'exploding') {
      this._drawExplosionEffects(ctx);
      const fadeStart = DEBRIS_DURATION - 0.35;
      const alpha = this.debrisElapsed > fadeStart
        ? Math.max(0, 1 - (this.debrisElapsed - fadeStart) / (DEBRIS_DURATION - fadeStart))
        : 1;
      this.shots.forEach((s) => drawShot(ctx, s.x, s.y, this.shotR, s.rot, SHOT_PAL, alpha));
      return;
    }

    // Shots scale right along with the sphere's own 1.3x growth (see
    // _visualRadius()) so the whole cluster reads as one object growing,
    // rather than the glass outgrowing static contents.
    const growth = 1 + 0.3 * this.chargeProgress;
    this.offsets.forEach((o) => {
      const p = rotatePoint(o, this.spinAngle);
      drawShot(ctx, this.x + p.x * growth, this.y + p.y * growth, this.shotR * growth, o.rot + this.spinAngle, SHOT_PAL, 1);
    });

    const pal = lerpPalette(LIGHT_YELLOW, DEEP_RED, this.chargeProgress);
    drawSphereGlass(ctx, this.x, this.y, this._visualRadius(), pal, this.chargeProgress, this.seed, this.spinAngle);
  }
}
