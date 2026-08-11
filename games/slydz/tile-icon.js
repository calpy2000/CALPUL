// Shared tile renderer — draws SLYDZ's own tile "box" (the .valid-word
// highlight look from style.css: light lavender fill, purple border) either
// with a letter inside (drawTile, still used by the dead-code row-icon
// below) or, since this is what's actually shown on the hub tile and in the
// in-game header, a squiggly arrow (drawArrow) evoking a tile sliding into
// place — the box itself (fill/border/radius/shadow) is identical either
// way, only what's drawn on top of it differs.
//
// Used to build the static images below — getArrowIconDataURL() is the one
// actually referenced by games-registry.js and this game's own index.js.

const FILL = '#f3e8ff';
const BORDER = '#d8b4fe'; // a lighter hue of the hub tile's own #a855f7
const TEXT = '#6b21a8';

// Draws just the tile "box" centered at (x, y) — `size` is the tile's own
// width/height (always square, matching the real in-game tiles). All the
// other proportions (corner radius, border width) scale off `size` so this
// looks right whether it's rendered small (header icon) or larger (hub
// tile).
function drawBox(context, x, y, size) {
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
}

export function drawTile(context, x, y, size, letter) {
  drawBox(context, x, y, size);

  context.fillStyle = TEXT;
  context.font = `bold ${Math.round(size * 0.62)}px -apple-system, "Segoe UI", Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letter, x, y + size * 0.03);
}

// Draws the box plus a squiggly "loop and swoosh" arrow (a curl followed by
// a swoosh out to an arrowhead) in the same purple as the letter tiles' own
// text — approved from a set of mockup options as the one that best evoked
// a tile sliding/swapping into place. Coordinates below are lifted directly
// from the approved SVG mockup's path data (a 0-100 viewBox), mapped onto a
// square filling 92% of the tile (`fillFraction`) so it reads clearly even
// at the small hub-tile/header sizes without crowding the box's rounded
// corners.
function drawArrow(context, x, y, size) {
  drawBox(context, x, y, size);

  const fillFraction = 0.92;
  const arrowSize = size * fillFraction;
  const ox = x - arrowSize / 2;
  const oy = y - arrowSize / 2;
  const p = (px, py) => [ox + (px / 100) * arrowSize, oy + (py / 100) * arrowSize];

  context.strokeStyle = TEXT;
  context.lineWidth = (9 / 100) * arrowSize;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // The loop-and-swoosh body: M 20 35 C 20 20,45 20,45 35 C 45 50,20 50,25 62 C 30 74,55 76,78 65
  context.beginPath();
  let [sx, sy] = p(20, 35);
  context.moveTo(sx, sy);
  let c1 = p(20, 20), c2 = p(45, 20), e = p(45, 35);
  context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  c1 = p(45, 50); c2 = p(20, 50); e = p(25, 62);
  context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  c1 = p(30, 74); c2 = p(55, 76); e = p(78, 65);
  context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  context.stroke();

  // The arrowhead: M 65 58 L 80 65 L 70 78
  context.beginPath();
  let [ax, ay] = p(65, 58);
  context.moveTo(ax, ay);
  let [bx, by] = p(80, 65);
  context.lineTo(bx, by);
  let [dx, dy] = p(70, 78);
  context.lineTo(dx, dy);
  context.stroke();
}

const ICON_RENDER_SIZE = 96; // per-tile resolution for the cached data URLs below

// The single arrow tile — used for both the hub tile (games-registry.js)
// and the in-game header (this game's own index.js). Computed once and
// cached since it never varies.
let cachedArrowDataURL = null;
export function getArrowIconDataURL() {
  if (!cachedArrowDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawArrow(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.82);
    cachedArrowDataURL = canvas.toDataURL('image/png');
  }
  return cachedArrowDataURL;
}

// One tile, cached per letter — dead code today (nothing currently calls
// this; the hub tile and header both use the arrow above instead), kept in
// case a letter tile is wanted again somewhere.
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
