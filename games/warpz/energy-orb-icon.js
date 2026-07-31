// Renders one EnergyOrb instance onto an off-screen canvas and returns it
// as a PNG data URL — same pattern as star-shard-icon.js/asteroid-icon.js,
// used both for the inline icon in the instructions text (see index.js,
// Cyan/PALETTES[0]) and, with VIOLET_PALETTE below, for the hub tile +
// in-game header icon (see games-registry.js and index.js's own
// initShell() call) — swapped in from the player-face icon per the user's
// explicit "doesn't look good, use a violet energy orb instead" request.
import EnergyOrb, { PALETTES } from './EnergyOrb.js';

const ICON_RENDER_SIZE = 128;

// Not part of EnergyOrb's own in-game PALETTES rotation (spawned orbs
// still only ever roll Cyan/Amber/Magenta/Toxic Green) — this is purely
// for the tile/header icon use case above.
export const VIOLET_PALETTE = { name: 'Violet', center: '#f5f0ff', mid: '#b98aff', edge: '#5a1fa0', glow: '160,110,255' };

// Keyed by palette name so the tile/header (Violet) and the instructions
// icon (Cyan) don't clobber each other's cached render.
const cache = new Map();
export function getEnergyOrbIconDataURL(palette = PALETTES[0]) {
  if (!cache.has(palette.name)) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_RENDER_SIZE;
    canvas.height = ICON_RENDER_SIZE;
    const context = canvas.getContext('2d');

    const orb = new EnergyOrb('top', 0, [0, 0], ICON_RENDER_SIZE, palette);
    orb.angle = 0.4;
    orb.age = 1.2; // fixed phase, same idea as the other icons' ICON_PHASE
    orb.x = ICON_RENDER_SIZE / 2;
    orb.y = ICON_RENDER_SIZE / 2;
    orb.radius = ICON_RENDER_SIZE * 0.32; // bigger than in-game, to read clearly at inline-icon size

    orb.draw(context);

    cache.set(palette.name, canvas.toDataURL('image/png'));
  }
  return cache.get(palette.name);
}
