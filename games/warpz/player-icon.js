// Draws the player: the original warm 3D "glass bubble" face JEWELZ uses
// (unchanged — same radial-gradient-plus-highlight language, same eyes/
// blink/mouth), now framed by a space helmet — picked across several
// rounds of visual exploration: a thin glowing dome outline + strap lines
// + antenna ("Minimal Outline Dome"), plus a cyan dome-shaped visor with a
// shallow-curved bottom edge sitting just below eye level.
//
// `t` is elapsed seconds (index.js passes survivalTime) — drives the same
// idle bob/blink as before, plus the antenna light's own slow pulse.

// The original face, unchanged from before the helmet was added — kept
// separate (not exported) so the helmet/visor layers below can be drawn
// in between it and the outer dome frame. Returns the bobbed center Y so
// the helmet/visor can stay aligned to the same bob.
function drawFace(context, x, y, r, t) {
  const bob = Math.sin(t * 2) * (r * 0.05);
  const cy = y + bob;

  const grad = context.createRadialGradient(x - r * 0.35, cy - r * 0.35, r * 0.1, x, cy, r);
  grad.addColorStop(0, '#ffe9b8');
  grad.addColorStop(0.55, '#ffb84d');
  grad.addColorStop(1, '#c76a10');

  context.save();
  context.beginPath();
  context.arc(x, cy, r, 0, Math.PI * 2);
  context.fillStyle = grad;
  context.shadowColor = 'rgba(255, 180, 60, 0.55)';
  context.shadowBlur = r * 0.4;
  context.fill();
  context.shadowBlur = 0;

  // Glossy highlight, upper-left
  context.beginPath();
  context.ellipse(x - r * 0.32, cy - r * 0.38, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  context.fill();

  // Face — eyes squash almost shut for one frame every so often, read as a blink
  const blink = Math.sin(t * 1.7) > 0.96 ? 0.15 : 1;
  context.fillStyle = '#3a2410';
  context.beginPath();
  context.ellipse(x - r * 0.28, cy - r * 0.05, r * 0.1, r * 0.13 * blink, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.ellipse(x + r * 0.28, cy - r * 0.05, r * 0.1, r * 0.13 * blink, 0, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.arc(x, cy + r * 0.18, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI);
  context.strokeStyle = '#3a2410';
  context.lineWidth = Math.max(1.5, r * 0.065);
  context.lineCap = 'round';
  context.stroke();

  context.restore();
  return cy;
}

const VISOR_FILL = 'rgba(150, 225, 255, 0.32)';
const VISOR_EDGE = 'rgba(190, 235, 255, 0.85)';
const VISOR_HIGHLIGHT = 'rgba(255, 255, 255, 0.4)';

// A dome-shaped visor (not a plain ellipse — an ellipse's own taper would
// otherwise cut across the eyes) with a shallow-curved bottom edge just
// below eye level, drawn over the face before the outer helmet frame goes
// on top. Traced as one path — a top arc from an oversized ellipse (so it
// safely covers both eyes, not just grazes them), then a quadratic curve
// bottom — reused for both the fill/stroke pass and (clipped) the glass
// highlight pass.
function drawVisor(context, x, cy, r) {
  const domeCenterY = cy - r * 0.38;
  const domeHalfW = r * 0.98;
  const domeHalfH = r * 0.66;
  const bottomHalfW = r * 0.84;
  const sideBottomY = cy + r * 0.12;
  const bulgeControlY = cy + r * 0.24;

  function tracePath() {
    context.beginPath();
    context.ellipse(x, domeCenterY, domeHalfW, domeHalfH, 0, Math.PI, Math.PI * 2, false);
    context.lineTo(x + bottomHalfW, sideBottomY);
    context.quadraticCurveTo(x, bulgeControlY, x - bottomHalfW, sideBottomY);
    context.closePath();
  }

  context.save();
  tracePath();
  context.fillStyle = VISOR_FILL;
  context.fill();
  context.lineWidth = Math.max(1.5, r * 0.038);
  context.strokeStyle = VISOR_EDGE;
  context.stroke();
  context.restore();

  context.save();
  tracePath();
  context.clip();
  context.beginPath();
  context.ellipse(x - domeHalfW * 0.3, domeCenterY - domeHalfH * 0.4, domeHalfW * 0.4, domeHalfH * 0.22, -0.5, 0, Math.PI * 2);
  context.fillStyle = VISOR_HIGHLIGHT;
  context.fill();
  context.restore();
}

// The outer helmet frame: a thin glowing dome outline over the top of the
// head, two strap lines at the sides, and a small antenna with a slowly
// pulsing light — the lightest-touch of the helmet concepts explored,
// deliberately just an accent around the existing face rather than a
// wholesale reskin of it.
// `showAntenna` defaults to true so every existing caller (icon generation,
// the instructions panel image) is unaffected — only the live in-game draw
// call passes it explicitly, per the user's WARPZ-station spec: the
// antenna disappears while the player is inside the station (a plain
// visibility toggle, no animation, since "no animation required" was the
// explicit call) and reappears once they emerge.
function drawHelmetFrame(context, x, cy, r, t, showAntenna) {
  context.save();
  context.beginPath();
  context.arc(x, cy, r * 1.08, Math.PI * 1.05, Math.PI * 1.95);
  context.lineWidth = Math.max(1.5, r * 0.05);
  context.strokeStyle = 'rgba(210, 225, 255, 0.75)';
  context.shadowColor = 'rgba(150, 190, 255, 0.5)';
  context.shadowBlur = r * 0.15;
  context.stroke();
  context.shadowBlur = 0;
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(210, 225, 255, 0.6)';
  context.lineWidth = Math.max(1.5, r * 0.045);
  context.beginPath();
  context.moveTo(x - r * 1.05, cy + r * 0.05);
  context.lineTo(x - r * 0.85, cy + r * 0.55);
  context.moveTo(x + r * 1.05, cy + r * 0.05);
  context.lineTo(x + r * 0.85, cy + r * 0.55);
  context.stroke();
  context.restore();

  if (showAntenna) {
    context.save();
    context.strokeStyle = 'rgba(210, 225, 255, 0.75)';
    context.lineWidth = Math.max(1.5, r * 0.045);
    context.beginPath();
    context.moveTo(x + r * 0.45, cy - r * 1.15);
    context.lineTo(x + r * 0.65, cy - r * 1.48);
    context.stroke();
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    context.fillStyle = `rgba(255, 90, 90, ${0.5 + pulse * 0.5})`;
    context.beginPath();
    context.arc(x + r * 0.65, cy - r * 1.48, r * 0.075, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

export function drawPlayerFace(context, x, y, r, t, showAntenna = true) {
  const cy = drawFace(context, x, y, r, t);
  drawVisor(context, x, cy, r);
  drawHelmetFrame(context, x, cy, r, t, showAntenna);
}

// A fixed animation phase the static icon freezes on (no blink, a slight
// smile-forward bob) — same idea as jewel-icon.js's ICON_PHASE.
const ICON_PHASE = 1.0;
const ICON_RENDER_SIZE = 128;

// Renders the player once onto an off-screen (never-attached) canvas and
// returns it as a PNG data URL — used as a plain <img src="..."> anywhere
// the game needs to refer to "the player" outside the actual canvas, e.g.
// the instructions text (see index.js).
let cachedPlayerIconDataURL = null;
export function getPlayerIconDataURL() {
  if (!cachedPlayerIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');
    drawPlayerFace(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.4, ICON_PHASE);
    cachedPlayerIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedPlayerIconDataURL;
}
