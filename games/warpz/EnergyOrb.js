// ==========================================
// MODULE: THE ENERGY ORB COLLECTIBLE CLASS
// ==========================================
//
// Spawns and moves exactly like a StarShard does (which itself spawns and
// moves exactly like an Asteroid — see StarShard.js's own header) — same
// spawn-edge/trajectory system via index.js's shared pickSpawnPoint()
// helper, same "fixed size/spin, only path and color vary" rule. Rarer,
// slower, and worth more than a shard: a third of the shard's own spawn
// rate, half its speed, 3 points instead of 1 — see index.js's own
// ORB_CREATION_INTERVAL_BASE for the spawn-rate side of that. The palette
// below is the "Energy Orb" set from the original collectible-concept
// exploration (Cyan/Amber/Magenta/Toxic Green), picked over Comet
// Fragment/Space Debris/Nebula Mote alongside Star Shard.

const SIZE = 18; // px radius, fixed for every orb — a little bigger than a shard's 16, reads as the rarer/higher-value pickup
const SPIN_RATE = 0.6; // rad/sec — spins the orb's ring highlight and its "3" together (see draw())
const BASE_SPEED = 100; // px/sec, before variation — exactly half of StarShard's own BASE_SPEED, per the user's explicit request
const SPEED_VARIATION = 0.3; // +/-30%, same variation mechanism StarShard/Asteroid use around their own bases

// Visibility/collidability cycle — an orb spawns invisible and uncatchable
// (so it can't be caught the instant it pops into existence at the edge),
// quickly fades in and becomes collidable, stays fully visible/collidable
// for exactly COLLIDABLE_DURATION, then fades back out and stops being
// collidable again — all per the user's explicit request. If it drifts off
// the canvas at any point in this cycle, isOffScreen() removes it as
// normal regardless of phase; nothing special is needed for that case.
const ENTRY_INVISIBLE_DURATION = 0.3; // seconds fully invisible/uncollidable right after spawning
const FADE_DURATION = 0.3; // seconds for both the fade-in and the fade-out transition ("quickly")
const COLLIDABLE_DURATION = 1.0; // seconds fully visible/collidable — the user's explicit "fade out after 1 second" spec

// Exported so index.js can pick "a different color than whichever orb
// spawned last" — same not-the-same-as-last-time pattern already used for
// StarShard's own palette and Bar.js's neon hues, just kept as this
// class's own separate rotation (an orb never repeats the last ORB color,
// independent of whatever the most recent SHARD color was).
export const PALETTES = [
  { name: 'Cyan', center: '#ffffff', mid: '#7be3ff', edge: '#1a5c99', glow: '120,220,255' },
  { name: 'Amber', center: '#fffaf0', mid: '#ffc46b', edge: '#b8621a', glow: '255,190,110' },
  { name: 'Magenta', center: '#fff0fb', mid: '#ff9bec', edge: '#a01a8f', glow: '255,140,230' },
  { name: 'Toxic Green', center: '#f5fff0', mid: '#a3ff6b', edge: '#4d991a', glow: '170,255,110' },
];

export default class EnergyOrb {
  // Same constructor shape as StarShard/Asteroid — edge/coord/angleRangeDeg/
  // canvasWidth come from index.js's shared pickSpawnPoint() helper.
  // `options.alwaysCollidable` skips the invisible/fade cycle entirely
  // (see _visibilityState() below) — used for "station mode"'s own fixed
  // orb, which per the user's explicit spec must stay fully visible and
  // catchable for its whole (much longer than COLLIDABLE_DURATION)
  // lifetime anchored to the station, not just a brief 1s plateau. Also
  // used by index.js's own maze/station "completion" bonus orb, which
  // needs to stay collidable across a multi-second cross-canvas flight far
  // longer than the normal fade cycle allows.
  // `options.value` overrides the default 3-point value (both the actual
  // score awarded and the number drawn on the orb's own face) — used for
  // that same completion bonus orb (worth 10). `options.sizeMultiplier`
  // scales SIZE (the completion bonus orb is 2x normal), default 1.
  constructor(edge, coord, angleRangeDeg, canvasWidth, palette, options = {}) {
    this.radius = SIZE * (options.sizeMultiplier || 1);
    this.value = options.value || 3;
    this.palette = palette;
    this.age = 0;
    this.alwaysCollidable = !!options.alwaysCollidable;
    this.angle = Math.random() * Math.PI * 2; // starting ring rotation is still randomized, even though the RATE it spins at isn't

    const speed = BASE_SPEED * (1 + (Math.random() * 2 - 1) * SPEED_VARIATION);
    const [minDeg, maxDeg] = angleRangeDeg;
    const theta = ((minDeg + Math.random() * (maxDeg - minDeg)) * Math.PI) / 180;
    this.vx = Math.sin(theta) * speed;
    this.vy = Math.cos(theta) * speed;

    if (edge === 'top') {
      this.x = coord;
      this.y = -this.radius;
    } else if (edge === 'left') {
      this.x = -this.radius;
      this.y = coord;
    } else {
      this.x = canvasWidth + this.radius;
      this.y = coord;
    }
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += SPIN_RATE * dt;
    this.age += dt;
  }

