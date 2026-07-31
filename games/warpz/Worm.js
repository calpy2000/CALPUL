// ==========================================
// MODULE: THE WORM OBSTACLE CLASS
// ==========================================
//
// A space worm: a chain of tapering, armor-plated segments that slithers
// across the canvas. Body style ("armored/plated" — alternating side
// spikes, mandibled head) and the four color palettes below both came out
// of a dedicated mockup-and-approve pass before this file existed.
//
// Motion is the standard "follow the leader" chain technique real
// snake/worm games use: a HEAD point travels its own path, and every
// trailing segment is pulled to sit a fixed LINK distance behind the one
// ahead of it.
//
// The head's path genuinely curves — its heading continuously swings side
// to side around its original entry angle (baseAngle), rather than
// following a straight line with a perpendicular offset drawn on top (that
// straight-line-plus-wobble technique was the ORIGINAL version, replaced
// completely per the user's explicit "replace this completely with a new
// slithering pattern" request, since at worm speed the old wobble read as
// pretty much a straight line). The heading swing is capped well under 90°
// (HEADING_SWING_DEG below) so the worm's forward progress along its
// original entry direction never actually stops — it still reliably nets
// INTO and back OUT OF the canvas like every other obstacle, per the user's
// explicit choice to keep that guarantee; only the LOCAL path winds.
//
// Per the user's explicit request, entry points/density (and their random
// variation) are the same as Asteroid.js's own — see index.js's own
// WORM_CREATION_INTERVAL_BASE/VARIATION, copied from the asteroid constants
// rather than re-derived. Speed STARTED as a straight copy of Asteroid's
// own BASE_SPEED too, but was later bumped 1.5x twice over (see
// WORM_BASE_SPEED below) per the user's explicit requests — the ±30%
// per-instance variation mechanism (WORM_SPEED_VARIATION) is unchanged, just
// applied around the new, faster base.

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Four palettes from the approved color-variation mockup — exported so
// index.js can pick "a different color than whichever worm spawned last",
// same not-the-same-as-last-time pattern StarShard/EnergyOrb already use
// for their own palettes.
export const PALETTES = [
  { name: 'Toxic Green', spike: '#28a85c', light: '#c9ffd8', mid: '#2f7a4d', dark: '#0a2417', glow: '90,255,150' },
  { name: 'Molten Red', spike: '#d9481f', light: '#ffe0c9', mid: '#a8391f', dark: '#3a0f05', glow: '255,140,80' },
  { name: 'Void Purple', spike: '#7a3fc9', light: '#e6d8ff', mid: '#5a3487', dark: '#180a2e', glow: '170,110,255' },
  { name: 'Icy Cyan', spike: '#1f9fc9', light: '#d8faff', mid: '#156b7a', dark: '#04202a', glow: '90,220,255' },
];

const HEAD_R = 14; // px, head/max-segment radius
const LINK = 11; // px between segment centers along the chain
// Originally 12 per the user's explicit "12 to 24, random" spec; later
// bumped to 18 per the user's explicit "increase the minimum length to 18
// segments" request — MAX_SEGMENTS is untouched, so the random range is now
// 18 to 36 (narrower than before, since the minimum moved up without the
// maximum moving with it).
const MIN_SEGMENTS = 18;
// Originally 24 (inclusive) per the user's explicit "12 to 24, random" spec;
// later bumped 1.5x (24 -> 36) per the user's explicit "increase the
// maximum possible length by 1.5x" request.
const MAX_SEGMENTS = 36;

// WORM_SPEED_VARIATION started as a straight copy of Asteroid.js's own
// SPEED_VARIATION — see this file's header comment on why these are copied
// rather than shared via import (Asteroid.js doesn't export them, and
// duplicating a number is simpler than changing that just for this).
// WORM_BASE_SPEED started as Asteroid's own BASE_SPEED (90), was bumped
// 1.5x to 135 per the user's explicit "increase the speed of the worms by
// 1.5x" request, then bumped 1.5x AGAIN to 202.5 per a second identical
// request — no longer equal to the asteroids' own speed.
const WORM_BASE_SPEED = 202.5;
const WORM_SPEED_VARIATION = 0.3;

// How far (in degrees) the head's heading swings away from its original
// entry angle (baseAngle) each direction. Deliberately well under 90° — see
// this file's header comment on why that's what guarantees the worm keeps
// making forward progress into/out of the canvas even while its LOCAL path
// curves back and forth. Randomized per-worm (HEADING_SWING_VARIATION) —
// max possible roll is 50 * 1.3 = 65°, still comfortably under 90° so no
// clamping is needed here (contrast HEADING_TURN_FREQ below, which has no
// such ceiling to worry about).
const HEADING_SWING_DEG = 50;
const HEADING_SWING_VARIATION = 0.3; // +/-30%, same convention as every other per-instance variation in this codebase
// How fast the heading oscillates between its leftmost and rightmost swing
// — this is what actually paces the S-curve's "wavelength" along the path,
// i.e. how WOUND the path looks (combined with speed: a faster worm covers
// more distance per swing cycle, so its curves read as more stretched-out,
// same as a real snake speeding up). Originally 2.0 rad/sec, bumped 1.5x to
// 3.0 per the user's explicit "increase the winding along the path by 1.5x"
// request. Also randomized per-worm now (HEADING_TURN_FREQ_VARIATION), per
// the user's explicit "introduce a level of random variability" request —
// no upper-bound safety concern here the way there is for the swing angle,
// since any positive frequency is safe.
const HEADING_TURN_FREQ = 3.0; // rad/sec
const HEADING_TURN_FREQ_VARIATION = 0.3; // +/-30%

