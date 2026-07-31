// ==========================================
// MODULE: THE STAR SHARD COLLECTIBLE CLASS
// ==========================================
//
// Spawns and moves exactly like an Asteroid does — same spawn-edge/
// trajectory system, via index.js's shared pickSpawnPoint() helper — but
// unlike asteroids, every shard is an IDENTICAL size/shape/spin; only its
// exact path and its color differ from one to the next. Rendering technique
// (faceted crystal + pulsing glow + sparkle accent) is the one picked from
// the collectible-concept exploration, with the glow strengthened a round
// later per the user's feedback.

const SIZE = 16; // px radius, fixed for every shard — no size variation like asteroids get
const SPIN_RATE = 0.6; // rad/sec, fixed — every shard spins at this same steady rate/direction
const BASE_SPEED = 200; // px/sec, before variation — its own constant, independent of the asteroids' own speed (2x'd per user feedback once the base gameplay felt good)
const SPEED_VARIATION = 0.3; // +/-30%, same variation MECHANISM as the asteroids use, just around this class's own base

// The four colors picked in the collectible-concept exploration — exported
// so index.js can pick "a different color than whichever shard spawned
// last," the same not-the-same-as-last-time pattern Bar.js already uses
// for its own neon hues.
export const PALETTES = [
  { name: 'Ice Blue', center: '#ffffff', mid: '#bfe6ff', edge: '#5b8fd6', glow: '180,220,255' },
  { name: 'Solar Gold', center: '#fffaf0', mid: '#ffdb8a', edge: '#d6963a', glow: '255,214,140' },
  { name: 'Violet', center: '#fff5ff', mid: '#e3b3ff', edge: '#9a4fd6', glow: '220,170,255' },
  { name: 'Emerald', center: '#f0fff8', mid: '#8ff0c0', edge: '#2a9e6a', glow: '150,255,200' },
];

export default class StarShard {
  // `edge`/`coord`/`angleRangeDeg`/`canvasWidth` are exactly what
  // Asteroid's own constructor takes (see index.js's shared
  // pickSpawnPoint() helper, used for both) — same off-screen entry,
  // same into-canvas trajectory constraint. `palette` is one of the
  // PALETTES entries above, chosen by index.js's own "not the same as
  // last time" picker.
  constructor(edge, coord, angleRangeDeg, canvasWidth, palette) {
    this.radius = SIZE;
    this.palette = palette;
    this.age = 0;
    this.angle = Math.random() * Math.PI * 2; // starting rotation is still randomized, even though the RATE it spins at isn't

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

  // Same one-way-field reasoning as Asteroid's own isOffScreen() — a shard
  // that drifts all the way off the canvas without being caught or hit is
  // just gone, no explosion, nothing left to track.
  isOffScreen(canvasWidth, canvasHeight) {
    return (
      this.x + this.radius < 0 ||
      this.x - this.radius > canvasWidth ||
      this.y + this.radius < 0 ||
      this.y - this.radius > canvasHeight
    );
  }

  draw(ctx) {
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 2.5);
    const pal = this.palette;
    const x = this.x, y = this.y, r = this.radius;

    // Soft outer halo, behind the crystal — a second, bigger, softer glow
    // layer on top of the shape's own shadow-blur, so it reads as glowing
    // from a glance rather than only up close.
    const haloR = r * (1.3 + pulse * 0.35);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    const haloGrad = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    haloGrad.addColorStop(0, `rgba(${pal.glow},${0.35 + pulse * 0.2})`);
    haloGrad.addColorStop(1, `rgba(${pal.glow},0)`);
    ctx.fillStyle = haloGrad;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angle);
    const outerR = r, innerR = r * 0.4;
    const points = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const rad = i % 2 === 0 ? outerR : innerR;
      points.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    ctx.beginPath();
    points.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR);
    grad.addColorStop(0, pal.center);
    grad.addColorStop(0.4, pal.mid);
    grad.addColorStop(1, pal.edge);
    ctx.fillStyle = grad;
    ctx.shadowColor = `rgba(${pal.glow},${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = r * (0.8 + pulse * 0.8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x + outerR * 0.65, y - outerR * 0.65);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`;
    ctx.lineWidth = 1.5;
    const s = outerR * 0.22;
    ctx.beginPath();
    ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
    ctx.moveTo(0, -s); ctx.lineTo(0, s);
    ctx.stroke();
    ctx.restore();
  }
}
