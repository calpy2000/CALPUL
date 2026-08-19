// Used for the inline icon in the instructions text (see index.js). Always
// the Ice Blue palette (PALETTES[0]) at a fixed angle/age, regardless of
// whichever colors actually spawn in play. Used to be rendered at runtime
// onto an off-screen canvas (importing StarShard.js just to draw one frame)
// and returned as a toDataURL() PNG string every single visit — precomputed
// once (2026-08-19) into a real PNG file instead, same reasoning as
// jewelz/jewel-icon.js's own version of this change (see that file and
// project_gamehub_back_button_delay memory). Regenerate by re-running the
// old rendering code (StarShard('top', 0, [0,0], 128, PALETTES[0]), angle
// 0.4, age 1.2, radius 128*0.3) if the shard's look ever changes.
export function getStarShardIconDataURL() {
  return new URL('./images/star-shard-icon.png', import.meta.url).href;
}
