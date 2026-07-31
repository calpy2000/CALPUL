// The "Classic Solid" umbrella the user picked from the umbrella-options
// gallery — a blue dome (scalloped bottom edge, glossy highlight, finial
// ball) on a curved handle. Drawn per-object (not baked into one fused
// image) so each umbrella in index.js's row can become an independent,
// movable game piece later without any rework here; for now index.js just
// draws a static row of these along the canvas bottom.

// Traces the canopy: a dome across the top, then a scalloped bottom edge
// (alternating shallow arcs) reading as the classic umbrella silhouette —
// same bezier/arc-tracing spirit as raindrop-icon.js's teardrop path, just
// a different shape.
function traceCanopy(context, x, y, r, scallops) {
  context.beginPath();
  context.arc(x, y, r, Math.PI, 0, false); // dome: top half, left to right
  const segW = (2 * r) / scallops;
  for (let i = scallops; i >= 1; i--) {
    const startX = x + r - (i - 1) * segW;
    const endX = x + r - i * segW;
    const midX = (startX + endX) / 2;
    context.quadraticCurveTo(midX, y + r * 0.14, endX, y);
  }
  context.closePath();
}

const SCALLOPS = 6;

// The pole/hook/finial were originally the same navy as the canopy's own
// deep gradient stop (#1e3a8a) — nearly identical to the canvas's own dark
// background fill (#1e3a5f), so the handle all but disappeared. A fixed
// light silver reads as a metal shaft/hook regardless of which color a
// given umbrella's canopy uses, and stays visible against the dark canvas.
const HANDLE_COLOR = '#cbd5e1';
const HANDLE_SHADOW = 'rgba(0, 0, 0, 0.4)';

// Draws one umbrella. (cx, domeY) is the canopy's own center — the handle
// hangs below it, the finial ball sits above it, so callers should leave
// roughly 1.15r of headroom above domeY and 1.6r of clearance below it.
// `palette` is a {light, deep} pair (same shape as Raindrop's own palette
// entries) so each umbrella in a row can get a different canopy color.
export function drawUmbrella(context, cx, domeY, r, palette) {
  const grad = context.createLinearGradient(cx, domeY - r, cx, domeY);
  grad.addColorStop(0, palette.light);
  grad.addColorStop(1, palette.deep);

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = r * 0.16;
  context.shadowOffsetY = r * 0.065;
  traceCanopy(context, cx, domeY, r, SCALLOPS);
  context.fillStyle = grad;
  context.fill();
  context.restore();

  // Glossy highlight, clipped to the canopy shape.
  context.save();
  traceCanopy(context, cx, domeY, r, SCALLOPS);
  context.clip();
  context.beginPath();
  context.ellipse(cx - r * 0.35, domeY - r * 0.5, r * 0.35, r * 0.18, -0.4, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.35)';
  context.fill();
  context.restore();

  context.save();
  context.shadowColor = HANDLE_SHADOW;
  context.shadowBlur = r * 0.1;
  context.shadowOffsetY = r * 0.03;

  // Finial ball on top.
  context.fillStyle = HANDLE_COLOR;
  context.beginPath();
  context.arc(cx, domeY - r - r * 0.065, r * 0.08, 0, Math.PI * 2);
  context.fill();

  // Pole + curved hook handle.
  context.beginPath();
  context.moveTo(cx, domeY);
  context.lineTo(cx, domeY + r * 1.15);
  context.bezierCurveTo(cx, domeY + r * 1.55, cx - r * 0.5, domeY + r * 1.55, cx - r * 0.5, domeY + r * 1.15);
  context.strokeStyle = HANDLE_COLOR;
  context.lineWidth = r * 0.11;
  context.lineCap = 'round';
  context.stroke();
  context.restore();
}

// A single umbrella, cropped to its own small canvas — used inline in the
// instructions text (see index.js's initShell call) so the umbrella
// feature can be explained with the actual game art rather than an emoji.
let cachedIconDataURL = null;
export function getUmbrellaIconDataURL() {
  if (!cachedIconDataURL) {
    const r = 30;
    const width = r * 2.2;
    const height = r * 2.9; // dome + finial headroom + handle/hook clearance
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const domeY = height - r * 1.6;
    drawUmbrella(context, width / 2, domeY, r, { light: '#60a5fa', deep: '#1d4ed8' });
    cachedIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedIconDataURL;
}
