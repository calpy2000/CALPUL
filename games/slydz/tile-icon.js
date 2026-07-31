// Shared tile renderer — draws a single letter tile in SLYDZ's "solved row"
// look (the .valid-word highlight state from style.css: light lavender
// fill, purple text) with an added border in a lighter hue of the hub
// tile's own purple background, picked so the tile reads clearly whether
// it sits on the purple hub tile or the white in-game header.
//
// Used to build two different static images (see getTileRowDataURL() and
// getTileDataURL() below) — the hub tile shows the full "SLYDZ" row, while
// the in-game header uses just the first (S) and last (Z) tiles to frame
// the title, the same way JEWELZ frames its title with two jewel images.

const FILL = '#f3e8ff';
const BORDER = '#d8b4fe'; // a lighter hue of the hub tile's own #a855f7
const TEXT = '#6b21a8';

// Draws one tile centered at (x, y) — `size` is the tile's own width/height
// (it's always square, matching the real in-game tiles). All the other
// proportions (corner radius, border width, font size, shadow) scale off
// `size` so this looks right whether it's rendered small (header icon) or
// as part of a wider row (hub tile).
export function drawTile(context, x, y, size, letter) {
  const radius = size * 0.125;
  const borderWidth = size * 0.045;

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = size * 0.09;
  context.shadowOffsetY = size * 0.03;
  context.fillStyle = FILL;
  context.beginPath();
  context.roundRect(x - size / 2, y - size / 2, size, size, radius);
  context.fill();
  context.restore();

  context.lineWidth = borderWidth;
  context.strokeStyle = BORDER;
  context.beginPath();
  context.roundRect(
    x - size / 2 + borderWidth / 2,
    y - size / 2 + borderWidth / 2,
    size - borderWidth,
    size - borderWidth,
    radius - borderWidth / 2
  );
  context.stroke();

  context.fillStyle = TEXT;
  context.font = `bold ${Math.round(size * 0.62)}px -apple-system, "Segoe UI", Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letter, x, y + size * 0.03);
}

const ICON_RENDER_SIZE = 96; // per-tile resolution for the cached data URLs below

// One tile, cached per letter — used for the header's start/end framing
// (see games/slydz/index.js's initShell call).
const cachedTileDataURLs = new Map();
export function getTileDataURL(letter) {
  if (!cachedTileDataURLs.has(letter)) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawTile(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.82, letter);
    cachedTileDataURLs.set(letter, canvas.toDataURL('image/png'));
  }
  return cachedTileDataURLs.get(letter);
}

// The full "SLYDZ" row, all 5 tiles side by side — used for the hub tile
// (see games-registry.js).
let cachedRowDataURL = null;
export function getTileRowDataURL() {
  if (!cachedRowDataURL) {
    const letters = ['S', 'L', 'Y', 'D', 'Z'];
    const tileSize = ICON_RENDER_SIZE * 0.82;
    const gap = ICON_RENDER_SIZE * 0.06;
    const margin = ICON_RENDER_SIZE * 0.12;
    const width = margin * 2 + letters.length * tileSize + (letters.length - 1) * gap;
    const height = margin * 2 + tileSize;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    letters.forEach((letter, i) => {
      const x = margin + tileSize / 2 + i * (tileSize + gap);
      drawTile(context, x, height / 2, tileSize, letter);
    });
    cachedRowDataURL = canvas.toDataURL('image/png');
  }
  return cachedRowDataURL;
}
