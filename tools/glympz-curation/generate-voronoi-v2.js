// Voronoi generator v2: curved cell boundaries + randomized color palette
// per image, based on feedback on v1 (straight edges, fixed palette).
//
// Curved edges technique ("domain warping"): a plain Voronoi diagram's
// boundaries are always straight lines, because they're literally the set
// of points equidistant between two seeds under normal (Euclidean)
// distance — a perpendicular bisector, which is a straight line by
// definition. To curve them, warp the COORDINATES before measuring
// distance: for each pixel, nudge its (x,y) by a smooth pseudo-random
// offset (built from a few overlapping sine waves — a cheap stand-in for
// real Perlin/simplex noise, good enough for this) before finding the
// nearest seed. Since the warp field itself is smooth and continuous, the
// resulting boundaries wobble organically instead of being straight.
//
// Palette variety: each image randomly picks a hue range/style (rainbow,
// warm, cool, pastel, jewel-tone) rather than reusing one fixed color list,
// so a batch of these doesn't all look like copies of each other.
//
// Usage: node generate-voronoi-v2.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, 'samples');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SIZE = 500;

function rand(min, max) { return Math.random() * (max - min) + min; }

// Cheap smooth 2D pseudo-noise: sum of a few sine waves at different
// frequencies/phases. Not "real" Perlin noise, but smooth and continuous,
// which is all domain-warping actually needs.
function makeNoise2D(seed) {
  const p1 = seed * 12.9898, p2 = seed * 78.233, p3 = seed * 37.719;
  return (x, y) =>
    Math.sin(x * 0.012 + p1) * Math.cos(y * 0.015 + p2) +
    Math.sin((x * 0.021 + y * 0.017) + p3) * 0.6;
}

// HSL -> RGB (browsers/CSS do this natively, but we need actual RGB byte
// values to write into a raw pixel buffer for sharp).
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Picks a random "palette style" and returns `count` RGB colors following
// it — this is what makes different generated images look distinctly
// different from each other rather than reusing one fixed color list.
function generatePalette(count) {
  const style = ['rainbow', 'warm', 'cool', 'pastel', 'jewel'][Math.floor(rand(0, 5))];
  const colors = [];
  for (let i = 0; i < count; i++) {
    let h, s, l;
    if (style === 'rainbow') { h = rand(0, 360); s = rand(65, 90); l = rand(45, 60); }
    else if (style === 'warm') { h = rand(-20, 60); s = rand(70, 95); l = rand(45, 65); }
    else if (style === 'cool') { h = rand(150, 280); s = rand(60, 90); l = rand(40, 60); }
    else if (style === 'pastel') { h = rand(0, 360); s = rand(45, 65); l = rand(70, 82); }
    else { h = rand(0, 360); s = rand(75, 100); l = rand(30, 45); } // jewel: deep, saturated
    colors.push(hslToRgb((h + 360) % 360, s, l));
  }
  return { style, colors };
}

async function generateOne(seedCount, warpStrength, filename) {
  const { style, colors } = generatePalette(seedCount);
  const seeds = [];
  for (let i = 0; i < seedCount; i++) {
    seeds.push({ x: rand(0, SIZE), y: rand(0, SIZE), color: colors[i] });
  }

  const noiseX = makeNoise2D(rand(0, 1000));
  const noiseY = makeNoise2D(rand(0, 1000));

  const nearest = new Int16Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const wx = x + noiseX(x, y) * warpStrength;
      const wy = y + noiseY(x, y) * warpStrength;
      let best = 0, bestDist = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = wx - seeds[s].x, dy = wy - seeds[s].y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = s; }
      }
      nearest[y * SIZE + x] = best;
    }
  }

  const buffer = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = y * SIZE + x;
      const cell = nearest[idx];
      const isBorder =
        (x + 1 < SIZE && nearest[idx + 1] !== cell) ||
        (y + 1 < SIZE && nearest[idx + SIZE] !== cell);
      const [r, g, b] = seeds[cell].color;
      const pi = idx * 3;
      if (isBorder) {
        buffer[pi] = r * 0.25; buffer[pi + 1] = g * 0.25; buffer[pi + 2] = b * 0.25;
      } else {
        buffer[pi] = r; buffer[pi + 1] = g; buffer[pi + 2] = b;
      }
    }
  }

  await sharp(buffer, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT_DIR, filename));
  console.log('wrote', filename, `(${seedCount} seeds, warp ${warpStrength}, palette: ${style})`);
}

async function main() {
  await generateOne(80, 25, 'voronoi-v2-warp25.jpg');
  await generateOne(80, 45, 'voronoi-v2-warp45.jpg');
  await generateOne(90, 45, 'voronoi-v2-warp45-b.jpg');
  await generateOne(80, 70, 'voronoi-v2-warp70.jpg');
}

main().catch((err) => { console.error(err); process.exit(1); });
