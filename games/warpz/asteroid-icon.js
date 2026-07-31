// Renders one Asteroid instance onto an off-screen canvas and returns it as
// a PNG data URL — same pattern as player-icon.js's getPlayerIconDataURL(),
// used for the inline icon in the instructions text (see index.js).
import Asteroid from './Asteroid.js';

const ICON_RENDER_SIZE = 128;

let cachedAsteroidIconDataURL = null;
export function getAsteroidIconDataURL() {
  if (!cachedAsteroidIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    // Asteroid's own outline/craters are baked in pixel units at whatever
    // size it happens to roll, so rather than fight that, this scales the
    // WHOLE drawing operation up/down to a consistent icon size instead of
    // touching the instance's own .size after construction.
    const a = new Asteroid('top', 0, [0, 0], ICON_RENDER_SIZE);
    a.angle = 0.4;
    a.age = 1.2; // fixed phase, same idea as player-icon.js's ICON_PHASE
    const targetRadius = ICON_RENDER_SIZE * 0.36;
    const scale = targetRadius / a.size;
    a.x = ICON_RENDER_SIZE / (2 * scale);
    a.y = ICON_RENDER_SIZE / (2 * scale);

    context.save();
    context.scale(scale, scale);
    a.draw(context);
    context.restore();

    cachedAsteroidIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedAsteroidIconDataURL;
}
