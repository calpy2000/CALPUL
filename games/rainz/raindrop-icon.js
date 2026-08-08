// Shared raindrop shape + layered draw — the exact same rendering
// Raindrop.js uses for real falling drops, extracted here so it can ALSO
// build static icons for the hub tile/header (see getRowIconDataURL() and
// getTileIconDataURL() below), the same way games/jewelz's jewel/player/bar
// icons are shared with their live in-game classes.

// Medium-dark slate grey ("Option A" out of four the user compared side by
// side) — picked so the letter stays legible whether a drop is showing its
// full color OR greyed out after being clicked; the original near-white
// text was hard to read against both the near-white highlight/glint AND
// the pale grey clicked state.
export const LETTER_COLOR = '#4b5563';

// The wildcard drop — stands in for any letter at all when a word is
// checked (see index.js's isValidWordWithWildcards()). The Unicode black
// star U+2605 (★) is both the in-game marker used internally (e.g. shown
// as the tile's own text once caught, and in the tile grid — "the answer
// grid" — at the bottom of the game) and what's actually drawn on the
// drop, rendered exactly like any other letter (same font/color/position)
// rather than a custom-drawn shape, per the user's "just use the standard
// symbol" feedback. A dedicated gold palette (not part of Raindrop.
// PALETTE's random rotation — no regular drop is ever this bright/warm)
// plus the pulsing "radar ping" ring below make it unmistakable at a
// glance regardless of the glyph's own size.
export const WILDCARD_LETTER = '★'; // U+2605 BLACK STAR
export const WILDCARD_PALETTE = { light: '#fef9c3', deep: '#ca8a04' };

// Horizontal-only squeeze applied to every drawn drop — "Option B" out of
// four the user compared side by side (a live preview rendered with this
// exact shape code). Narrows the belly while leaving height untouched
// (unlike just shrinking BASE_RADIUS, which would shrink both), because a
// wider canvas (recent change) had made drops visually wide enough to eat
// back into the spawn-gap headroom pickNonOverlappingX() depends on — see
// index.js's MIN_RAINDROP_SEPARATION, which is derived from this same
// constant so the spawn logic's idea of a drop's width always matches what
// actually gets drawn.
export const WIDTH_SCALE = 0.8;

// Vertical-only squeeze, same spirit as WIDTH_SCALE above but independent
// of it — shrinks the drop's height by 10% while leaving its width exactly
// as drawn (WIDTH_SCALE unchanged). Applied as its own scale() axis (see
// drawRaindrop() below) rather than folded into BASE_RADIUS, since changing
// BASE_RADIUS would shrink width too. Raindrop.js's touchesBottom() derives
// its visual-bottom-edge check from this same constant, so the "reaches the
// bottom" game-over trigger stays lined up with what's actually drawn.
export const HEIGHT_SCALE = 0.9;

// The letter is drawn at 1.3x its ORIGINAL size, independent of (i.e. on
// top of) the drop's own 1.2x enlargement (see Raindrop.js's BASE_RADIUS)
// — since the letter grows faster than the drop containing it, it now
// fills more of the drop than before, rather than just scaling up
// alongside it at the same proportion. 0.95 was the original letter-size-
// to-radius ratio; dividing by 1.2 cancels out the automatic scaling the
// letter would otherwise get for free from the drop's own growth (since
// font size is computed as r * ratio), leaving only the letter's own 1.3x
// on top.
const LETTER_RADIUS_RATIO = 0.95 * 1.3 / 1.2; // ≈ 1.029

// How fast the ring's expand-and-fade cycle repeats, in cycles per second —
// matches the pacing shown in the "Radar Ping Ring" preview the user chose.
const WILDCARD_PULSE_SPEED = 0.7;

