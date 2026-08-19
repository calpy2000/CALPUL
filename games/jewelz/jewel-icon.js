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

// The mega jewel (see index.js's independent mega-jewel spawn timer) — worth
// 50 points and ends the round the instant it's collected, so it needs to
// read as unmistakably different/rarer than the other two at a glance: a
// distinct purple hue, plus a doubled `glowBlur` (see drawFacetedGem below,
// which falls back to 16 for the other two styles that don't set this) so
// it visibly glows harder than any other jewel in the game.
export const MEGA_JEWEL_STYLE = { facets: 10, hue: 275, glowColor: '#a855f7', glowBlur: 32 }; // amethyst

// How fast the gem's facets actually rotate, in radians/sec — PI is a half
// turn per second, i.e. 180 degrees/sec (half of the original 360deg/sec,
// per the user's explicit request to slow it down 0.5x). Previously the
// facets never moved at all; only their brightness cycled via `t`, which
// just made the light look like it was traveling around a stationary gem
// rather than the gem itself spinning.
const SPIN_RATE = Math.PI;

// Draws one faceted gem centered at (x, y) with radius r. `t` is elapsed
// seconds — each facet's brightness cycles via `t` (making the light appear
// to travel around the gem), AND the whole facet layout now physically
// rotates via `t * SPIN_RATE`. `label` (optional — only the bonus jewel
// passes one, its point value "3") is drawn centered on top, INSIDE this
// same rotated coordinate space, so it visibly spins along with the facets
// rather than sitting still on top of a spinning gem.
export function drawFacetedGem(context, x, y, r, style, t, label) {
  context.save();
  context.shadowColor = style.glowColor;
  context.shadowBlur = style.glowBlur || 16;
  // Recenters the origin on the gem and rotates the whole coordinate space —
  // everything below is drawn relative to (0, 0) so it comes out already
  // spun into place, same trick Bar.js uses for its own rotation.
  context.translate(x, y);
  context.rotate(t * SPIN_RATE);
  for (let i = 0; i < style.facets; i++) {
    const a0 = (Math.PI * 2 / style.facets) * i;
    const a1 = a0 + Math.PI * 2 / style.facets;
    const brightness = 0.5 + 0.5 * Math.sin(t * 1.5 + i);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    context.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    context.closePath();
    context.fillStyle = `hsl(${style.hue}, 80%, ${28 + brightness * 45}%)`;
    context.fill();
  }

  if (label) {
    // Light-to-mid grey (not white) with a small glow in the gem's own hue —
    // deliberately smaller/subtler than WARPZ's Energy Orb value text
    // rather than an exact copy, per the user's own explicit spec.
    context.font = `bold ${Math.round(r * 0.7)}px ui-monospace, Consolas, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = style.glowColor;
    context.shadowBlur = r * 0.35;
    context.fillStyle = '#9CA3AF';
    context.fillText(label, 0, r * 0.04);
  }

  context.restore();
}

// These three used to be rendered at runtime onto an off-screen canvas via
// drawFacetedGem() (ICON_PHASE=0.6, same style objects above) and returned
// as a toDataURL() PNG string — deterministic, so every render produced a
// byte-identical image. Precomputed once (2026-08-19) into real PNG files
// instead, since a full-reload navigation was re-running that canvas work
// from scratch on every single visit to this game (and every hub load, via
// games-registry.js) — see project_gamehub_back_button_delay memory for the
// investigation. Resolved relative to THIS file's own location (same
// import.meta.url trick install-gate.js's siteUrl() uses) so it works
// regardless of which page imports it. Regenerate these PNGs from
// drawFacetedGem() + the style constants above if the gem's look ever
// changes.
export function getJewelIconDataURL() {
  return new URL('./images/jewel-icon.png', import.meta.url).href;
}

export function getBonusJewelIconDataURL() {
  return new URL('./images/bonus-jewel-icon.png', import.meta.url).href;
}

export function getMegaJewelIconDataURL() {
  return new URL('./images/mega-jewel-icon.png', import.meta.url).href;
}
