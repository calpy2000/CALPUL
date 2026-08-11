// Shared cell renderer — draws either a letter tile or a tick cell in
// QUADZ's own grid style (see games/quadz/style.css's .tile.letter-tile
// and .tile.tick-cell), with one deliberate change: letter tiles are
// filled with a lighter hue of the same amber (#fcd34d instead of
// #f59e0b) rather than the real game's own darker fill, so they contrast
// against the hub tile background instead of nearly vanishing into it
// (QUADZ's hub tile color is that same #f59e0b amber).
//
// getCheckerboardIconDataURL() below (a 4x4 grid echoing the real board's
// own shape) is what's actually used today, for both the hub tile
// (games-registry.js) and the in-game header (this game's own index.js) —
// drawCell()/getTileIconDataURL()/getRowIconDataURL() are the earlier
// single-tick-cell icon, kept as dead code rather than deleted in case a
// letter/tick cell is wanted again somewhere.

const LETTER_FILL = '#fcd34d'; // a lighter hue of QUADZ's own #f59e0b accent
const LETTER_TEXT = '#451a03'; // dark brown — matches the real game's letter-tile text
const TICK_FILL = '#fdf6e8'; // faint warm neutral, same as the real game's tick cells
const TICK_COLOR = '#16a34a'; // green, same as the real game's tick mark

// Draws one cell centered at (x, y) — `size` is its own width/height
// (always square). `content` is either a letter or '✓' (a tick cell).
export function drawCell(context, x, y, size, content, isTick) {
  const radius = size * 0.125;

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = size * 0.08;
  context.shadowOffsetY = size * 0.025;
  context.fillStyle = isTick ? TICK_FILL : LETTER_FILL;
  context.beginPath();
  context.roundRect(x - size / 2, y - size / 2, size, size, radius);
  context.fill();
  context.restore();

  context.fillStyle = isTick ? TICK_COLOR : LETTER_TEXT;
  context.font = `bold ${Math.round(size * (isTick ? 0.55 : 0.5))}px -apple-system, "Segoe UI", Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(content, x, y + size * 0.03);
}

const ICON_RENDER_SIZE = 96;

// Approved from a set of mockup options: a 4x4 checkerboard (echoing the
// real board's own shape, rather than a single cell) in three colors —
// the letter-tile amber, the tick-mark green, and a deep brown standing in
// for a fourth mockup pass's washed-out cream, which didn't hold up against
// a white background. Arranged on the diagonal (each row shifted by one
// color) so no two touching cells, including diagonally-adjacent ones
// across the gap, repeat.
const CHECKER_GREEN = '#86efac'; // softer than the real tick-mark green (TICK_COLOR) — that reads too dark at checkerboard-cell size
const CHECKER_COLORS = [LETTER_FILL, '#78350f', CHECKER_GREEN]; // amber, deep brown, soft green
const CHECKER_PATTERN = [
  [0, 1, 2, 0],
  [2, 0, 1, 2],
  [1, 2, 0, 1],
  [0, 1, 2, 0],
];

export function drawCheckerboard(context, x, y, size) {
  const outerRadius = size * 0.14;
  const left = x - size / 2;
  const top = y - size / 2;

  // Drop shadow behind the whole tile, matching drawCell()'s own shadow
  // treatment — cast from a solid fill that gets fully painted over once
  // the actual checkerboard cells are drawn on top of it.
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = size * 0.08;
  context.shadowOffsetY = size * 0.025;
  context.fillStyle = CHECKER_COLORS[0];
  context.beginPath();
  context.roundRect(left, top, size, size, outerRadius);
  context.fill();
  context.restore();

  // Clip to the outer rounded square so the corner cells' own square
  // corners never poke past the tile's rounded silhouette, then draw the
  // 4x4 grid of individually-rounded cells inside it.
  context.save();
  context.beginPath();
  context.roundRect(left, top, size, size, outerRadius);
  context.clip();

  const gap = size * 0.035;
  const cellSize = (size - gap * 3) / 4;
  const cellRadius = cellSize * 0.22;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const cellX = left + col * (cellSize + gap);
      const cellY = top + row * (cellSize + gap);
      context.fillStyle = CHECKER_COLORS[CHECKER_PATTERN[row][col]];
      context.beginPath();
      context.roundRect(cellX, cellY, cellSize, cellSize, cellRadius);
      context.fill();
    }
  }
  context.restore();
}

let cachedCheckerboardDataURL = null;
export function getCheckerboardIconDataURL() {
  if (!cachedCheckerboardDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawCheckerboard(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.82);
    cachedCheckerboardDataURL = canvas.toDataURL('image/png');
  }
  return cachedCheckerboardDataURL;
}

// One cell, cached per content — used for the header's start/end framing.
const cachedCellDataURLs = new Map();
export function getTileIconDataURL(content, isTick = false) {
  const key = `${content}:${isTick}`;
  if (!cachedCellDataURLs.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawCell(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.82, content, isTick);
    cachedCellDataURLs.set(key, canvas.toDataURL('image/png'));
  }
  return cachedCellDataURLs.get(key);
}

// A B C D + a tick, all 5 cells side by side — used for the hub tile.
let cachedRowDataURL = null;
export function getRowIconDataURL() {
  if (!cachedRowDataURL) {
    const cells = [
      { content: 'A', isTick: false },
      { content: 'B', isTick: false },
      { content: 'C', isTick: false },
      { content: 'D', isTick: false },
      { content: '✓', isTick: true },
    ];
    const tileSize = ICON_RENDER_SIZE * 0.82;
    const gap = ICON_RENDER_SIZE * 0.06;
    const margin = ICON_RENDER_SIZE * 0.12;
    const width = margin * 2 + cells.length * tileSize + (cells.length - 1) * gap;
    const height = margin * 2 + tileSize;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    cells.forEach((cell, i) => {
      const x = margin + tileSize / 2 + i * (tileSize + gap);
      drawCell(context, x, height / 2, tileSize, cell.content, cell.isTick);
    });
    cachedRowDataURL = canvas.toDataURL('image/png');
  }
  return cachedRowDataURL;
}
