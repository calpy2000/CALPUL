// Renders the maze obstacle's skull onto an off-screen canvas and returns it
// as a PNG data URL — same pattern as star-shard-icon.js/player-icon.js,
// used for the inline icon in the instructions text (see index.js). A fixed
// glow phase (rather than 0 or 1) picked for a clearly-lit look, same idea
// as the other icons' own fixed ICON_PHASE/age picks.
import { drawSkull } from './Maze.js';

const ICON_RENDER_SIZE = 128;

let cachedSkullIconDataURL = null;
export function getSkullIconDataURL() {
  if (!cachedSkullIconDataURL) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    drawSkull(context, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE * 0.3, 0.7);

    cachedSkullIconDataURL = canvas.toDataURL('image/png');
  }
  return cachedSkullIconDataURL;
}
