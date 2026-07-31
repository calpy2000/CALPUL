// ==========================================
// MODULE: THE STARFIELD BACKGROUND
// ==========================================
//
// A slow, seamlessly-looping scroll of stars behind the asteroid field —
// updated and drawn completely independently of any Asteroid instance, so
// its own motion never has to agree with (or react to) theirs. Three depth
// "layers" (far/mid/near — different size, brightness, and speed each)
// give a rough sense of parallax without needing anything more elaborate
// than three flat arrays of dots.

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One layer's worth of stars, generated once up front — plain {x, y, r,
// alpha} objects, cheap to create and cheap to draw (solid-fill circles,
// no gradients, unlike the asteroids). `twinkle` turns on a slow per-star
// alpha pulse, only used for the nearest layer so it reads as a subtle
// accent rather than the whole sky flickering.
function makeLayer(seed, width, height, count, rRange, alphaRange, speed, twinkle) {
  const rand = mulberry32(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    // Cubing a 0-1 value before scaling it into rRange skews most stars
    // toward the small end while still letting a handful roll close to
    // the top of the range — a wider, less uniform-looking spread of
    // sizes than picking linearly across the same range would give.
    const sizeRoll = Math.pow(rand(), 3);
    stars.push({
      x: rand() * width,
      y: rand() * height,
      r: rRange[0] + sizeRoll * (rRange[1] - rRange[0]),
      alpha: alphaRange[0] + rand() * (alphaRange[1] - alphaRange[0]),
      twinklePhase: rand() * Math.PI * 2,
    });
  }
  return { stars, speed, twinkle };
}

// Stars at or above this radius get a throbbing glow on top of their plain
// fill (see draw() below) — independent of which layer they belong to, so
// it's really "however big a given star happens to land," not a per-layer
// switch.
const GLOW_RADIUS_THRESHOLD = 1.7;

export default class Starfield {
  constructor(width, height, seed = 1) {
    this.width = width;
    this.height = height;
    this.age = 0;
    // far -> near: smaller/dimmer/slower to bigger/brighter/faster, so the
    // faster-moving stars also read as "closer" — real parallax, from
    // tuning three numbers per layer rather than anything more elaborate.
    // Speeds are all well under the asteroids' own 90px/s base speed, so
    // this reads as ambient backdrop motion rather than competing with the
    // actual obstacles for attention.
    // Counts doubled and size ranges widened/overlapped a bit (per-layer
    // still small-to-big, but the ranges now bleed into each other rather
    // than reading as three discrete size tiers).
    this.layers = [
      makeLayer(seed + 1, width, height, 140, [0.3, 1.1], [0.12, 0.35], 10, false),
      makeLayer(seed + 2, width, height, 80, [0.6, 1.8], [0.28, 0.55], 22, false),
      makeLayer(seed + 3, width, height, 40, [1.0, 2.6], [0.5, 0.9], 38, true),
    ];
  }

  // Always safe to call every frame regardless of game state — this is
  // pure decoration with no gameplay meaning, so index.js updates it
  // unconditionally rather than freezing it alongside the asteroids on
  // game over.
  update(dt) {
    this.age += dt;
    this.layers.forEach((layer) => {
      layer.stars.forEach((s) => {
        s.y += layer.speed * dt;
        // Seamless wrap: since stars are randomly scattered rather than a
        // repeating pattern, there's no visible "seam" to hide — a star
        // that drifts past the bottom edge just re-enters at the
        // equivalent point above the top, indistinguishable from any
        // other star already there.
        if (s.y >= this.height) s.y -= this.height;
      });
    });
  }

  // Also paints the base background color — callers can use this in place
  // of their own ctx.clearRect(), since a full-canvas fillRect() already
  // clears the previous frame just as well.
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#05070c'; // same deep-space color as WARPZ's own canvas background (style.css)
    ctx.fillRect(0, 0, this.width, this.height);
    this.layers.forEach((layer) => {
      layer.stars.forEach((s) => {
        const twinkle = layer.twinkle ? 0.75 + 0.25 * Math.sin(this.age * 2 + s.twinklePhase) : 1;
        ctx.globalAlpha = s.alpha * twinkle;
        ctx.fillStyle = '#cfe0ff';
        // Bigger stars get a throbbing glow on top of the plain fill —
        // same pulsing-shadow technique as the asteroids' own glow, just
        // reset back to 0 straight after so it doesn't bleed onto the
        // next (likely smaller, glow-less) star drawn after it.
        if (s.r >= GLOW_RADIUS_THRESHOLD) {
          const glowPulse = 0.5 + 0.5 * Math.sin(this.age * 1.6 + s.twinklePhase);
          ctx.shadowColor = 'rgba(190, 215, 255, 0.9)';
          ctx.shadowBlur = s.r * (2.5 + glowPulse * 2.5);
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    });
    ctx.restore();
  }
}
