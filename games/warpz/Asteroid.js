// ==========================================
// MODULE: THE ASTEROID OBJECT CLASS
// ==========================================
//
// One phase-1 WARPZ obstacle. Silhouette + crater rendering is carried over
// unchanged from the design-exploration prototype the "Cratered Rock"
// visual direction was picked from — see rockPoints()/roughenOutline()
// (jagged, finely-segmented edge) and generateCraters() (edge-aware,
// ~80%-coverage crater field with per-crater hue variety) below for how
// that's built. What's new here is per-instance variety (size, aspect
// ratio, spin, speed, trajectory — see the constants block) and the
// spawn/lifetime handling (entering just outside the canvas, dying once
// fully off-screen) needed to actually run this as a moving field rather
// than a single static preview shape.

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rockPoints(seed, count, jitter) {
  const rand = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 / count) * i;
    const r = 1 - jitter / 2 + rand() * jitter;
    pts.push({ a, r });
  }
  return pts;
}

function polarToCartesian(pts, radius) {
  return pts.map((p) => ({ x: Math.cos(p.a) * p.r * radius, y: Math.sin(p.a) * p.r * radius }));
}

// Splits every edge of a polygon into three shorter ones, nudging each new
// midpoint sideways (perpendicular to its own segment) by a small random
// amount — "midpoint displacement," the same idea coastlines/terrain are
// often generated with. Keeps the big lobed shape intact while making the
// edge itself read as finer and craggier.
function roughenOutline(cartPts, seed, roughness) {
  const rand = mulberry32(seed);
  const n = cartPts.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const a = cartPts[i], b = cartPts[(i + 1) % n];
    result.push(a);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    [1 / 3, 2 / 3].forEach((t) => {
      const px = a.x + dx * t, py = a.y + dy * t;
      const offset = (rand() - 0.5) * 2 * roughness * len;
      result.push({ x: px + nx * offset, y: py + ny * offset });
    });
  }
  return result;
}

// How far out the rock's own macro (pre-roughening) boundary reaches in a
// given direction — the two bracketing vertices sit at evenly-spaced
// angles, so "which two" and "how far between them" is just division.
function radiusAtAngle(basePts, angle) {
  const n = basePts.length;
  const step = (Math.PI * 2) / n;
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const idx = a / step;
  const i0 = Math.floor(idx) % n;
  const i1 = (i0 + 1) % n;
  const frac = idx - Math.floor(idx);
  return basePts[i0].r + (basePts[i1].r - basePts[i0].r) * frac;
}

// Polygon area for a star-shaped (radius-per-angle) outline with evenly
// spaced angle steps: half the sum of each pair of neighboring radii's
// product, times sin(step).
function polygonArea(basePts) {
  const n = basePts.length;
  const step = (Math.PI * 2) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += basePts[i].r * basePts[(i + 1) % n].r;
  return 0.5 * Math.sin(step) * sum;
}

// Drops craters (mostly small, occasionally bigger, each own seeded hue)
// until their combined area hits `coverage` of the rock's own silhouette.
// Every candidate is checked against the rock's actual boundary in that
// specific direction (never a generic circle) and sized down to fit
// whatever room is left there, so craters fill right up to the edge
// instead of leaving a bare rim. Overlap between craters is capped, not
// eliminated — real cratered surfaces chain into each other constantly.
function generateCraters(seed, coverage, basePts) {
  const rand = mulberry32(seed);
  const craters = [];
  const margin = 0.93;
  const overlapK = 0.45;
  const bound = Math.max(...basePts.map((p) => p.r)) * margin;
  const targetArea = coverage * polygonArea(basePts);
  let area = 0;
  let guard = 0;
  while (area < targetArea && guard < 8000) {
    guard++;
    const x = (rand() - 0.5) * bound * 2;
    const y = (rand() - 0.5) * bound * 2;
    const dist = Math.sqrt(x * x + y * y);
    const localR = radiusAtAngle(basePts, Math.atan2(y, x)) * margin;
    const clearance = localR - dist;
    if (clearance < 0.014) continue;
    const desired = rand() < 0.72 ? 0.045 + rand() * 0.08 : 0.11 + rand() * 0.15;
    const r = Math.min(desired, clearance * (0.65 + rand() * 0.35));

    const tooClose = craters.some((c) => {
      const dx = c.x - x, dy = c.y - y;
      return Math.sqrt(dx * dx + dy * dy) < (c.r + r) * overlapK;
    });
    if (tooClose) continue;

    const hueRoll = rand();
    const hue = hueRoll < 0.65 ? 20 + rand() * 30 : hueRoll < 0.9 ? 200 + rand() * 30 : 355 + rand() * 20;
    const sat = 10 + rand() * 20;
    const lightRim = 15 + rand() * 9;
    const lightDeep = 5 + rand() * 6;

    craters.push({ x, y, r, hue, sat, lightRim, lightDeep });
    area += Math.PI * r * r;
  }
  return craters;
}