function radiusAt(i, n) {
  return Math.max(HEAD_R * 0.16, HEAD_R * (1 - (i / (n - 1)) * 0.82));
}

// -- armored/plated renderer, palette-driven (identical to the approved
// mockup's drawArmored(), just taking ctx-space segment positions instead
// of card-local ones) --
function drawArmored(ctx, segments, pal) {
  const n = segments.length;
  for (let i = n - 1; i >= 1; i--) {
    const r = radiusAt(i, n);
    const prev = segments[i - 1];
    const dir = Math.atan2(prev.y - segments[i].y, prev.x - segments[i].x);
    const side = i % 2 === 0 ? 1 : -1;
    const px = segments[i].x + Math.cos(dir + Math.PI / 2) * side * r * 1.3;
    const py = segments[i].y + Math.sin(dir + Math.PI / 2) * side * r * 1.3;
    ctx.beginPath();
    ctx.moveTo(segments[i].x + Math.cos(dir + Math.PI / 2) * side * r * 0.4, segments[i].y + Math.sin(dir + Math.PI / 2) * side * r * 0.4);
    ctx.lineTo(px, py);
    ctx.lineTo(segments[i].x - Math.cos(dir) * r * 0.7, segments[i].y - Math.sin(dir) * r * 0.7);
    ctx.closePath();
    ctx.fillStyle = pal.spike;
    ctx.fill();

    const r2 = r * 0.9;
    const grad = ctx.createRadialGradient(segments[i].x - r2 * 0.3, segments[i].y - r2 * 0.3, r2 * 0.1, segments[i].x, segments[i].y, r2);
    grad.addColorStop(0, pal.light); grad.addColorStop(0.6, pal.mid); grad.addColorStop(1, pal.dark);
    ctx.beginPath(); ctx.arc(segments[i].x, segments[i].y, r2, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = `rgba(${pal.glow},0.35)`; ctx.lineWidth = 1.4; ctx.stroke();
  }
  const h = segments[0], r = HEAD_R;
  const dir = Math.atan2(segments[0].y - segments[1].y, segments[0].x - segments[1].x);
  ctx.save();
  ctx.translate(h.x, h.y); ctx.rotate(dir);
  const hg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.05);
  hg.addColorStop(0, pal.light); hg.addColorStop(0.6, pal.mid); hg.addColorStop(1, pal.dark);
  ctx.beginPath(); ctx.moveTo(r * 1.15, 0); ctx.lineTo(-r * 0.7, -r * 0.95); ctx.lineTo(-r * 0.7, r * 0.95); ctx.closePath();
  ctx.fillStyle = hg; ctx.shadowColor = `rgba(${pal.glow},0.4)`; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = pal.dark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(r * 0.6, -r * 0.25); ctx.lineTo(r * 1.3, -r * 0.55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(r * 0.6, r * 0.25); ctx.lineTo(r * 1.3, r * 0.55); ctx.stroke();
  ctx.restore();
}

// Simple incrementing seed source, same pattern every other obstacle class
// in this game uses.
let nextSeed = 1;

export default class Worm {
  // `edge`/`coord`/`angleRangeDeg`/`canvasWidth` are exactly what
  // Asteroid's own constructor takes (see index.js's shared
  // pickSpawnPoint() helper, used for both) — same off-screen entry, same
  // into-canvas trajectory constraint. `palette` is one of the PALETTES
  // entries above, chosen by index.js's own "not the same as last time"
  // picker.
  constructor(edge, coord, angleRangeDeg, canvasWidth, palette) {
    const seed = nextSeed++;
    const rand = mulberry32(seed * 7919 + 13);

    this.palette = palette;
    this.n = MIN_SEGMENTS + Math.floor(rand() * (MAX_SEGMENTS - MIN_SEGMENTS + 1)); // random 18..36 inclusive, per the user's explicit spec
    // Phase offset for the heading oscillation (see update()) — randomized
    // per-worm so a field of worms doesn't all curve in lockstep.
    this.headingPhase = rand() * Math.PI * 2;
    // Per-worm randomized winding — each worm gets its own swing depth and
    // turn speed instead of every worm curving identically, per the user's
    // explicit "introduce a level of random variability" request. See the
    // constants' own comments for why the swing roll needs no extra
    // clamping here.
    this.headingSwingRad = (HEADING_SWING_DEG * (1 + (rand() * 2 - 1) * HEADING_SWING_VARIATION) * Math.PI) / 180;
    this.headingTurnFreq = HEADING_TURN_FREQ * (1 + (rand() * 2 - 1) * HEADING_TURN_FREQ_VARIATION);
    this.age = 0;
    this._hasBeenOnScreen = false; // see isOffScreen()'s own comment

    this.speed = WORM_BASE_SPEED * (1 + (rand() * 2 - 1) * WORM_SPEED_VARIATION);
    const [minDeg, maxDeg] = angleRangeDeg;
    // The worm's original entry angle — its heading swings around THIS
    // (see update()), it doesn't travel straight along it forever.
    this.baseAngle = ((minDeg + rand() * (maxDeg - minDeg)) * Math.PI) / 180;
    const unitX = Math.sin(this.baseAngle);
    const unitY = Math.cos(this.baseAngle);

    // Bounding radius for spawn placement — the whole chain's max possible
    // reach from the head, so it starts fully off-screen rather than
    // popping in tail-first.
    const chainReach = (this.n - 1) * LINK + HEAD_R;
    this.chainReach = chainReach;

    let headX, headY;
    if (edge === 'top') {
      headX = coord;
      headY = -chainReach;
    } else if (edge === 'left') {
      headX = -chainReach;
      headY = coord;
    } else {
      headX = canvasWidth + chainReach;
      headY = coord;
    }

    // Initial tail lays out straight behind the head along baseAngle — it
    // immediately starts curving from the very next update() call, this is
    // just a starting pose.
    this.segments = [];
    for (let i = 0; i < this.n; i++) {
      this.segments.push({ x: headX - unitX * i * LINK, y: headY - unitY * i * LINK });
    }
  }

  update(dt) {
    this.age += dt;
    this.headingPhase += this.headingTurnFreq * dt;

    // Current heading swings sinusoidally around baseAngle rather than
    // holding it fixed — this is what makes the head's own path curve
    // (an actual winding line) instead of a straight path with something
    // drawn on top of it. Swing is capped at ~HEADING_SWING_DEG (well under
    // 90°, even after this worm's own random roll) so cos(heading -
    // baseAngle) never goes negative — the worm is mathematically
    // guaranteed to keep making forward progress along its original entry
    // direction every frame, even at the extremes of a swing, which is what
    // keeps the net-into/out-of-canvas guarantee intact while the local
    // path winds freely.
    const heading = this.baseAngle + Math.sin(this.headingPhase) * this.headingSwingRad;
    const seg = this.segments;
    seg[0].x += Math.sin(heading) * this.speed * dt;
    seg[0].y += Math.cos(heading) * this.speed * dt;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i];
      const dx = a.x - b.x, dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const nx = dx / dist, ny = dy / dist;
      b.x = a.x - nx * LINK;
      b.y = a.y - ny * LINK;
    }
  }

  // Off-screen only once EVERY segment has cleared — a long worm's tail
  // can still be trailing on-screen well after its head has exited, same
  // "keep it around until it's actually all gone" reasoning Asteroid's own
  // isOffScreen() uses for its single circle.
  //
  // BUT: unlike Asteroid (whose spawn offset and off-screen margin are the
  // same radius, so it starts exactly AT the boundary, not past it), a worm
  // spawns with its head a full chainReach away — deliberately, so the
  // whole tail is hidden off-screen too — which is much bigger than the
  // HEAD_R margin below. Every segment reads as "off-screen" at the exact
  // instant it spawns, which is indistinguishable from "finished and
  // exited" to a purely geometric check, and this was getting called (and
  // returning true) on the very first frame after spawn — the worm was
  // being deleted before it ever had a chance to travel onto the canvas.
  // Gating on "has the head ever actually been on-screen" fixes that: nothing
  // gets culled until it's genuinely arrived at least once.
  isOffScreen(canvasWidth, canvasHeight) {
    if (!this._hasBeenOnScreen) {
      const head = this.segments[0];
      const headOnScreen = (
        head.x + HEAD_R >= 0 &&
        head.x - HEAD_R <= canvasWidth &&
        head.y + HEAD_R >= 0 &&
        head.y - HEAD_R <= canvasHeight
      );
      if (headOnScreen) this._hasBeenOnScreen = true;
      else return false; // still arriving — never cull before it's shown up at all
    }
    return this.segments.every((s) => (
      s.x + HEAD_R < 0 ||
      s.x - HEAD_R > canvasWidth ||
      s.y + HEAD_R < 0 ||
      s.y - HEAD_R > canvasHeight
    ));
  }

  // Self-contained hitsCircle(x, y, radius) — same idiom Zapper.js/
  // Cluster.js use for their own collision, called directly from index.js.
  // Any segment touching counts, not just the head.
  hitsCircle(x, y, radius) {
    return this.segments.some((s, i) => Math.hypot(x - s.x, y - s.y) < radius + radiusAt(i, this.n) * 0.85);
  }

  draw(ctx) {
    drawArmored(ctx, this.segments, this.palette);
  }
}
