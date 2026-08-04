// Generates VALUZ's question-mark tile icon — a single square tile with a
// bold "?" in it, used for both the hub tile (games-registry.js) and this
// game's own in-game header (see index.js's initShell call), matching the
// single-icon convention every other game follows since the 2026-07-29 hub
// tile redesign (see games-registry.js's own header comment). Same
// rounded-square/shadow/centered-glyph construction as QUADZ's
// tile-icon.js's drawCell(), just with VALUZ's own color and a fixed glyph
// instead of a per-cell one.

// A warm coral-red, NOT VALUZ's own teal (#3FA8A0, see games-registry.js's
// `color`) — this icon sits ON TOP of that same teal as the hub tile's
// background (games-registry.js's `emojiImage`), so using the identical
// hue made the icon nearly vanish into its own tile. Coral sits roughly
// opposite teal on the color wheel (teal's hue is ~175°, this is ~5°),
// giving real contrast against it while still reading fine against the
// game's own white in-game header, where this same icon is reused.
const TILE_FILL = '#E4574B';
const GLYPH_COLOR = '#ffffff';

const ICON_RENDER_SIZE = 96;

let cachedDataURL = null;
export function getQuestionTileIconDataURL() {
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
    context.fillText('?', x, y + size * 0.03);

    cachedDataURL = canvas.toDataURL('image/png');
  }
  return cachedDataURL;
}
