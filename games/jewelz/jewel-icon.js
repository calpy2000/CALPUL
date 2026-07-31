// Shared faceted-gem canvas renderer — the exact same drawing code used by
// the live in-game Jewel.js AND the static icon that replaces the 💎 emoji
// in the header/hub tile (see shell.js's `emojiImage` option and the hub
// root index.js), so every rendering of this game's jewel is literally the
// same gem rather than several lookalikes drifting apart over time.
//
// The header/hub-tile icon used to be a second live canvas re-running this
// same draw loop, but that was reverted in favor of a single static PNG
// snapshot (see getJewelIconDataURL below) — simpler, and the resulting
// image can also be attached directly to Share Results as a real file.

// The regular jewel — one look for now (was a random pick between a ruby
// and a sapphire style, simplified down to just the ruby per the user's
// request while they thought about further enhancements later).
export const JEWEL_STYLE = { facets: 8, hue: 350, glowColor: '#f43f5e' }; // ruby

// The bonus jewel (see index.js's jewel-wave state machine) brought back
// the sapphire style that used to be one of the two random regular-jewel
// looks — reused here to visually set the bonus jewel apart from the
// regular ruby one at a glance, on top of its size/label/lifetime.
export const BONUS_JEWEL_STYLE = { facets: 12, hue: 210, glowColor: '#38bdf8' }; // sapphire

// Draws one faceted gem centered at (x, y) with radius r. `t` is elapsed
// seconds — each facet's brightness cycles via `t`, which is what makes the
// light appear to travel around the gem as if it's slowly rotating.
export function drawFacetedGem(context, x, y, r, style, t) {
  context.save();
  context.shadowColor = style.glowColor;
  context.shadowBlur = 16;
  for (let i = 0; i < style.facets; i++) {
    const a0 = (Math.PI * 2 / style.facets) * i;
    const a1 = a0 + Math.PI * 2 / style.facets;
    const brightness = 0.5 + 0.5 * Math.sin(t * 1.5 + i);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    context.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    context.closePath();
    context.fillStyle = `hsl(${style.hue}, 80%, ${28 + brightness * 45}%)`;
    context.fill();
  }
  context.restore();
}

// The fixed animation phase the static icon freezes on — picked by eye for
// a mid-brightness, visibly-faceted look (t=0 would freeze every facet at
// its dimmest, since sin(0)=0).
const ICON_PHASE = 0.6;
const ICON_RENDER_SIZE = 128; // rendered once at a fixed resolution; consumers scale down via CSS

// Renders a gem once onto an off-screen (never-attached) canvas and returns
// it as a PNG data URL. Used as a plain <img src="..."> wherever the emoji
// used to go (see shell.js and the hub root index.js).
function renderIconDataURL(style) {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_RENDER_SIZE;
  canvas.height = ICON_RENDER_SIZE;
  const context = canvas.getContext('2d');
  drawFacetedGem(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.42, style, ICON_PHASE);
  return canvas.toDataURL('image/png');
}

// Cached after the first call each, since neither image ever changes.
let cachedJewelIconDataURL = null;
export function getJewelIconDataURL() {
  if (!cachedJewelIconDataURL) cachedJewelIconDataURL = renderIconDataURL(JEWEL_STYLE);
  return cachedJewelIconDataURL;
}

let cachedBonusJewelIconDataURL = null;
export function getBonusJewelIconDataURL() {
  if (!cachedBonusJewelIconDataURL) cachedBonusJewelIconDataURL = renderIconDataURL(BONUS_JEWEL_STYLE);
  return cachedBonusJewelIconDataURL;
}
