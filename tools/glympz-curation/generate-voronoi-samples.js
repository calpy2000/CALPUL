// Second attempt at procedural samples, after feedback that the first batch
// failed the actual point of a SLIDING PUZZLE: regular/repeating patterns
// (the triangle tessellation) make many tiles look interchangeable, and
// large flat color regions (the concentric squares' background/rings) give
// nothing to match against. What actually helps solve a jigsaw-like puzzle
// is IRREGULAR edges/lines crossing tile boundaries at unique points, so
// each tile has a distinctive "fingerprint" where its edge pattern only
// continues correctly into ONE specific neighbor.
//
// Technique: a brute-force Voronoi diagram (scatter N random colored seed
// points, color every pixel by its nearest seed, darken pixels where the
// nearest seed changes between neighbors to draw a visible cell-boundary
// line) rendered as a raw pixel buffer straight into sharp — no SVG, no
// external geometry library, just per-pixel math. Seed COUNT is tuned so
// the average cell is smaller than a single tile (~83px at 500px/6 tiles),
// guaranteeing multiple irregular cells (and their boundary lines) cross
// every tile, not just some.
//
// Usage: node generate-voronoi-samples.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, 'samples');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SIZE = 500;

const PALETTE = ['#e63946', '#f1c40f', '#2a9d8f', '#457b9d', '#f4a261', '#9d4edd', '#06d6a0', '#ff006e', '#3a86ff', '#fb5607', '#ffbe0b', '#8338ec'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rand(min, max) { return Math.random() * (max - min) + min; }

// Generates one Voronoi-pattern image. `seedCount` controls average cell
// size (more seeds = smaller, busier cells).
async function generateVoronoi(seedCount, filename) {
  const seeds = [];
  for (let i = 0; i < seedCount; i++) {
    seeds.push({ x: rand(0, SIZE), y: rand(0, SIZE), color: hexToRgb(PALETTE[i % PALETTE.length]) });
  }

  // For every pixel, find which seed is nearest (brute-force — fine at
  // this resolution/seed-count, finishes in well under a second).
  const nearest = new Int16Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let best = 0, bestDist = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = x - seeds[s].x, dy = y - seeds[s].y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = s; }
      }
      nearest[y * SIZE + x] = best;
    }
  }

  // Paint each pixel its cell's color, then darken any pixel whose
  // nearest-seed differs from its right or bottom neighbor — that's what
  // actually draws a crisp, irregular border line along every cell edge,
  // which is the whole point here (lines crossing tile boundaries).
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
  console.log('wrote', filename, `(${seedCount} seeds)`);
}

async function main() {
  await generateVoronoi(40, 'voronoi-40.jpg');
  await generateVoronoi(80, 'voronoi-80.jpg');
  await generateVoronoi(140, 'voronoi-140.jpg');
}

main().catch((err) => { console.error(err); process.exit(1); });
