// Builds the "shuffled row" image used in place of GLYMPZ's plain-text
// emoji — a stand-in for one row of the real 6x6 sliding-image puzzle
// (shown as 5 tiles here so the hub tile icon doesn't run too wide). Three
// solid colors (purple/red/green — deliberately NOT blue, so it never
// blends into GLYMPZ's own blue hub tile background) form parallel
// diagonal bands sloping left to right across a 5-tile-wide "master" image.
// Each divider's transition spans HALF the total width (not the full
// width), so every tile shows at least part of a diagonal edge — no tile
// is ever left a single flat, "blank"-looking color block.
// Each tile always shows its OWN fixed slice of that master image (exactly
// like the real sliding puzzle — a tile's content never changes, only its
// grid position does), so laying the slices out of order visibly breaks
// the diagonal into a mismatched step at each wrong tile boundary — the
// same way a real shuffled row of photo tiles looks "not quite right."

const TILE_COUNT = 5;
const TILE = 96; // per-tile render resolution
const PURPLE = '#7e22ce';
const RED = '#dc2626';
const GREEN = '#16a34a';
const BORDER = '#111318';

// Renders the master "solved" 5-tile-wide image once — the three diagonal
// bands span its full width in order (purple, then red, then green).
let cachedMaster = null;
function getMaster() {
  if (cachedMaster) return cachedMaster;

  const master = document.createElement('canvas');
  master.width = TILE * TILE_COUNT;
  master.height = TILE;
  const ctx = master.getContext('2d');
  const W = master.width, H = master.height;
  const half = W / 2;

  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, 0, W, H);

  // Each divider triangle spans HALF the image width (not the full width),
  // so its diagonal edge actually terminates on-canvas — that's what makes
  // the transition visible across every tile rather than only kicking in
  // near the far edge. Both dividers share the same run length (`half`),
  // which keeps their slopes identical — that's what reads as one
  // continuous incline rather than two unrelated diagonals.
  function diagonalTriangle(offset, run) {
    ctx.beginPath();
    ctx.moveTo(offset, H);
    ctx.lineTo(offset + run, 0);
    ctx.lineTo(offset + run, H);
    ctx.closePath();
  }

  ctx.fillStyle = RED;
  diagonalTriangle(0, half);
  ctx.fill();

  ctx.fillStyle = GREEN;
  diagonalTriangle(half, half);
  ctx.fill();

  cachedMaster = master;
  return master;
}

// Draws TILE_COUNT tile-slices from the master image onto `context` at
// (x, y), each `size` square, in `order` — order[i] is which slice
// (0 to TILE_COUNT-1, left to right in the master) gets drawn at position
// i. Dark borders around each tile match the real grid's own tile-vs-tile
// separation.
function drawRow(context, x, y, size, order) {
  const master = getMaster();
  order.forEach((sliceIndex, position) => {
    context.drawImage(
      master,
      sliceIndex * TILE, 0, TILE, TILE,
      x + position * size, y, size, size
    );
  });
  context.strokeStyle = BORDER;
  context.lineWidth = size * 0.03;
  order.forEach((_, position) => {
    context.strokeRect(
      x + position * size + context.lineWidth / 2,
      y + context.lineWidth / 2,
      size - context.lineWidth,
      size - context.lineWidth
    );
  });
}

// A fixed "obviously shuffled" order — picked by eye for a clear, legible
// break in the diagonal at more than one tile boundary. Baked in (not
// re-randomized) since this needs to be the same static image every time.
const SHUFFLED_ORDER = [1, 3, 0, 4, 2];

let cachedRowDataURL = null;
export function getRowIconDataURL() {
  if (!cachedRowDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE * TILE_COUNT;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d');
    drawRow(ctx, 0, 0, TILE, SHUFFLED_ORDER);
    cachedRowDataURL = canvas.toDataURL('image/png');
  }
  return cachedRowDataURL;
}

// A single tile, cropped from the master (solved) image — used for the
// header's start/end framing (see games/glympz/index.js's initShell call).
// `slice` is which of the TILE_COUNT master slices to show (0 =
// first/leftmost, TILE_COUNT-1 = last/rightmost).
const cachedTileDataURLs = new Map();
export function getTileIconDataURL(slice) {
  if (!cachedTileDataURLs.has(slice)) {
    const master = getMaster();
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(master, slice * TILE, 0, TILE, TILE, 0, 0, TILE, TILE);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = TILE * 0.03;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, TILE - ctx.lineWidth, TILE - ctx.lineWidth);
    cachedTileDataURLs.set(slice, canvas.toDataURL('image/png'));
  }
  return cachedTileDataURLs.get(slice);
}