// Traces the teardrop outline onto the current path — a pointed top, a
// genuine concave pinch just below it, then a fully rounded bottom bulb,
// each side a cubic bezier whose ending tangent is forced to match the
// bulb circle's own tangent at the join (see Raindrop.js's original
// comment for the fuller explanation of why that eliminates the seam).
export function traceRaindropPath(context, cx, cy, r) {
  const gapDeg = 52, heightRatio = 2.2, neckWidth = 0.14, neckHeight = 0.4, endPull = 0.9;
  const gap = gapDeg * (Math.PI / 180);
  const rightAngle = -Math.PI / 2 + gap;
  const leftAngle = -Math.PI / 2 - gap;
  const tipY = cy - r * heightRatio;
  const rightT = { x: cx + r * Math.cos(rightAngle), y: cy + r * Math.sin(rightAngle) };
  const leftT = { x: cx + r * Math.cos(leftAngle), y: cy + r * Math.sin(leftAngle) };
  const tanAt = (angle) => ({ x: -Math.sin(angle), y: Math.cos(angle) });
  const rightTan = tanAt(rightAngle);
  const leftTan = tanAt(leftAngle);
  const ctrl1Right = { x: cx + r * neckWidth, y: tipY + (cy - tipY) * neckHeight };
  const ctrl2Left = { x: cx - r * neckWidth, y: tipY + (cy - tipY) * neckHeight };
  const ctrl2Right = { x: rightT.x - rightTan.x * r * endPull, y: rightT.y - rightTan.y * r * endPull };
  const ctrl1Left = { x: leftT.x + leftTan.x * r * endPull, y: leftT.y + leftTan.y * r * endPull };
  context.beginPath();
  context.moveTo(cx, tipY);
  context.bezierCurveTo(ctrl1Right.x, ctrl1Right.y, ctrl2Right.x, ctrl2Right.y, rightT.x, rightT.y);
  context.arc(cx, cy, r, rightAngle, leftAngle + Math.PI * 2, false);
  context.bezierCurveTo(ctrl1Left.x, ctrl1Left.y, ctrl2Left.x, ctrl2Left.y, cx, tipY);
  context.closePath();
}

