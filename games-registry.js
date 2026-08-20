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
import { getArrowIconDataURL as getSlydzArrowIconDataURL } from './games/slydz/tile-icon.js';
import { getTileIconDataURL as getGlympzTileIconDataURL } from './games/glympz/row-icon.js';
import { getCheckerboardIconDataURL as getQuadzCheckerboardIconDataURL } from './games/quadz/tile-icon.js';
import { getClapperboardIconDataURL } from './games/muveez/icon.js';
import { getHeaderIconDataURL as getRainzHeaderIconDataURL } from './games/rainz/raindrop-icon.js';
import { getEnergyOrbIconDataURL as getWarpzOrbIconDataURL, VIOLET_PALETTE as WARPZ_VIOLET_PALETTE } from './games/warpz/energy-orb-icon.js';
import { getQuestionTileIconDataURL as getValuzTileIconDataURL } from './games/valuz/tile-icon.js';
import { getMojeezTileIconDataURL } from './games/mojeez/tile-icon.js';
import { getPentagonIconDataURL as getCuluzPentagonIconDataURL } from './games/culuz/tile-icon.js';
import { getSpokzIconDataURL } from './games/spokz/tile-icon.js';

export const GAMES = [
  {
    id: 'spokz', // must be unique across all games — used to namespace localStorage keys
    title: 'SPOKZ',
    emojiImage: getSpokzIconDataURL(),
    tagline: 'ba der ba der<br>thats all SPOKZ',
    path: 'games/spokz/index.html',
    color: '#F2E27A', // pastel lemon-yellow — picked to sit clearly apart from QUADZ's gold (#DFAE55) and SOLVZ's orange (#E59A63), the two closest existing hues
    rim: 'rgba(74, 61, 13, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
    isNew: true, // shows the "NEW" ribbon (see style.css's .hub__tile-new-ribbon)
    // devOnly removed per explicit request, to make SPOKZ visible under
    // TOOL_MODE 'test' (the tester-facing tools panel) — same pattern
    // CULUZ/TOTALZ/MOJEEZ went through once they were ready.
    // 13th game. Inserted at row 1 / column 1 per explicit request — every
    // other game shifted along by one array position.
  },
  {
    id: 'culuz', // must be unique across all games — used to namespace localStorage keys
    title: 'CULUZ',
    emojiImage: getCuluzPentagonIconDataURL(),
    tagline: "Don't be square - lets get into shape",
    path: 'games/culuz/index.html',
    color: '#46A06A', // darker shade of green than JEWELZ's own pastel (#63B98A), lightened from an initial #3E8E5E per explicit feedback (picked "Option A" from a swatch comparison against JEWELZ/WARPZ's own greens)
    rim: 'rgba(10, 45, 25, 0.30)',
    higherIsBetter: true, // score = correct taps scored before failing out or winning
    scoreIsTime: false, // a plain count, not a duration
    // devOnly removed per explicit request, to preview CULUZ under
    // TOOL_MODE 'test' (the tester-facing tools panel) — same pattern
    // VALUZ/MOJEEZ/TOTALZ went through once they were ready. Nothing has
    // been pushed, so this is still local-only either way.
    // 12th game. Inserted at row 1 / column 1 per explicit request — every
    // other game (including VALUZ, moved to row 2 / column 2) shifted along
    // by one array position.
  },
  {
    id: 'totalz', // must be unique across all games — used to namespace localStorage keys
    title: 'TOTALZ',
    emoji: '🟰', // same "no generated icon art of its own" pattern as SOLVZ's ➕ — shown in a small raised circle on the hub tile
    tagline: 'Why was 6 afraid of 7? <br> Because 7 8 9',
    path: 'games/totalz/index.html',
    color: '#A9D0F5', // light blue pastel — airier than GLYMPZ (#6F9BDB) and RAINZ (#4FB2D6), distinct from both
    rim: 'rgba(25, 60, 95, 0.30)',
    accent: '#8ED9A0', // light pastel green — background for the icon circle only
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
    // devOnly removed — now visible to testers (see index.js's
    // renderTiles() and shared/core/tool-mode.js), same as MOJEEZ's own
    // history above.
    // 11th game. Inserted at row 1 / column 2 per explicit request — MOJEEZ
    // and everything after it shifted along by one array position.
  },
  {
    id: 'mojeez', // must be unique across all games — used to namespace localStorage keys
    title: 'MOJEEZ',
    emojiImage: getMojeezTileIconDataURL(),
    tagline: 'There are simply no words for this . . .',
    path: 'games/mojeez/index.html',
    color: '#E0787A', // warm coral-red — picked from a swatch comparison against an earlier, too-brown first pass (#C1554D); sits between true red and MUVEEZ's pink (#DD7FA3) without reading as either
    rim: 'rgba(90, 20, 22, 0.30)',
    higherIsBetter: true, // score = correct guesses out of 4
    scoreIsTime: false, // a plain count (0-4), not a duration
    // Was row 1 / column 2; shifted to row 2 / column 1 when TOTALZ was
    // inserted ahead of it (see TOTALZ's own comment above).
    // devOnly removed — now visible to testers (see days.json's fallback:
    // any day-of-year not yet authored just shows days[0] instead of
    // breaking, so it's safe to go live even with only 2 of 366 days
    // populated today).
  },
  {
    id: 'valuz', // must be unique across all games — used to namespace localStorage keys
    title: 'VALUZ',
    emojiImage: getValuzTileIconDataURL(),
    tagline: 'You VALMEEZ <br> and I VALUZ',
    path: 'games/valuz/index.html',
    color: '#8E6FB3', // pastel purple — darker than SLYDZ's own violet (#AD82D6), distinct from every other game's hue
    rim: 'rgba(40, 20, 60, 0.30)',
    higherIsBetter: true, // score = correct matches out of 6
    scoreIsTime: false, // a plain count (0-6), not a duration
    // Moved to row 2 / column 2 when CULUZ was inserted at row 1 / column 1
    // (see CULUZ's own comment above) — was previously the first tile.
  },
  {
    id: 'glympz',
    title: 'GLYMPZ',
    // A single tile cropped from GLYMPZ's own "solved" master image (slice 2,
    // picked for a clear diagonal color transition) — the same single-crop
    // style used for its in-game header, not the full 5-tile shuffled row.
    emojiImage: getGlympzTileIconDataURL(2),
    tagline: 'Now you see it, now you don\'t',
    path: 'games/glympz/index.html',
    color: '#6F9BDB',
    rim: 'rgba(20, 40, 90, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
  },
  {
    id: 'slydz',
    title: 'SLYDZ',
    // A squiggly "loop and swoosh" arrow in SLYDZ's own tile-box style —
    // evokes a tile sliding into place — same image used for its header.
    emojiImage: getSlydzArrowIconDataURL(),
    tagline: 'this game is <br> letter-ally amazing',
    path: 'games/slydz/index.html',
    color: '#AD82D6',
    rim: 'rgba(55, 20, 80, 0.30)',
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true,
  },
  {
    id: 'quadz',
    title: 'QUADZ',
    // A 4x4 checkerboard echoing the real board's own shape (amber, deep
    // brown, tick-green) — replaces the earlier single-tick-cell icon.
    emojiImage: getQuadzCheckerboardIconDataURL(),
    tagline: '4 across meets 4 down <br> is that a clue?',
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
    tagline: 'So what was the name of that film we saw?',
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
    tagline: 'On your marks, wet, water you waiting for?',
    path: 'games/rainz/index.html',
    color: '#4FB2D6',
    rim: 'rgba(5, 55, 75, 0.30)',
    higherIsBetter: true, // score = words formed
    scoreIsTime: false, // it's a word count, not a duration
  },
  {
    id: 'solvz',
    title: 'SOLVZ',
    emoji: '➕', // the one game with no generated icon art of its own — shown in a small raised circle on the hub tile
    tagline: 'Sum thing tells me it all adds up', // subtitle text shown on the hub tile
    path: 'games/solvz/index.html', // relative link the hub tile points to
    color: '#E59A63', // deep-but-soft pastel tile fill
    rim: 'rgba(120, 55, 15, 0.30)', // dark side of the tile's puffy-bevel rim
    accent: '#F2803A', // more saturated — background for the icon circle only
    higherIsBetter: false, // score = completion time in seconds
    scoreIsTime: true, // display formatting: run the raw score through M:SS, not shown as a plain number
  },
  {
    id: 'jewelz',
    title: 'JEWELZ',
    // Just the regular ruby jewel now (not the ruby+sapphire bonus-jewel
    // pair) — one image per tile, matching every other game.
    emojiImage: getJewelIconDataURL(),
    tagline: 'Jewel be glad gem played this game',
    path: 'games/jewelz/index.html',
    color: '#63B98A', // green still reads well behind the ruby jewel image
    rim: 'rgba(10, 55, 30, 0.30)',
    // Unlike the two time-based games above, a HIGHER score is better here
    // (more jewels collected) — this flag is read by game-storage.js's
    // submitScore() to decide whether a new score beats the old best.
    higherIsBetter: true, // score = jewels collected
    scoreIsTime: false, // it's a plain jewel count, not a duration
    // Moved to row 5 / column 1 per explicit request.
  },
  {
    id: 'warpz',
    title: 'WARPZ',
    emojiImage: getWarpzOrbIconDataURL(WARPZ_VIOLET_PALETTE),
    tagline: 'In space no one can hear you dream',
    path: 'games/warpz/index.html',
    color: '#A8D84A', // lime green — matches this game's own shell accentColor (see games/warpz/index.js)
    rim: 'rgba(55, 85, 5, 0.30)',
    higherIsBetter: true, // score = star shards + energy orbs collected — more is better
    scoreIsTime: false, // a plain points count, not a duration (own end panel/share text already says "points")
    // Moved to row 5 / column 2 per explicit request.
  },
];
