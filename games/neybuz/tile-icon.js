// Hub tile / in-game header icon: a 2x2 checkerboard of the same red/green
// pair the board itself uses for "not yet correct" / "correct", no letters —
// same "echo the real board's own shape" approach as QUADZ's 4x4 checkerboard
// (games/quadz/tile-icon.js), just 2x2 and alternating red/green instead of
// a 3-color diagonal pattern, since NEYBUZ only ever has two tile states.

const RED_FILL = '#F7CBC5'; // same pastel red the board's own "not yet correct" tiles use
const GREEN_FILL = '#C3ECD3'; // same pastel green the board's own "correct" tiles use
const CHECKER_PATTERN = [
  [0, 1],
  [1, 0],
]; // 0 = red, 1 = green — diagonal pair so no two touching cells match
const CHECKER_COLORS = [RED_FILL, GREEN_FILL];

export function drawNeybuzIcon(context, x, y, size) {
  const outerRadius = size * 0.14;
  const left = x - size / 2;
  const top = y - size / 2;

  // Drop shadow behind the whole tile, same treatment as every other game's
  // canvas icon (see e.g. QUADZ's drawCheckerboard).
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = size * 0.08;
  context.shadowOffsetY = size * 0.025;
  context.fillStyle = CHECKER_COLORS[0];
  context.beginPath();
  context.roundRect(left, top, size, size, outerRadius);
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.roundRect(left, top, size, size, outerRadius);
  context.clip();

  const gap = size * 0.05;
  const cellSize = (size - gap) / 2;
  const cellRadius = cellSize * 0.22;

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
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

const ICON_RENDER_SIZE = 96;
let cachedIconDataURL = null;
export function getNeybuzIconDataURL() {
  if (!cachedIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawNeybuzIcon(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.82);
    cachedIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedIconDataURL;
}
