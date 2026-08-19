// Shared serrated saw-blade renderer — the exact same drawing code Bar.js
// uses for the actual spinning obstacles (see its draw()), extracted here
// so it can ALSO build small static icons for use inline in text (e.g. the
// instructions line — see index.js), the same way jewel-icon.js's
// drawFacetedGem is shared between Jewel.js and its icons.
//
// Replaced the old glossy neon-bevel look (2026-08-07) — testers reported
// the obstacle bars read as jewels themselves, since that bevel/glow/shine
// treatment was the exact same visual language the collectible jewels use,
// just a different shape. This drops the shine entirely: a matte
// brushed-metal gradient (no hue variety — every blade is the same steel
// color now) with serrated teeth and a red hazard glow instead.

// Draws a saw-blade silhouette in LOCAL coordinates (the caller has already
// translated/rotated so (0,0) is this blade's own center and its own
// current spin angle). Teeth are a FIXED physical size (`toothSize`), not a
// fixed count — a longer/taller blade naturally grows more teeth instead of
// the same handful stretched thin across it. `pulse` (0-1) drives the same
// breathing glow every other pulsing element in this game uses.
export function drawSawBlade(context, w, h, pulse) {
  const toothSize = 13;
  const teeth = Math.max(2, Math.round(h / toothSize));
  const step = h / teeth;

  context.save();
  context.shadowColor = 'hsl(4, 100%, 58%)';
  context.shadowBlur = 18 + pulse * 40;
  context.beginPath();
  context.moveTo(-w / 2, -h / 2);
  context.lineTo(w / 2, -h / 2);
  for (let i = 0; i < teeth; i++) {
    const y0 = -h / 2 + i * step;
    context.lineTo(w / 2 + 7, y0 + step * 0.5);
    context.lineTo(w / 2, y0 + step);
  }
  context.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) {
    const y0 = -h / 2 + i * step;
    context.lineTo(-w / 2 - 7, y0 + step * 0.5);
    context.lineTo(-w / 2, y0);
  }
  context.closePath();
  const gradient = context.createLinearGradient(-w / 2, 0, w / 2, 0);
  gradient.addColorStop(0, `hsl(220, 8%, ${20 + pulse * 6}%)`);
  gradient.addColorStop(0.5, `hsl(220, 6%, ${55 + pulse * 10}%)`);
  gradient.addColorStop(1, `hsl(220, 8%, ${20 + pulse * 6}%)`);
  context.fillStyle = gradient;
  context.fill();
  context.restore(); // shadow only applies to the fill above, not the outline/hub below

  context.strokeStyle = `rgba(220, 60, 40, ${0.55 + pulse * 0.35})`;
  context.lineWidth = 2;
  context.stroke();

  // Center bolt/hub, like a real blade's mounting point.
  context.fillStyle = 'hsl(220, 8%, 30%)';
  context.beginPath();
  context.arc(0, 0, Math.min(5, w / 5), 0, Math.PI * 2);
  context.fill();
}

// Fixed animation phase the static icons below freeze on — same pulse math
// as Bar.js's own age-based glow (0.5 + 0.5*sin(phase*2.5)), just evaluated
// once at a phase that's clearly mid-glow rather than at rest.
const ICON_PHASE = 0.6;
function iconPulse() {
  return 0.5 + 0.5 * Math.sin(ICON_PHASE * 2.5);
}

const ICON_RENDER_SIZE = 128;

let cachedBarIconDataURL = null;
export function getBarIconDataURL() {
  if (!cachedBarIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    context.translate(ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2);
    drawSawBlade(context, ICON_RENDER_SIZE * 0.42, ICON_RENDER_SIZE * 0.72, iconPulse());
    cachedBarIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedBarIconDataURL;
}

// A landscape (3:1) blade icon for the instructions text (see index.js) —
// real blades are tall and spin through every angle in play (see Bar.js),
// but one laid on its side, long and thin, reads more clearly as "a blade"
// in a small static inline icon than the square used above.
//
// Used to be rendered at runtime onto an off-screen canvas (rotated 90°,
// same drawSawBlade() call, ICON_PHASE=0.6) and returned as a toDataURL()
// PNG string every single visit — precomputed once (2026-08-19) into a real
// PNG file instead, same reasoning as jewel-icon.js's own version of this
// change (see that file and project_gamehub_back_button_delay memory).
// Regenerate from drawSawBlade() above if the blade's look ever changes.
export function getHorizontalBarIconDataURL() {
  return new URL('./images/horizontal-bar-icon.png', import.meta.url).href;
}
