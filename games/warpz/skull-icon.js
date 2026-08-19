// Used for the inline icon in the instructions text (see index.js). Used to
// call drawSkull() (imported from Maze.js) and render it onto an off-screen
// canvas at a fixed glow phase, returning a toDataURL() PNG string every
// single visit — precomputed once (2026-08-19) into a real PNG file
// instead, same reasoning as jewelz/jewel-icon.js's own version of this
// change (see that file and project_gamehub_back_button_delay memory).
// (Maze.js itself still loads regardless via index.js's own gameplay
// import — this only removes the redundant per-visit canvas draw, not a
// module load.) Regenerate via drawSkull(ctx, 64, 64, 128*0.3, 0.7) from
// Maze.js if the skull's look ever changes.
export function getSkullIconDataURL() {
  return new URL('./images/skull-icon.png', import.meta.url).href;
}