  // Same one-way-field reasoning as Asteroid's/StarShard's own
  // isOffScreen() — an orb that drifts all the way off the canvas without
  // being caught or hit is just gone, no explosion, nothing left to track.
  isOffScreen(canvasWidth, canvasHeight) {
    return (
      this.x + this.radius < 0 ||
      this.x - this.radius > canvasWidth ||
      this.y + this.radius < 0 ||
      this.y - this.radius > canvasHeight
    );
  }

  // Derives { alpha, collidable } purely from `this.age` — see the
  // visibility-cycle constants above for the four phases this walks
  // through: invisible -> fading in -> fully visible+collidable -> fading
  // out (uncollidable again from the moment the fade-out starts, not once
  // it finishes) -> invisible for good.
  _visibilityState() {
    if (this.alwaysCollidable) return { alpha: 1, collidable: true };
    const t = this.age;
    const fadeInStart = ENTRY_INVISIBLE_DURATION;
    const fadeInEnd = fadeInStart + FADE_DURATION;
    const fadeOutStart = fadeInEnd + COLLIDABLE_DURATION;
    const fadeOutEnd = fadeOutStart + FADE_DURATION;

    if (t < fadeInStart) return { alpha: 0, collidable: false };
    if (t < fadeInEnd) return { alpha: (t - fadeInStart) / FADE_DURATION, collidable: false };
    if (t < fadeOutStart) return { alpha: 1, collidable: true };
    if (t < fadeOutEnd) return { alpha: 1 - (t - fadeOutStart) / FADE_DURATION, collidable: false };
    return { alpha: 0, collidable: false };
  }

  // index.js gates every collision check (player-catch AND
  // destroyed-by-obstacle) behind this — an orb is only ever interactable
  // during its fully-visible plateau.
  isCollidable() {
    return this._visibilityState().collidable;
  }

  draw(ctx) {
    const { alpha } = this._visibilityState();
    if (alpha <= 0.001) return; // nothing to draw while fully invisible — skips the gradient/shadow work too

    const pulse = 0.5 + 0.5 * Math.sin(this.age * 2.5);
    const pal = this.palette;
    const x = this.x, y = this.y, r = this.radius;

    // Sphere + its own glow (unrotated, since a sphere is symmetric either
    // way), then the ring highlight AND the "3" together, both spinning
    // with the orb — same base look as the original Energy Orb mockup,
    // with spin added so the whole thing reads as alive/spinning the same
    // way a shard's facets do, per the user's own feedback once they saw
    // the "3" sitting still against a spinning ring.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, pal.center);
    grad.addColorStop(0.35, pal.mid);
    grad.addColorStop(1, pal.edge);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowColor = `rgba(${pal.glow},${0.6 + pulse * 0.4})`;
    ctx.shadowBlur = r * (0.6 + pulse * 0.6);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.4, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(230,240,255,0.6)';
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.stroke();

    // Its point value — glows in the orb's own hue rather than reading as
    // plain flat text, and now spins with the ring above. Font size scales
    // down a little for a 2-digit value (the completion bonus orb's "10")
    // so it still fits comfortably within the ring.
    const valueStr = String(this.value);
    ctx.font = `bold ${r * (valueStr.length > 1 ? 0.85 : 1.15)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(${pal.glow},${0.8 + pulse * 0.2})`;
    ctx.shadowBlur = r * 0.7;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(valueStr, 0, r * 0.04);
    ctx.restore();
  }
}
