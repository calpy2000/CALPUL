// ==========================================
// MODULE: THE ANIMATED JEWEL PRIZE CLASS
// ==========================================
//
// Same "class" concept as Bar.js (see the longer explanation there) — this
// one is more involved because each jewel animates through several visual
// states over its lifetime (popping in, sitting still, then popping back
// out) rather than just moving in a straight line.

// The faceted-gem drawing itself (and the single style every jewel uses —
// see jewel-icon.js) is shared with the mini-canvas icon that replaces the
// 💎 emoji in the header/hub tile, so the game and those icons render the
// exact same gem.
import { JEWEL_STYLE, drawFacetedGem } from './jewel-icon.js';

export default class Jewel {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 20;
        this.timeAlive = 0;
        this.maxLifetime = 5; // overridden to 3 by index.js for jewels spawned during a wave — see animate()'s jewel-spawning block
        this.style = JEWEL_STYLE;
        this.value = 1; // points awarded on collection — index.js's bonus jewel overrides this to 3
        this.label = null; // optional text drawn centered on the gem (e.g. the bonus jewel's "3") — see draw() below

        // --- Animation finite state machine ---
        // A "finite state machine" is a fancy name for a simple idea: this
        // object is always in exactly ONE of a small fixed set of named
        // states ("spawning", "idle", "despawning", "dead"), and its
        // behavior (what update() and draw() below actually do) depends
        // entirely on which state it's currently in. Moving between states
        // only happens in specific, controlled ways (spawning -> idle
        // automatically once the pop-in finishes; idle -> despawning either
        // from running out of time or from triggerDespawn() being called;
        // despawning -> dead once the shrink-out finishes). This pattern
        // shows up constantly in game/animation code because it makes
        // "what should be happening right now" easy to reason about — you
        // only ever need to think about one state's logic at a time.
        this.state = "spawning"; // States: spawning, idle, despawning, dead
        this.animationTimer = 0; // how long the jewel has been in its CURRENT state
        this.spawnDuration = 0.4;   // 0.4 seconds to pop in
        this.despawnDuration = 0.4; // 0.4 seconds to shrink out
        this.scale = 0;             // Current size multiplier (0 = invisible, 1 = normal size, >1 = temporarily oversized during the pop animations)
    }

    // Trigger the graceful shrink animation early upon player collection
    triggerDespawn() {
        // Only actually changes anything if the jewel isn't ALREADY
        // despawning or dead — calling this on a jewel that's mid-despawn
        // (e.g. both the "collected by player" code path and the "wave
        // ended" code path could theoretically fire close together) would
        // otherwise reset its shrink animation partway through, causing a
        // visible stutter.
        if (this.state !== "despawning" && this.state !== "dead") {
            this.state = "despawning";
            this.animationTimer = 0;
        }
    }

    // Called once per frame from index.js's animate() loop (via
    // `jewels = jewels.filter((jewel) => !jewel.update(deltaTime));`).
    // Advances this jewel's animation and returns true once it's
    // completely finished (state === "dead") — that return value is what
    // index.js uses to know when it's safe to remove this jewel from the
    // array for good.
    update(deltaTime) {
        this.timeAlive += deltaTime;

        // Auto-trigger despawn if its natural life clock runs out
        if (this.timeAlive >= this.maxLifetime - this.despawnDuration && this.state === "idle") {
            this.triggerDespawn();
        }

        // --- SCALE ANIMATION ROUTINES ---
        // Each branch below computes `this.scale` for the CURRENT state,
        // based on `progress` — a number from 0 (just entered this state)
        // to 1 (finished this state), computed as "how much of this
        // animation's total duration has elapsed so far."
        if (this.state === "spawning") {
            this.animationTimer += deltaTime;
            let progress = this.animationTimer / this.spawnDuration;

            if (progress >= 1) {
                // Animation finished — lock in the resting scale and switch
                // to the idle state, where it'll stay until something
                // triggers despawning.
                this.state = "idle";
                this.scale = 1.0;
            } else {
                // Smooth elastic pop curve: grow rapidly up to 1.5, then settle back down toward 1.0
                //
                // This is a hand-built "easing curve" — rather than scale
                // growing at a constant rate from 0 to 1 over the whole
                // spawnDuration (which would look flat/robotic), it's split
                // into two pieces: for the first 70% of the duration, scale
                // rushes from 0 up to 1.5 (overshooting the final size);
                // for the remaining 30%, it settles back down from 1.5 to
                // 1.0. That overshoot-then-settle motion is what reads as a
                // bouncy "pop," rather than a plain fade/grow-in.
                if (progress < 0.7) {
                    this.scale = (progress / 0.7) * 1.5;
                } else {
                    // Re-maps the 0.7-1.0 slice of `progress` into its own
                    // fresh 0-1 range (settleProgress) so the settle math
                    // below doesn't need to account for the first 70% at
                    // all — a common trick when a curve is built out of
                    // multiple distinct phases like this one is.
                    let settleProgress = (progress - 0.7) / 0.3;
                    this.scale = 1.5 - (settleProgress * 0.5);
                }
            }
        }
        else if (this.state === "idle") {
            this.scale = 1.0;
        }
        else if (this.state === "despawning") {
            this.animationTimer += deltaTime;
            let progress = this.animationTimer / this.despawnDuration;

            if (progress >= 1) {
                this.state = "dead";
                this.scale = 0;
            } else {
                // Reverse of appearing: Grow up from 1.0 to 1.5 quickly, then drop down to 0
                if (progress < 0.3) {
                    this.scale = 1.0 + (progress / 0.3) * 0.5;
                } else {
                    let shrinkProgress = (progress - 0.3) / 0.7;
                    this.scale = 1.5 * (1 - shrinkProgress);
                }
            }
        }

        // Return true only when the jewel is fully dead and ready to be scrubbed from memory
        return this.state === "dead";
    }

    // Draws the jewel as a faceted, rotating-light gem — picked from the
    // canvas effects gallery (see tools reference) — instead of a plain
    // emoji. `this.scale` (computed above, unchanged from the original
    // pop-in/idle/pop-out animation) still controls the overall size, so
    // the SAME spawn/despawn animation applies automatically; each
    // triangular facet's brightness cycles via `this.timeAlive`, which is
    // what makes the light appear to travel around the gem as it sits
    // there (see the effects gallery's jewelRotateGlow()).
    draw(context) {
        if (this.scale <= 0) return; // nothing to draw once fully shrunk away
        const r = this.radius * this.scale;
        drawFacetedGem(context, this.x, this.y, r, this.style, this.timeAlive);

        // The bonus jewel's point value ("3") drawn centered on top of the
        // gem — light grey (not bold, smaller) with a dark shadow for
        // legibility against whichever facet brightness happens to be
        // underneath at any given moment.
        if (this.label) {
            context.save();
            context.fillStyle = '#d1d5db';
            context.font = `${Math.round(r * 0.65)}px sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.shadowColor = 'rgba(0, 0, 0, 0.6)';
            context.shadowBlur = 4;
            context.fillText(this.label, this.x, this.y);
            context.restore();
        }
    }
}
