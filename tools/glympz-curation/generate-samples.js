// Generates a handful of SAMPLE images (not yet saved into the real GLYMPZ
// images/ folder) for the user to approve the visual STYLE of before mass-
// producing hundreds of these. Two categories, both procedurally generated
// (no external image source, so zero copyright concern and guaranteed
// control over color variety — the whole point of doing these two
// categories this way rather than searching for existing images):
//   - "geometric": colorful abstract patterns
//   - "illusion": classic optical-illusion STYLES (not copies of any
//     specific famous image — these visual effects/concepts aren't
//     copyrightable, only a particular rendering of them is, and this is a
//     fresh one) — checkerboard-shadow contrast, café wall, Zöllner
//     (tilted-line), Fraser spiral, moiré rings
//
// Technique: build an SVG string (easy to describe shapes/colors/gradients
// in), then rasterize it with sharp (already a project dependency from the
// MUVEEZ pipeline) into a square JPEG — no new libraries needed.
//
// Usage: node generate-samples.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, 'samples');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SIZE = 500;

async function renderSvg(svg, filename) {
  await sharp(Buffer.from(svg)).resize(SIZE, SIZE).jpeg({ quality: 90 }).toFile(path.join(OUT_DIR, filename));
  console.log('wrote', filename);
}

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

const PALETTE = ['#e63946', '#f1c40f', '#2a9d8f', '#457b9d', '#f4a261', '#9d4edd', '#06d6a0', '#ff006e', '#3a86ff', '#fb5607'];

// --- Geometric samples ---

// 1. Triangular tessellation: a grid of squares, each split into two
// randomly-colored triangles — guarantees no flat single-color tiles since
// every 1/36th slice of the final image will cross multiple triangles.
function geometricTriangles() {
  const cols = 8;
  const cell = SIZE / cols;
  let shapes = '';
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell, y = r * cell;
      const c1 = pick(PALETTE), c2 = pick(PALETTE);
      shapes += `<polygon points="${x},${y} ${x + cell},${y} ${x},${y + cell}" fill="${c1}"/>`;
      shapes += `<polygon points="${x + cell},${y} ${x + cell},${y + cell} ${x},${y + cell}" fill="${c2}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// 2. Concentric rotated squares, alternating colors, off-center — creates
// strong diagonal/radial variety across the whole frame.
function geometricConcentric() {
  let shapes = `<rect width="${SIZE}" height="${SIZE}" fill="${pick(PALETTE)}"/>`;
  const cx = SIZE * rand(0.3, 0.7), cy = SIZE * rand(0.3, 0.7);
  for (let i = 12; i > 0; i--) {
    const s = i * (SIZE / 14);
    shapes += `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${pick(PALETTE)}" transform="rotate(${i * 7} ${cx} ${cy})" opacity="0.9"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// 3. Scattered rotated polygons over a gradient backdrop.
function geometricScattered() {
  const gradId = 'g1';
  let shapes = `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${pick(PALETTE)}"/><stop offset="1" stop-color="${pick(PALETTE)}"/>
  </linearGradient></defs><rect width="${SIZE}" height="${SIZE}" fill="url(#${gradId})"/>`;
  for (let i = 0; i < 14; i++) {
    const x = rand(0, SIZE), y = rand(0, SIZE), s = rand(40, 140), rot = rand(0, 360);
    const color = pick(PALETTE);
    if (Math.random() < 0.5) {
      shapes += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}" opacity="0.85" transform="rotate(${rot} ${x + s / 2} ${y + s / 2})"/>`;
    } else {
      shapes += `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${color}" opacity="0.85"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// --- Optical illusion samples ---

// 4. Checkerboard-shadow-style contrast illusion: a checkerboard with a
// soft diagonal "shadow" gradient overlaid — squares of the same base color
// read as different shades depending on whether they're "in" the shadow.
function illusionCheckerShadow() {
  const cols = 8, cell = SIZE / cols;
  let shapes = '';
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const light = (r + c) % 2 === 0;
      shapes += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${light ? '#d8d8d8' : '#4a4a4a'}"/>`;
    }
  }
  shapes += `<defs><radialGradient id="shadow" cx="30%" cy="30%" r="80%">
    <stop offset="0" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.55"/>
  </radialGradient></defs><rect width="${SIZE}" height="${SIZE}" fill="url(#shadow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// 5. Café wall illusion: offset rows of black/white "bricks" with thin grey
// mortar lines — the classic effect where perfectly horizontal lines look
// slanted.
function illusionCafeWall() {
  const rows = 10, rowH = SIZE / rows, brick = rowH * 1.4;
  let shapes = `<rect width="${SIZE}" height="${SIZE}" fill="#888"/>`;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brick / 2);
    let x = -offset;
    let black = true;
    while (x < SIZE) {
      shapes += `<rect x="${x}" y="${r * rowH}" width="${brick}" height="${rowH - 2}" fill="${black ? '#111' : '#eee'}"/>`;
      x += brick;
      black = !black;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// 6. Fraser-spiral-style illusion: concentric rings built from short angled
// dashes — reads as a spiral even though every dash belongs to a closed
// circle.
function illusionFraserSpiral() {
  let shapes = `<rect width="${SIZE}" height="${SIZE}" fill="#fefefe"/>`;
  const cx = SIZE / 2, cy = SIZE / 2;
  const rings = 9;
  for (let ring = 1; ring <= rings; ring++) {
    const r = (ring / rings) * (SIZE / 2 - 10);
    const dashes = 16 + ring * 4;
    for (let d = 0; d < dashes; d++) {
      const angle = (d / dashes) * Math.PI * 2;
      const tilt = (ring % 2 === 0) ? 0.35 : -0.35;
      const x1 = cx + Math.cos(angle) * r;
      const y1 = cy + Math.sin(angle) * r;
      const x2 = cx + Math.cos(angle + tilt) * (r + 8);
      const y2 = cy + Math.sin(angle + tilt) * (r + 8);
      shapes += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="black" stroke-width="3"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

// 7. Moiré rings: two overlapping sets of concentric circles slightly
// offset from each other, producing interference-pattern banding.
function illusionMoire() {
  let shapes = `<rect width="${SIZE}" height="${SIZE}" fill="white"/>`;
  function rings(cx, cy, color) {
    let s = '';
    for (let r = 6; r < SIZE; r += 12) {
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4"/>`;
    }
    return s;
  }
  shapes += rings(SIZE * 0.42, SIZE * 0.5, '#000');
  shapes += rings(SIZE * 0.58, SIZE * 0.5, '#c00');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${shapes}</svg>`;
}

async function main() {
  await renderSvg(geometricTriangles(), 'geometric-triangles.jpg');
  await renderSvg(geometricConcentric(), 'geometric-concentric.jpg');
  await renderSvg(geometricScattered(), 'geometric-scattered.jpg');
  await renderSvg(illusionCheckerShadow(), 'illusion-checker-shadow.jpg');
  await renderSvg(illusionCafeWall(), 'illusion-cafe-wall.jpg');
  await renderSvg(illusionFraserSpiral(), 'illusion-fraser-spiral.jpg');
  await renderSvg(illusionMoire(), 'illusion-moire.jpg');
}

main().catch((err) => { console.error(err); process.exit(1); });
