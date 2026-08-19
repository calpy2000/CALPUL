// Two static variants: Cyan (PALETTES[0], the instructions-text inline icon
// in index.js) and Violet (the hub tile icon, see games-registry.js) — not
// part of EnergyOrb's own in-game PALETTES rotation (spawned orbs still
// only ever roll Cyan/Amber/Magenta/Toxic Green), purely for this static
// use.
export const VIOLET_PALETTE = { name: 'Violet', center: '#f5f0ff', mid: '#b98aff', edge: '#5a1fa0', glow: '160,110,255' };

// Used to render one EnergyOrb instance onto an off-screen canvas (fixed
// angle/age, same idea as the other icons' ICON_PHASE) and return it as a
// toDataURL() PNG string, keyed by palette so Cyan/Violet didn't clobber
// each other's cached render — every single visit into WARPZ (Cyan) AND
// every single hub load (Violet, via games-registry.js). Precomputed once
// (2026-08-19) into two real PNG files instead, same reasoning as
// jewelz/jewel-icon.js's own version of this change (see that file and
// project_gamehub_back_button_delay memory). Regenerate via
// EnergyOrb('top', 0, [0,0], 128, <palette>), angle 0.4, age 1.2, radius
// 128*0.32 if the orb's look ever changes.
export function getEnergyOrbIconDataURL(palette = { name: 'Cyan' }) {
  const file = palette.name === 'Violet' ? 'energy-orb-icon-violet.png' : 'energy-orb-icon-cyan.png';
  return new URL(`./images/${file}`, import.meta.url).href;
}
