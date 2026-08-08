// ==========================================
// MODULE: THE FALLING RAINDROP CLASS
// ==========================================
//
// Same pattern as games/jewelz/Bar.js/Jewel.js — a class so every falling
// drop carries its own data (position, size, speed, color, letter, clicked
// state) but shares the same update()/draw()/containsPoint() behavior.
// index.js's game loop just calls these on each entry in the `raindrops`
// array without needing to know any of this class's internals.
//
// The shape-tracing and layered drawing itself is shared with
// raindrop-icon.js's static hub-tile/header icons, so every rendering of
// "a raindrop" is literally the same drawing code.
import { drawRaindrop, WILDCARD_LETTER, WILDCARD_PALETTE, WIDTH_SCALE, HEIGHT_SCALE } from './raindrop-icon.js';

export default class Raindrop {
  static BASE_RADIUS = 23.4; // 19.5 * 1.2 — drops enlarged 20% (same aspect ratio, since WIDTH_SCALE's horizontal squeeze is untouched); MIN_RAINDROP_SEPARATION/spawn margin in index.js derive from this, so lane math adjusts automatically
  static BASE_SPEED = 10; // pixels per second — 55 -> 27.5 -> 15 -> 10 across three rounds of playtesting feedback

  // Eight {light, deep} color pairs a drop's gradient is built from — one
  // picked at random per drop (see the constructor); widened from 5 to 8
  // per the user's request for more variety. GREY is what a drop switches
  // to once clicked, per the design brief ("just change the color to grey"
  // for now) — same layered rendering either way, just a different pair of
  // colors feeding it. The three additions (purple, green, orange) were
  // picked to fill the remaining gaps around the color wheel between the
  // original five, so all 8 stay easy to tell apart at a glance.
  static PALETTE = [
    { light: '#bfdbfe', deep: '#1d4ed8' }, // blue
    { light: '#fecdd3', deep: '#e11d48' }, // coral
    { light: '#99f6e4', deep: '#0f766e' }, // teal
    { light: '#fbcfe8', deep: '#be185d' }, // pink
    { light: '#fde68a', deep: '#b45309' }, // amber
    { light: '#e9d5ff', deep: '#7e22ce' }, // purple
    { light: '#bbf7d0', deep: '#15803d' }, // green
    { light: '#fed7aa', deep: '#c2410c' }, // orange
  ];
  static GREY = { light: '#e5e7eb', deep: '#6b7280' };

  // paletteIndex is optional — index.js's spawnRaindrop() passes an explicit
  // index (chosen so it never repeats the previous drop's color, per the
  // user's "not the same colour as the last raindrop" rule); anything else
  // that creates a Raindrop directly (e.g. testCatchWord's QA drops, which
  // are never actually drawn) just gets a random one, same as before.
  constructor(x, letter, paletteIndex = null) {
    this.x = x;
    this.letter = letter;

    // Size no longer varies per drop (removed per the user's request — every
    // drop is now exactly BASE_RADIUS) but speed still does, ±30%, via its
    // own random factor per drop (not re-rolled per frame) so each drop's
    // speed stays constant for its whole fall.
    const speedFactor = 0.7 + Math.random() * 0.6; // ±30% — unchanged, only the base speed itself was halved
    this.radius = Raindrop.BASE_RADIUS;
    this.speed = Raindrop.BASE_SPEED * speedFactor;

    // Starts just above the visible canvas so it animates INTO view
    // instead of popping in already on-screen.
    this.y = -this.radius;

    // A wildcard always uses its own dedicated gold, regardless of
    // whatever paletteIndex was passed in — it's never part of the normal
    // random-color rotation (see raindrop-icon.js's WILDCARD_PALETTE).
    this.palette = letter === WILDCARD_LETTER
      ? WILDCARD_PALETTE
      : paletteIndex !== null
        ? Raindrop.PALETTE[paletteIndex]
        : Raindrop.PALETTE[Math.floor(Math.random() * Raindrop.PALETTE.length)];
    this.clicked = false; // true once caught — blocks further hits, switches to grey
    this.resolved = false; // true once its word attempt is resolved (success or fail)
    this.age = 0; // seconds this drop has existed — only drives the wildcard's pulsing ring (see draw())
  }

  // Called once per frame — deltaTime (seconds since last frame) keeps the
  // fall speed consistent regardless of frame rate, unlike Bar.js's fixed
  // per-frame movement (a drop's speed matters a lot more here, since it
  // directly determines how long a player has to complete a word before
  // this drop reaches the bottom and ends the game).
  update(deltaTime) {
    this.y += this.speed * deltaTime;
    this.age += deltaTime;
  }

  // True the MOMENT this drop first touches the bottom edge (its lowest
  // point — the bulb's bottom, at y + radius * HEIGHT_SCALE, since the tip
  // points up, not down, and HEIGHT_SCALE is the vertical squeeze
  // drawRaindrop() actually renders the bulb at — see raindrop-icon.js)
  // — index.js's game-over check uses this (see the design brief: ANY drop
  // touching the bottom ends the round, clicked or not). This used to only
  // fire once the drop had fallen fully PAST the bottom (y - radius >
  // canvasHeight), letting it visibly fall through before the game ended —
  // fixed to fire on first contact instead.
  touchesBottom(canvasHeight) {
    return this.y + this.radius * HEIGHT_SCALE >= canvasHeight;
  }

  // Distance-to-center hit test, with a little extra forgiveness on top of
  // the drop's own size — generous enough for a fingertip tap to feel
  // reliable, same spirit as JEWELZ's circle-distance jewel collection
  // check. dx is un-squeezed by WIDTH_SCALE first so the tolerant region
  // is an ellipse matching draw()'s actual (horizontally squeezed) shape,
  // rather than a circle sized for the old, wider drop.
  containsPoint(x, y) {
    const dx = (x - this.x) / WIDTH_SCALE;
    const dy = y - this.y;
    return Math.sqrt(dx * dx + dy * dy) <= this.radius * 1.15;
  }

  draw(ctx) {
    const palette = this.clicked ? Raindrop.GREY : this.palette;

    // Once caught (grey), the whole drop also renders at half opacity — a
    // save/globalAlpha/restore here applies to everything drawRaindrop()
    // draws (base, highlights, glint, letter) without that shared function
    // needing to know anything about "clicked" state itself.
    ctx.save();
    ctx.globalAlpha = this.clicked ? 0.5 : 1;
    drawRaindrop(ctx, this.x, this.y, this.radius, this.letter, palette, this.age);
    ctx.restore();
  }
}
