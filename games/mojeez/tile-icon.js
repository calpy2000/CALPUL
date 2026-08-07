// Generates MOJEEZ's icon — just a large smiley-face emoji, no background
// tile — used for both the hub tile (games-registry.js) and this game's own
// in-game header (see index.js's initShell call). Unlike VALUZ's/QUADZ's own
// tile-icon.js (a rounded-square tile with a centered glyph), this is drawn
// plain and large, same as MUVEEZ's clapperboard/projector icons (see
// games/muveez/icon.js) — per explicit request, no tile background this
// time, just the emoji itself sized to match those other bare icons.

const ICON_RENDER_SIZE = 96;

let cachedDataURL = null;
export function getMojeezTileIconDataURL() {
  if (!cachedDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    const x = ICON_RENDER_SIZE / 2;
    const y = ICON_RENDER_SIZE / 2;

    context.font = `${Math.round(ICON_RENDER_SIZE * 0.92)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🙂', x, y + ICON_RENDER_SIZE * 0.03);

    cachedDataURL = canvas.toDataURL('image/png');
  }
  return cachedDataURL;
}
