// Draws the player as a warm 3D "glass bubble" — picked by the user from a
// gallery of eight Canvas-drawn avatar concepts (a Pac-Man-style chomper, a
// ghost, a robot, a slime blob, a neon outline, and others also explored)
// to replace the plain 🙂 emoji previously drawn via ctx.fillText(). Same
// radial-gradient-plus-highlight language already used elsewhere in this
// hub for round/gem shapes (see games/rainz/Raindrop.js's bulb, or this
// game's own jewel-icon.js), just warm-toned with a simple face on top.
//
// `t` is elapsed seconds (index.js passes survivalTime) — drives a small
// idle bob and an occasional quick blink, both scaled relative to `r` so
// the animation looks right regardless of how big the player is drawn.
export function drawPlayerFace(context, x, y, r, t) {
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
