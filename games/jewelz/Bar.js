// ==========================================
// MODULE: THE OBSTACLE BAR CLASS
// ==========================================
//
// A "class" is a template for creating objects that each have their own
// data (here: position, size, color, speed) but share the same behavior
// (the update()/draw() methods below). Every spinning bar in the game is a
// separate `new Bar(...)` instance — index.js's animate() loop just calls
// .update() and .draw() on each one in the `bars` array without needing to
// know any of this class's internals.
//
// `export default` means this is the ONE thing this file exports, so
// index.js can write `import Bar from './Bar.js'` (no curly braces needed,
// unlike the shared/ modules which use named exports like
// `import { initShell } from ...`).
//
// The saw-blade drawing itself is shared with bar-icon.js's static icons
// (used inline in the instructions text — see index.js), so the game and
// those icons render the exact same blade.
import { drawSawBlade } from './bar-icon.js';

export default class Bar {
    // The constructor runs once, automatically, every time someone writes
    // `new Bar(x, y)` — its job is to set up a fresh object's starting
    // data. `this` inside a class refers to "the specific object instance
    // currently being built/used" — `this.x = x` stores the x argument
    // onto THIS bar specifically, so different Bar instances can have
    // different x values even though they're built from the same class.
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 30;

        // Picks a random height, as a whole multiple of the width (30, 60,
        // 90, or 120px tall) — Math.random() gives a float from 0 (inclusive)
        // up to but not including 1; multiplying by the array's length and
        // flooring it turns that into a random valid array INDEX (0, 1, 2,
        // or 3), which is then used to pick one of the four multipliers.
        const lengthMultipliers = [1, 2, 3, 4];
        const randomMultiplier = lengthMultipliers[Math.floor(Math.random() * lengthMultipliers.length)];
        this.height = this.width * randomMultiplier;

        this.age = 0; // seconds this bar has existed — drives the pulsing glow's phase, see update()
        // A random starting rotation, in radians (JavaScript's trig
        // functions all work in radians, not degrees — Math.PI * 2 radians
        // is a full 360-degree turn, so this picks anywhere from 0 to a
        // full rotation).
        this.angle = Math.random() * Math.PI * 2;

        const baseSpeed = 4;
        const baseSpinSpeed = Math.PI * 2;

        // Each bar gets its own somewhat-random speed multiplier (between
        // 0.5x and 1.5x the base speed) for horizontal movement, vertical
        // movement, and spin — so bars don't all move/spin at identical
        // rates, making the obstacle field feel less mechanically uniform.
        const randomFactorX = 0.5 + Math.random();
        const randomFactorY = 0.5 + Math.random();
        const randomFactorSpin = 0.5 + Math.random();

        // `condition ? 1 : -1` randomly picks a starting DIRECTION (positive
        // or negative) for each axis, on top of the randomized speed —
        // so roughly half of all bars start out moving left vs right, and
        // independently, up vs down.
        this.speedX = baseSpeed * randomFactorX * (Math.random() < 0.5 ? 1 : -1);
        this.speedY = baseSpeed * randomFactorY * (Math.random() < 0.5 ? 1 : -1);
        this.spinSpeed = baseSpinSpeed * randomFactorSpin * (Math.random() < 0.5 ? 1 : -1);
    }

    // Called once per frame from index.js's animate() loop. Moves the bar
    // and bounces it off the canvas edges — deltaTime (seconds since the
    // last frame) is only used for the SPIN here; the x/y movement below
    // is deliberately NOT multiplied by deltaTime, so bars move a fixed
    // number of pixels per frame regardless of frame rate (a simpler,
    // slightly less "correct" approach than the fully frame-rate-independent
    // timing used elsewhere in index.js, but harmless at the frame rates
    // browsers normally run at).
    update(deltaTime, canvasWidth, canvasHeight) {
        this.age += deltaTime;
        this.angle += this.spinSpeed * deltaTime;
        this.x += this.speedX;
        this.y += this.speedY;

        // Bounces off the left/right walls: `buffer` is half the bar's
        // height (used here rather than width, since the bar might currently
        // be rotated in a way where its height matters more for how far it
        // can extend — a simplified approximation rather than exact rotated-
        // rectangle bounds checking). If the bar's edge has gone past either
        // wall, simply REVERSE its horizontal speed — flipping the sign of a
        // number is the standard way to "bounce" a moving object in simple
        // 2D physics like this.
        const buffer = this.height / 2;
        if (this.x + buffer > canvasWidth || this.x - buffer < 0) {
            this.speedX = -this.speedX;
        }
        if (this.y + buffer > canvasHeight || this.y - buffer < 0) {
            this.speedY = -this.speedY;
        }
    }

    // Draws this bar onto the canvas as a serrated saw blade — a matte
    // brushed-metal gradient with a red hazard glow, deliberately dropping
    // the old glossy neon-bevel look (see bar-icon.js's drawSawBlade for
    // the full reasoning: that shine was the same visual language the
    // collectible jewels use, which read as "another jewel" to testers
    // rather than "a hazard"). `context` here is the same `ctx` object
    // passed in from index.js's drawEverything().
    draw(context) {
        context.save();
        // translate() + rotate() — see the longer explanation this used to
        // have here: shifts (0,0) to this bar's center and rotates by its
        // current angle, so everything below can be drawn as a plain
        // axis-aligned shape centered on the origin and still come out
        // correctly positioned/rotated on screen.
        context.translate(this.x, this.y);
        context.rotate(this.angle);

        const pulse = 0.5 + 0.5 * Math.sin(this.age * 2.5);
        drawSawBlade(context, this.width, this.height, pulse);

        context.restore();
    }
}