function tracePath(ctx, cartPts) {
  ctx.beginPath();
  cartPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

// -- per-instance variety knobs, per the design pass this came out of --
// each new asteroid rolls its own value on every one of these, independent
// of every other asteroid currently in the field.
const BASE_RADIUS = 24; // px, before size variation (40 * 0.6)
const SIZE_VARIATION = 0.3; // +/-30%
const ASPECT_MAX_STRETCH = 1.0; // elongated axis can reach up to 2x the other (1 + 1.0 => up to a 1:2 rock)
const BASE_SPIN = 1.0; // rad/sec
const SPIN_VARIATION = 0.3; // +/-30%, direction (cw/ccw) independently randomized
const BASE_SPEED = 90; // px/sec
const SPEED_VARIATION = 0.3; // +/-30%
export const TRAJECTORY_VARIATION_DEG = 70; // max degrees off straight-down

const OUTLINE_COUNT = 20;
const OUTLINE_JITTER = 0.55;
const OUTLINE_ROUGHNESS = 0.22;
const CRATER_COVERAGE = 0.8;

// Simple incrementing seed source, so every asteroid's shape/craters are
// independently and reproducibly varied without needing to stash a full
// PRNG per instance before its own size is even known.
let nextSeed = 1;

export default class Asteroid {
  // `edge` is which side of the canvas this one is entering from
  // ('top' | 'left' | 'right'); `coord` is the position along that edge (an
  // x for 'top', a y for 'left'/'right'); `angleRangeDeg` is the [min, max]
  // degrees off straight-down this edge is allowed to use — the full
  // +/-70 range for 'top', but only the inward half of it for 'left'/
  // 'right', so every asteroid's trajectory always carries it further INTO
  // the canvas rather than back out the edge it just appeared on (see
  // index.js's spawnAsteroid()). `canvasWidth` is only needed to place a
  // 'right'-edge spawn.
  constructor(edge, coord, angleRangeDeg, canvasWidth) {
    const seed = nextSeed++;
    const rand = mulberry32(seed * 7919 + 13);

    this.size = BASE_RADIUS * (1 + (rand() * 2 - 1) * SIZE_VARIATION);
    this.elongation = 1 + rand() * ASPECT_MAX_STRETCH;
    this.spinSpeed = BASE_SPIN * (1 + (rand() * 2 - 1) * SPIN_VARIATION) * (rand() < 0.5 ? 1 : -1);
    this.speed = BASE_SPEED * (1 + (rand() * 2 - 1) * SPEED_VARIATION);

    const [minDeg, maxDeg] = angleRangeDeg;
    const theta = ((minDeg + rand() * (maxDeg - minDeg)) * Math.PI) / 180;
    this.vx = Math.sin(theta) * this.speed;
    this.vy = Math.cos(theta) * this.speed;

    // Bounding radius (worst case across the stretched axis) — used both
    // to place this asteroid fully outside the canvas at spawn (so it
    // slides in as a complete shape rather than popping in half-clipped)
    // and later to decide when it's fully left the canvas for good.
    this.boundRadius = this.size * this.elongation;

    if (edge === 'top') {
      this.x = coord;
      this.y = -this.boundRadius;
    } else if (edge === 'left') {
      this.x = -this.boundRadius;
      this.y = coord;
    } else {
      this.x = canvasWidth + this.boundRadius;
      this.y = coord;
    }

    this.angle = rand() * Math.PI * 2;
    this.age = 0;
    this.glowPhase = rand() * Math.PI * 2; // offsets each asteroid's glow pulse so they don't all throb in sync

    const basePolar = rockPoints(seed, OUTLINE_COUNT, OUTLINE_JITTER);
    this.outline = roughenOutline(polarToCartesian(basePolar, this.size), seed + 777, OUTLINE_ROUGHNESS);
    this.craters = generateCraters(seed + 4200, CRATER_COVERAGE, basePolar);
    this.mottleSeed = seed + 9001;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spinSpeed * dt;
    this.age += dt;
  }

  // A field that only ever flows one direction has no reason to keep
  // tracking something that's already exited — this is checked every
  // frame in index.js's animate() loop and any asteroid it's true for gets
  // dropped from the array outright, not just hidden.
  isOffScreen(canvasWidth, canvasHeight) {
    return (
      this.x + this.boundRadius < 0 ||
      this.x - this.boundRadius > canvasWidth ||
      this.y + this.boundRadius < 0 ||
      this.y - this.boundRadius > canvasHeight
    );
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const radius = this.size;
    const elong = this.elongation;
    // Throbbing ambient glow — same pulsing-shadow technique JEWELZ's Bar.js
    // uses, just on this rock's own silhouette fill instead of a neon bar.
    // Scoped with its own save/restore so it only lights up the body fill
    // below, not the mottling/craters drawn afterward.
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 2.2 + this.glowPhase);

    // Body: silhouette + mottling only, stretched along this instance's own
    // local Y axis (which axis doesn't matter — continuous spin cycles
    // every asteroid through every orientation regardless of which one is
    // picked here). Craters are drawn separately, OUTSIDE this scale, so
    // they stay true circles no matter how stretched the rock itself is.
    ctx.save();
    ctx.scale(1, elong);

    ctx.save();
    ctx.shadowColor = `rgba(150, 190, 255, ${0.5 + pulse * 0.4})`;
    ctx.shadowBlur = 10 + pulse * 16;
    tracePath(ctx, this.outline);
    const grad = ctx.createRadialGradient(-radius * 0.35, -radius * 0.35, radius * 0.15, 0, 0, radius);
    grad.addColorStop(0, "#9c9284");
    grad.addColorStop(0.55, "#5b5548");
    grad.addColorStop(1, "#221f1a");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Mottling: soft, seeded blotches clipped to the silhouette, so the
    // surface reads as uneven mineral/weathering texture.
    ctx.save();
    tracePath(ctx, this.outline);
    ctx.clip();
    const mrand = mulberry32(this.mottleSeed);
    for (let i = 0; i < 16; i++) {
      const bx = (mrand() - 0.5) * radius * 2.1;
      const by = (mrand() - 0.5) * radius * 2.1;
      const br = radius * (0.14 + mrand() * 0.3);
      const lighter = mrand() > 0.5;
      const tone = lighter ? "200,190,172" : "40,36,30";
      const alpha = 0.1 + mrand() * 0.16;
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, `rgba(${tone},${alpha})`);
      bg.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore(); // end of the Y-stretched body block

    // Craters: position follows the body's own stretch (cy scaled by elong
    // to match where that spot on the surface actually ended up), but each
    // one is drawn as a true circle, unaffected by elong itself.
    this.craters.forEach((c) => {
      const cx = c.x * radius, cy = c.y * radius * elong, cr = c.r * radius;
      const cg = ctx.createRadialGradient(cx - cr * 0.3, cy - cr * 0.3, cr * 0.1, cx, cy, cr);
      cg.addColorStop(0, `hsl(${c.hue}, ${c.sat}%, ${c.lightRim}%)`);
      cg.addColorStop(1, `hsl(${c.hue}, ${c.sat}%, ${c.lightDeep}%)`);
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - cr * 0.25, cy - cr * 0.25, cr * 0.75, Math.PI * 1.0, Math.PI * 1.6);
      ctx.strokeStyle = "rgba(255,240,220,0.18)";
      ctx.lineWidth = Math.max(1, cr * 0.15);
      ctx.stroke();
    });

    ctx.restore();
  }
}
