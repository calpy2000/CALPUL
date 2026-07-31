// Shared cell renderer — draws either a letter tile or a tick cell in
// QUADZ's own grid style (see games/quadz/style.css's .tile.letter-tile
// and .tile.tick-cell), with one deliberate change: letter tiles are
// filled with a lighter hue of the same amber (#fcd34d instead of
// #f59e0b) rather than the real game's own darker fill, so they contrast
// against the hub tile background instead of nearly vanishing into it
// (QUADZ's hub tile color is that same #f59e0b amber).
//
// Used to build two static images (see getRowIconDataURL() and
// getTileIconDataURL() below) — the hub tile shows a full row (A B C D + a
// tick), while the in-game header uses just the first (A) and last (tick)
// cells to frame the title, the same way JEWELZ/SLYDZ/GLYMPZ frame theirs.

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
