// Shared beveled-rect + neon-glow-pulse renderer — the exact same drawing
// code Bar.js uses for the actual spinning obstacles (see its draw()),
// extracted here so it can ALSO build a small static "square" icon for use
// inline in text (e.g. the instructions line — see index.js), the same way
// jewel-icon.js's drawFacetedGem is shared between Jewel.js and its icons.

// A beveled-edge rectangle — 4 trapezoid strips around a center fill,
// lighter on top/left (as if lit from upper-left), darker on bottom/right
// (in shadow) — drawn in LOCAL coordinates (the caller has already
// translated so (0,0) is this shape's own center). `bevel` should be
// clamped by the caller to at most a third of the shorter side so it can
// never overlap itself on narrow bars.
export function drawBevelRect(context, w, h, bevel, base, light, dark) {
  const x = -w / 2, y = -h / 2;
  context.fillStyle = base;
  context.fillRect(x, y, w, h);
  context.fillStyle = light;
  context.beginPath();
  context.moveTo(x, y); context.lineTo(x + w, y); context.lineTo(x + w - bevel, y + bevel); context.lineTo(x + bevel, y + bevel);
  context.closePath(); context.fill();
  context.beginPath();
  context.moveTo(x, y); context.lineTo(x + bevel, y + bevel); context.lineTo(x + bevel, y + h - bevel); context.lineTo(x, y + h);
  context.closePath(); context.fill();
  context.fillStyle = dark;
  context.beginPath();
  context.moveTo(x, y + h); context.lineTo(x + bevel, y + h - bevel); context.lineTo(x + w - bevel, y + h - bevel); context.lineTo(x + w, y + h);
  context.closePath(); context.fill();
  context.beginPath();
  context.moveTo(x + w, y); context.lineTo(x + w - bevel, y + bevel); context.lineTo(x + w - bevel, y + h - bevel); context.lineTo(x + w, y + h);
  context.closePath(); context.fill();
}

// Draws a beveled square (rather than Bar's own tall rectangle) at (x, y),
// neon-glowing in `hue`, pulsing via `t` — same math as Bar.js's draw().
export function drawBevelSquare(context, x, y, size, hue, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
  const bevel = Math.min(6, size / 3);

  context.save();
  context.translate(x, y);
  context.save();
  context.shadowColor = `hsl(${hue}, 100%, 60%)`;
  context.shadowBlur = 10 + pulse * 30;
  drawBevelRect(context, size, size, bevel,
    `hsl(${hue}, 90%, ${42 + pulse * 10}%)`,
    `hsl(${hue}, 90%, ${68 + pulse * 15}%)`,
    `hsl(${hue}, 85%, ${18 + pulse * 6}%)`);
  context.restore();
  context.fillStyle = `rgba(255,255,255,${0.35 + pulse * 0.4})`;
  context.fillRect(-size * 0.09, -size / 2 + bevel, size * 0.18, size - bevel * 2);
  context.restore();
}

// Cyan — the first of Bar.js's own neonHues cycle — and a fixed animation
// phase the static icon freezes on (mid-pulse, clearly lit).
const ICON_HUE = 175;
const ICON_PHASE = 0.6;
const ICON_RENDER_SIZE = 128;

let cachedBarIconDataURL = null;
export function getBarIconDataURL() {
  if (!cachedBarIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawBevelSquare(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.7, ICON_HUE, ICON_PHASE);
    cachedBarIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedBarIconDataURL;
}

// A landscape (3:1) bar icon for the instructions text (see index.js) —
// real bars are tall and spin through every angle in play (see Bar.js),
// but a bar laid on its side, long and thin, reads more clearly as "a bar"
// in a small static inline icon than the square used above.
let cachedHorizontalBarIconDataURL = null;
export function getHorizontalBarIconDataURL() {
  if (!cachedHorizontalBarIconDataURL) {
    const canvasW = 180, canvasH = 60;
    const barW = 165, barH = 55; // 3:1
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const context = canvas.getContext('2d');
    const pulse = 0.5 + 0.5 * Math.sin(ICON_PHASE * 2.5);
    const bevel = Math.min(6, barW / 3, barH / 3);

    context.save();
    context.translate(canvasW / 2, canvasH / 2);
    context.save();
    context.shadowColor = `hsl(${ICON_HUE}, 100%, 60%)`;
    context.shadowBlur = 10 + pulse * 30;
    drawBevelRect(context, barW, barH, bevel,
      `hsl(${ICON_HUE}, 90%, ${42 + pulse * 10}%)`,
      `hsl(${ICON_HUE}, 90%, ${68 + pulse * 15}%)`,
      `hsl(${ICON_HUE}, 85%, ${18 + pulse * 6}%)`);
    context.restore();
    // Horizontal highlight streak — rotated 90° from the square icon's own
    // vertical one above, matching this bar's landscape orientation.
    context.fillStyle = `rgba(255,255,255,${0.35 + pulse * 0.4})`;
    context.fillRect(-barW / 2 + bevel, -barH * 0.09, barW - bevel * 2, barH * 0.18);
    context.restore();

    cachedHorizontalBarIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedHorizontalBarIconDataURL;
}
