// Generates CULUZ's hub-tile/header icon: a pink pentagon with a soft
// "puffy" bevel (light sheen upper-left, dark rim lower-right) — the same
// direction/feel as the hub tile's own CSS bevel (see .hub__tile-badge and
// its "puffy-bevel" comment in the hub's style.css), just painted directly
// into the canvas since that CSS technique (inset box-shadow on the
// element's own box) can't be clipped to an arbitrary pentagon path.
// Drawn with the exact same regular-polygon path math the in-game shapes
// use (see index.js's traceShape()) rather than a separate hand-tuned
// path, so the icon reads as "one of the actual game shapes" rather than a
// bespoke logo.

const PINK = '#F26FA1'; // same pink used in-game for the 'pink' colour option

function tracePentagon(context, cx, cy, r) {
  context.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

const ICON_RENDER_SIZE = 96;

let cachedPentagonDataURL = null;
export function getPentagonIconDataURL() {
  if (!cachedPentagonDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    const cx = ICON_RENDER_SIZE / 2;
    const cy = ICON_RENDER_SIZE / 2;
    const r = ICON_RENDER_SIZE * 0.42;

    // Drop shadow + flat base fill.
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = ICON_RENDER_SIZE * 0.08;
    context.shadowOffsetY = ICON_RENDER_SIZE * 0.025;
    tracePentagon(context, cx, cy, r);
    context.fillStyle = PINK;
    context.fill();
    context.restore();

    // Soft bevel: clip to the pentagon, then lay a diagonal gradient over
    // it — a bright sheen fading in from the top-left, a dark rim fading
    // in toward the bottom-right, transparent (i.e. the flat pink shows
    // through unchanged) across the middle plateau. Same light-upper-left/
    // dark-lower-right direction as every other "puffy" surface on the
    // site, just gradient-painted instead of box-shadow-inset since this
    // needs to follow the pentagon's own silhouette, not a rectangle.
    context.save();
    tracePentagon(context, cx, cy, r);
    context.clip();
    const bevel = context.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    bevel.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    bevel.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    bevel.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
    bevel.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
    context.fillStyle = bevel;
    context.fillRect(cx - r, cy - r, r * 2, r * 2);
    context.restore();

    // Thin dark rim stroke around the whole silhouette for a touch of edge
    // definition — subtle, not a hard outline.
    context.save();
    tracePentagon(context, cx, cy, r);
    context.lineWidth = ICON_RENDER_SIZE * 0.018;
    context.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    context.stroke();
    context.restore();

    cachedPentagonDataURL = canvas.toDataURL('image/png');
  }
  return cachedPentagonDataURL;
}
