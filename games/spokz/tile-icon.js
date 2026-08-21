// SPOKZ's hub-tile / in-game-header icon — a literal miniature of the real
// board's own six-spoke star (center circle + 6 spokes of 3 dots each),
// same "echo the real board shape" convention as QUADZ's checkerboard (see
// games/quadz/tile-icon.js). No backdrop square behind it — unlike QUADZ's
// checkerboard, the star sits directly on the hub tile's own flat yellow
// (a backdrop square was tried first and dropped: with dots close in
// lightness to the tile, plus a second yellow layer behind them, the icon
// read as barely-there). Emerald green dots + a burnt-orange center circle
// instead, both picked from a swatch comparison specifically for contrast
// against SPOKZ's pastel yellow (games-registry.js's own `color` for this
// game). No letter in the center circle — approved separately, from a set
// of mockup options where the letter was illegible at hub-tile size; the
// circle alone reads clearly as "the center everything points to."
//
// Center-circle radius (17, in the 0-100 unit design space below) and the
// resulting ring radii/dot size were picked together in an earlier mockup
// pass: as the center circle grows, the 3 rings of dots get pushed outward
// and slightly shrunk (computeLayout()) so nothing overlaps within the same
// fixed 0-100 canvas the real game's own star math uses (see index.js's
// SPOKE_ANGLES_DEG/POS_RADII_PCT — this file's numbers are that same
// design, just re-fitted to leave room for a much bigger center circle).

const DOT_FILL = '#3A9A63'; // emerald green — the 18 spoke dots
const CENTER_FILL = '#B5651D'; // burnt orange — the one center circle

const SPOKE_ANGLES_DEG = [-90, -30, 30, 90, 150, 210]; // 12, 2, 4, 6, 8, 10 o'clock

const CENTER_R = 17;
const OUTER_LIMIT = 47; // farthest any dot's outer edge may reach from center, in the 0-100 design space
const RING_GAP = 1.6;

function computeLayout() {
  const available = OUTER_LIMIT - CENTER_R;
  const dotR = Math.max(3, (available - 3 * RING_GAP) / 6);
  const r1 = CENTER_R + RING_GAP + dotR;
  const r2 = r1 + RING_GAP + 2 * dotR;
  const r3 = r2 + RING_GAP + 2 * dotR;
  return { dotR, radii: [r1, r2, r3] };
}
const { dotR: DOT_R, radii: RING_RADII } = computeLayout();

// Draws the icon centered at (x, y), `size` is its own width/height (always
// square) — same signature shape as QUADZ's drawCheckerboard(), so both
// slot into games-registry.js/tile-icon usage the same way. No background
// fill of its own: the hub tile (or in-game header) behind it shows through
// directly.
export function drawSpokzIcon(context, x, y, size) {
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = size * 0.06;
  context.shadowOffsetY = size * 0.02;

  const scale = size / 100; // the star's own design space is a fixed 0-100 unit box, scaled to fit `size`
  SPOKE_ANGLES_DEG.forEach((angleDeg) => {
    const angle = (angleDeg * Math.PI) / 180;
    RING_RADII.forEach((rUnits) => {
      const r = rUnits * scale;
      const dx = x + r * Math.cos(angle);
      const dy = y + r * Math.sin(angle);
      context.beginPath();
      context.arc(dx, dy, DOT_R * scale, 0, Math.PI * 2);
      context.fillStyle = DOT_FILL;
      context.fill();
    });
  });

  context.beginPath();
  context.arc(x, y, CENTER_R * scale, 0, Math.PI * 2);
  context.fillStyle = CENTER_FILL;
  context.fill();
  context.restore();
}

// Static PNG (images/tile-icon.png), not a runtime canvas render — this
// function used to draw + toDataURL() on every single page load (module
// scope, unconditional), which is exactly the class of per-visit cost that
// was root-caused as a contributor to the "long delay tapping back to the
// hub" bug on JEWELZ/WARPZ (see project_gamehub_back_button_delay memory)
// and, once audited, confirmed here too. drawSpokzIcon() above is UNCHANGED
// and still the source of truth if this icon's design ever needs to
// change — regenerate images/tile-icon.png from it (e.g. via a headless
// Chrome + CDP one-off, see that same memory's own note on the technique)
// rather than hand-editing the PNG. import.meta.url-relative, not a bare
// relative path — see sw-keepalive.js's own comment for why that matters.
export function getSpokzIconDataURL() {
  return new URL('./images/tile-icon.png', import.meta.url).href;
}
