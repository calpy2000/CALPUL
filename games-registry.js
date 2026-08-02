// Single source of truth for the hub tile grid and each game's storage namespace.
//
// This is the ONE place that lists "which games exist." The hub's index.js
// reads this array to build the tile grid, and each game's own `id` here is
// what game-storage.js uses to namespace that game's localStorage keys (see
// shared/core/game-storage.js — e.g. id: 'solvz' means SOLVZ's saved progress
// lives under the key "solvz_progress"). To add a new game to the hub later,
// this array is where a new entry gets added.
//
// Five of the seven original games were renamed on 2026-07-28 (SUMZ->SOLVZ,
// TYLZ->GLYMPZ, BARZ & JEWELZ->JEWELZ, WYRDZ->SLYDZ, SQUARZ->QUADZ; MUVEEZ
// and RAINZ kept their names) — `id` changed along with the display name in
// every case, so anyone who played under the old names starts fresh
// (per-game progress/best-score is namespaced by `id`, and no migration was
// requested). The eighth game, DODZ, was renamed to WARPZ on 2026-07-31
// before it had any real players, so no storage migration was needed there
// either.
//
// `export const` (rather than `export function`) exports a plain value — any
// other file can `import { GAMES } from './games-registry.js'` and read this
// array directly.
//
// The hub tile redesign (2026-07-29) dropped the multi-image tiles (JEWELZ's
// regular+bonus jewel pair, MUVEEZ's clapperboard+projector pair) down to a
// single image each, and switched every wide "row" icon (5-tiles-wide,
// 5-drops-wide, etc.) for the single-tile/single-drop crop each game already
// generates for its OWN in-game header framing — the row images are ~4-5x
// wider than tall and don't fit next to a game name on one line, while the
// single-crop versions do. This only changes what the HUB imports; each
// game's own header (and JEWELZ's live bonus-jewel gameplay, which still
// uses getBonusJewelIconDataURL itself) is untouched.
import { getJewelIconDataURL } from './games/jewelz/jewel-icon.js';
import { getTileDataURL as getSlydzTileDataURL } from './games/slydz/tile-icon.js';
import { getTileIconDataURL as getGlympzTileIconDataURL } from './games/glympz/row-icon.js';
import { getTileIconDataURL as getQuadzTileIconDataURL } from './games/quadz/tile-icon.js';
import { getClapperboardIconDataURL } from './games/muveez/icon.js';
import { getHeaderIconDataURL as getRainzHeaderIconDataURL } from './games/rainz/raindrop-icon.js';
import { getEnergyOrbIconDataURL as getWarpzOrbIconDataURL, VIOLET_PALETTE as WARPZ_VIOLET_PALETTE } from './games/warpz/energy-orb-icon.js';

export const GAMES = [
  {
    id: 'solvz', // must be unique across all games — used to namespace localStorage keys
    title: 'SOLVZ',
    emoji: '➕', // the one game with no generated icon art of its own — shown in a small raised circle on the hub tile
    tagline: 'add, subtract, divide & multiply', // subtitle text shown on the hub tile
    path: 'games/solvz/index.html', // relative link the hub tile points to
    color: '#E59A63', // deep-but-soft pastel tile fill
    rim: 'rgba(120, 55, 15, 0.30)', // dark side of the tile's puffy-bevel rim
    accent: '#F2803A', // more saturated — background for the icon circle only
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true, // display formatting: run the raw score through M:SS, not shown as a plain number
  },
  {
    id: 'glympz',
    title: 'GLYMPZ',
    // A single tile cropped from GLYMPZ's own "solved" master image (slice 2,
    // picked for a clear diagonal color transition) — the same single-crop
    // style used for its in-game header, not the full 5-tile shuffled row.
    emojiImage: getGlympzTileIconDataURL(2),
    tagline: 'Shuffle the clips to restore the image',
    path: 'games/glympz/index.html',
    color: '#6F9BDB',
    rim: 'rgba(20, 40, 90, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
  },
  {
    id: 'jewelz',
    title: 'JEWELZ',
    // Just the regular ruby jewel now (not the ruby+sapphire bonus-jewel
    // pair) — one image per tile, matching every other game.
    emojiImage: getJewelIconDataURL(),
    tagline: 'Make like a jewel thief, but stay alive',
    path: 'games/jewelz/index.html',
    color: '#63B98A', // green still reads well behind the ruby jewel image
    rim: 'rgba(10, 55, 30, 0.30)',
    // Unlike the two time-based games above, a HIGHER score is better here
    // (more jewels collected) — this flag is read by game-storage.js's
    // submitScore() to decide whether a new score beats the old best.
    higherIsBetter: true, // score = jewels collected
    scoreIsTime: false, // it's a plain jewel count, not a duration
  },
  {
    id: 'slydz',
    title: 'SLYDZ',
    // A single 'S' tile in SLYDZ's own solved-tile style, not the full
    // 5-tile "SLYDZ" row — same single-crop style used for its header.
    emojiImage: getSlydzTileDataURL('S'),
    tagline: 'Spell 5 words - easy right?',
    path: 'games/slydz/index.html',
    color: '#AD82D6',
    rim: 'rgba(55, 20, 80, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
  },
  {
    id: 'quadz',
    title: 'QUADZ',
    // A single tick cell (not the full "A B C D + tick" row) — the
    // checkmark reads as "solved" on its own without needing a letter.
    emojiImage: getQuadzTileIconDataURL('✓', true),
    tagline: 'Just 4 words across & 4 words down',
    path: 'games/quadz/index.html',
    color: '#DFAE55',
    rim: 'rgba(90, 55, 5, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
  },
  {
    id: 'muveez',
    title: 'MUVEEZ',
    // Just the clapperboard now (not the clapperboard+projector pair).
    emojiImage: getClapperboardIconDataURL(),
    tagline: 'What was the name of that film?',
    path: 'games/muveez/index.html',
    color: '#DD7FA3',
    rim: 'rgba(90, 15, 50, 0.30)',
    higherIsBetter: false, // score = number of guesses (fewer is better)
    scoreIsTime: false, // it's a guess count, not a duration — this is what previously made it show up as e.g. "0:04" instead of "4"
  },
  {
    id: 'rainz',
    title: 'RAINZ',
    // A single drop with no letter baked in (index 0 — the purple one) —
    // "RAINZ" is already the tile's own title text right next to it, so a
    // letter on the drop would be redundant, same reasoning as the header.
    emojiImage: getRainzHeaderIconDataURL(0),
    tagline: 'WATER you waiting for?',
    path: 'games/rainz/index.html',
    color: '#4FB2D6',
    rim: 'rgba(5, 55, 75, 0.30)',
    higherIsBetter: true, // score = words formed
    scoreIsTime: false, // it's a word count, not a duration
  },
  {
    id: 'warpz',
    title: 'WARPZ',
    emojiImage: getWarpzOrbIconDataURL(WARPZ_VIOLET_PALETTE),
    tagline: 'In space no one can hear to scream!',
    path: 'games/warpz/index.html',
    color: '#A8D84A', // lime green — matches this game's own shell accentColor (see games/warpz/index.js)
    rim: 'rgba(55, 85, 5, 0.30)',
    higherIsBetter: true, // score = seconds survived — more is better
    scoreIsTime: true, // it IS a duration, just one where higher wins (unlike SOLVZ/GLYMPZ/SLYDZ/QUADZ)
  },
];
