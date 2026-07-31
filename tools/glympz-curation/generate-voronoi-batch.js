// Generates a full batch of curved-boundary Voronoi images (see
// generate-voronoi-v2.js for the technique explanation) directly into
// GLYMPZ's real images/ folder, filling specific day numbers. Each image
// randomizes seed count, warp strength (25-70, per the user's "mix it up"
// choice), and color palette style, so the batch has natural variety
// rather than looking like copies of each other.
//
// Usage: node generate-voronoi-batch.js <startDay> <count>
//   e.g. node generate-voronoi-batch.js 1 20   -> writes days 1-20

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'glympz', 'images');
const SIZE = 500;

function rand(min, max) { return Math.random() * (max - min) + min; }

function makeNoise2D(seed) {
  const p1 = seed * 12.9898, p2 = seed * 78.233, p3 = seed * 37.719;
  return (x, y) =>
    Math.sin(x * 0.012 + p1) * Math.cos(y * 0.015 + p2) +
    Math.sin((x * 0.021 + y * 0.017) + p3) * 0.6;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function generatePalette(count) {
  const style = ['rainbow', 'warm', 'cool', 'pastel', 'jewel'][Math.floor(rand(0, 5))];
  const colors = [];
  for (let i = 0; i < count; i++) {
    let h, s, l;
    if (style === 'rainbow') { h = rand(0, 360); s = rand(65, 90); l = rand(45, 60); }
    else if (style === 'warm') { h = rand(-20, 60); s = rand(70, 95); l = rand(45, 65); }
    else if (style === 'cool') { h = rand(150, 280); s = rand(60, 90); l = rand(40, 60); }
    else if (style === 'pastel') { h = rand(0, 360); s = rand(45, 65); l = rand(70, 82); }
    else { h = rand(0, 360); s = rand(75, 100); l = rand(30, 45); }
    colors.push(hslToRgb((h + 360) % 360, s, l));
  }
  return { style, colors };
}

async function generateOne(dayNumber) {
  const seedCount = Math.round(rand(70, 100));
  const warpStrength = rand(25, 70);
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
    .toFile(path.join(IMAGES_DIR, `${dayNumber}.jpg`));
  console.log(`day ${dayNumber}: ${seedCount} seeds, warp ${warpStrength.toFixed(1)}, palette ${style}`);
}

async function main() {
  const startDay = parseInt(process.argv[2], 10);
  const count = parseInt(process.argv[3], 10);
  if (!startDay || !count) {
    console.error('Usage: node generate-voronoi-batch.js <startDay> <count>');
    process.exit(1);
  }
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  for (let i = 0; i < count; i++) {
    await generateOne(startDay + i);
  }
  console.log(`\nDone. Wrote days ${startDay}-${startDay + count - 1}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
