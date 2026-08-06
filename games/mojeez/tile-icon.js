// Generates MOJEEZ's tile icon — a single square tile with a bold "M" in
// it, used for both the hub tile (games-registry.js) and this game's own
// in-game header (see index.js's initShell call) — same single-icon
// convention every other game follows since the 2026-07-29 hub tile
// redesign (see games-registry.js's own header comment), and the same
// rounded-square/shadow/centered-glyph construction as VALUZ's/QUADZ's own
// tile-icon.js, just with MOJEEZ's own color and glyph.

// A warm gold, NOT MOJEEZ's own accent coral-red (#E0787A, see
// games-registry.js's `color`) — this icon sits ON TOP of that same color
// as the hub tile's background (games-registry.js's `emojiImage`), so a
// matching hue would make the icon nearly vanish into its own tile (same
// reasoning as VALUZ's coral-on-purple tile-icon.js).
const TILE_FILL = '#F2B84B';
const GLYPH_COLOR = '#4A1518'; // matches the dark ink used for MOJEEZ's own shell buttons (see index.js's accentColor)

const ICON_RENDER_SIZE = 96;

let cachedDataURL = null;
export function getMojeezTileIconDataURL() {
  if (!cachedDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    const size = ICON_RENDER_SIZE * 0.82;
    const x = ICON_RENDER_SIZE / 2;
    const y = ICON_RENDER_SIZE / 2;
    const radius = size * 0.125;

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = size * 0.08;
    context.shadowOffsetY = size * 0.025;
    context.fillStyle = TILE_FILL;
    context.beginPath();
    context.roundRect(x - size / 2, y - size / 2, size, size, radius);
    context.fill();
    context.restore();

    context.fillStyle = GLYPH_COLOR;
    context.font = `bold ${Math.round(size * 0.58)}px -apple-system, "Segoe UI", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('M', x, y + size * 0.03);

    cachedDataURL = canvas.toDataURL('image/png');
  }
  return cachedDataURL;
}
