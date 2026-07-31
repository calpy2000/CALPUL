// Renders one StarShard instance onto an off-screen canvas and returns it
// as a PNG data URL — same pattern as asteroid-icon.js/player-icon.js,
// used for the inline icon in the instructions text (see index.js). Always
// uses the Ice Blue palette for this static icon, regardless of whichever
// colors actually spawn in play.
import StarShard, { PALETTES } from './StarShard.js';

const ICON_RENDER_SIZE = 128;

let cachedStarShardIconDataURL = null;
export function getStarShardIconDataURL() {
  if (!cachedStarShardIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    const shard = new StarShard('top', 0, [0, 0], ICON_RENDER_SIZE, PALETTES[0]);
    shard.angle = 0.4;
    shard.age = 1.2; // fixed phase, same idea as the other icons' ICON_PHASE
    shard.x = ICON_RENDER_SIZE / 2;
    shard.y = ICON_RENDER_SIZE / 2;
    shard.radius = ICON_RENDER_SIZE * 0.3; // bigger than in-game, to read clearly at inline-icon size

    shard.draw(context);

    cachedStarShardIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedStarShardIconDataURL;
}