// Draws one raindrop centered at (x, y): shadow, gradient base, two
// highlight/glint ellipses, and a centered letter. Doesn't touch
// globalAlpha itself — Raindrop.js's own draw() wraps a call to this in a
// save/globalAlpha/restore for the "clicked" 50%-opacity state; the static
// icons below just call it directly at full opacity. `letter` is optional —
// the header's plain framing drops use no letter at all (see
// getHeaderIconDataURL()), so a falsy letter just skips the fillText.
// `age` (seconds this drop has existed) only matters for a wildcard — it
// drives the expanding/fading ring's phase; defaults to 0 for every other
// caller (row/header/tile icons never pass a wildcard letter, so the ring
// never actually draws for them regardless).
export function drawRaindrop(context, x, y, r, letter, palette, age = 0) {
  // Everything except the letter is drawn in a translate+scale(WIDTH_SCALE,
  // HEIGHT_SCALE) space centered on the drop — an independent per-axis
  // affine squeeze, so the teardrop's bezier/arc math above needs no
  // changes and stays perfectly tangent-continuous (no seam), it's just
  // narrower/shorter. The letter is drawn afterward, outside this
  // transform, so glyphs stay their normal shape instead of getting
  // squished along with the body.
  context.save();
  context.translate(x, y);
  context.scale(WIDTH_SCALE, HEIGHT_SCALE);

  if (letter === WILDCARD_LETTER) {
    // The "radar ping" ring: repeatedly expands outward from the drop and
    // fades out, looping forever — drawn BEFORE the drop's own body so it
    // reads as an aura emanating from behind it, per the animated preview
    // the user picked.
    const phase = (age * WILDCARD_PULSE_SPEED) % 1;
    context.save();
    context.strokeStyle = `rgba(202, 138, 4, ${1 - phase})`;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, r * (1.1 + phase * 0.9), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = r * 0.41;
  context.shadowOffsetY = r * 0.2;
  traceRaindropPath(context, 0, 0, r);
  const gradient = context.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.3);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(1, palette.deep);
  context.fillStyle = gradient;
  context.fill();
  context.restore();

  context.save();
  context.translate(-r * 0.32, -r * 0.25);
  context.rotate(-20 * (Math.PI / 180));
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  context.beginPath();
  context.ellipse(0, 0, r * 0.32, r * 0.16, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.translate(r * 0.28, r * 0.2);
  context.rotate(10 * (Math.PI / 180));
  context.fillStyle = 'rgba(255, 255, 255, 0.3)';
  context.beginPath();
  context.ellipse(0, 0, r * 0.14, r * 0.08, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.restore(); // undo translate+scale before the letter

  if (letter) {
    context.fillStyle = LETTER_COLOR;
    context.font = `700 ${Math.round(r * LETTER_RADIUS_RATIO)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, x, y + r * 0.05);
  }
}

// R-A-I-N-Z, each a different palette entry — R is purple and Z is amber
// specifically per the user's choice for how the header should frame the
// title; the rest fill in the remaining hues for variety.
const ROW_LETTERS = ['R', 'A', 'I', 'N', 'Z'];
const ROW_PALETTES = [
  { light: '#e9d5ff', deep: '#7e22ce' }, // purple — R
  { light: '#bfdbfe', deep: '#1d4ed8' }, // blue — A
  { light: '#fecdd3', deep: '#e11d48' }, // coral — I
  { light: '#99f6e4', deep: '#0f766e' }, // teal — N
  { light: '#fde68a', deep: '#b45309' }, // amber — Z
];

// Teardrops run notably taller than wide (tip-to-bulb-bottom is ~3.2x the
// bulb's own radius), so the render canvas needs real vertical headroom —
// sized generously here rather than tuned to the exact math, then checked
// visually, to avoid clipping the tip.
const DROP_R = 34;
const DROP_HEIGHT = DROP_R * 3.6;

// No letters in the row image either (the hub tile already shows "RAINZ" as
// its own title text right below this row, so letters baked into the drops
// were redundant) — kept 5 drops, one per ROW_PALETTES entry, purely for the
// color variety, same spirit as the header's letter-free drops above.
let cachedRowDataURL = null;
export function getRowIconDataURL() {
  if (!cachedRowDataURL) {
    const gap = DROP_R * 0.3;
    const dropW = DROP_R * 2;
    const width = ROW_LETTERS.length * dropW + (ROW_LETTERS.length - 1) * gap;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = DROP_HEIGHT;
    const context = canvas.getContext('2d');
    const y = DROP_HEIGHT - DROP_R * 1.3;
    let x = DROP_R;
    ROW_PALETTES.forEach((palette, i) => {
      drawRaindrop(context, x, y, DROP_R, null, palette);
      x += dropW + gap;
    });
    cachedRowDataURL = canvas.toDataURL('image/png');
  }
  return cachedRowDataURL;
}

// A single drop, cropped to its own canvas — used for the header's
// start/end framing (see games/rainz/index.js's initShell call). `index`
// picks which of the 5 row letters/colors to render (0 = R, 4 = Z).
const cachedTileDataURLs = new Map();
export function getTileIconDataURL(index) {
  if (!cachedTileDataURLs.has(index)) {
    const width = DROP_R * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = DROP_HEIGHT;
    const context = canvas.getContext('2d');
    const y = DROP_HEIGHT - DROP_R * 1.3;
    drawRaindrop(context, width / 2, y, DROP_R, ROW_LETTERS[index], ROW_PALETTES[index]);
    cachedTileDataURLs.set(index, canvas.toDataURL('image/png'));
  }
  return cachedTileDataURLs.get(index);
}

// Same single-drop framing as getTileIconDataURL(), but with no letter —
// used for the game's own header (see index.js's initShell call), which
// already shows "RAINZ" as text right between the two drops so a letter
// baked into the drop itself would be redundant.
const cachedHeaderDataURLs = new Map();
export function getHeaderIconDataURL(index) {
  if (!cachedHeaderDataURLs.has(index)) {
    const width = DROP_R * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = DROP_HEIGHT;
    const context = canvas.getContext('2d');
    const y = DROP_HEIGHT - DROP_R * 1.3;
    drawRaindrop(context, width / 2, y, DROP_R, null, ROW_PALETTES[index]);
    cachedHeaderDataURLs.set(index, canvas.toDataURL('image/png'));
  }
  return cachedHeaderDataURLs.get(index);
}

// A single wildcard drop, cropped to its own canvas — used inline in the
// instructions text (see index.js's initShell call) so the wildcard
// feature can be explained with the actual game art rather than an emoji.
let cachedWildcardDataURL = null;
export function getWildcardIconDataURL() {
  if (!cachedWildcardDataURL) {
    const width = DROP_R * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = DROP_HEIGHT;
    const context = canvas.getContext('2d');
    const y = DROP_HEIGHT - DROP_R * 1.3;
    drawRaindrop(context, width / 2, y, DROP_R, WILDCARD_LETTER, WILDCARD_PALETTE);
    cachedWildcardDataURL = canvas.toDataURL('image/png');
  }
  return cachedWildcardDataURL;
}
