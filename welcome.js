// Standalone tester-onboarding page — deliberately outside the hub/beta-gate
// flow (this page is what hands out access in the first place, so it can't
// require a code to view it).
//
// Deliberately generic: no name, no per-tester code baked into the page or
// its link at all. An earlier version personalized itself from a
// ?code=XXXXXX URL param (looked up against testers.json) — dropped per the
// user's explicit call after real-world testing: it added complexity for
// limited benefit, since the entry code is communicated as plain text in
// whatever message this page's link is shared through anyway (e.g. a
// WhatsApp message written by hand). One plain, shareable link works for
// every tester.

import { GAMES } from './games-registry.js';
import { hidePageLoadingIndicator, navigateWithSpinner } from './shared/core/loading-indicator.js';

hidePageLoadingIndicator();

// Same preventDefault() + navigateWithSpinner() pattern as every other
// back link on the site (see shell.js's identical wiring) — guarantees the
// spinner actually gets a painted frame before navigating away, rather
// than relying on the plain <a href> firing on its own.
document.getElementById('welcome-back').addEventListener('click', (e) => {
  e.preventDefault();
  navigateWithSpinner('index.html');
});

// One short, hand-written description per game — games-registry.js's own
// `tagline` is deliberately terse (it has to fit on a small hub tile), so
// this page keeps its own slightly fuller wording instead, keyed by the
// same `id` every game already has there.
const DESCRIPTIONS = {
  solvz: "A number grid puzzle — fill it in so every row and column's sum checks out.",
  glympz: 'Tap-swap scrambled tiles back into place to restore a hidden picture.',
  jewelz: 'Dodge spinning bars, grab jewels for points, survive as long as you can.',
  slydz: 'Rearrange scrambled letter tiles into 5 real words.',
  quadz: 'A mini crossword grid — every row and column needs to spell a real word.',
  muveez: 'A movie poster reveals bit by bit — guess the title in 6 tries or fewer.',
  rainz: 'Catch falling letters to spell words before one hits the ground.',
  warpz: "Guide your spaceman through the obstacles, dodge what's lethal, and collect shards & energy orbs for points.",
};

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function renderGames() {
  const container = document.getElementById('welcome-games');
  GAMES.forEach((game) => {
    const card = el('div', 'welcome__game');
    card.style.background = `${game.color}1f`; // ~12% alpha tint of the game's own hub-tile color

    const icon = game.emojiImage
      ? el('div', 'welcome__game-icon', `<img src="${game.emojiImage}" alt="${game.title}">`)
      : el('div', 'welcome__game-icon is-badge', `<span>${game.emoji}</span>`);
    if (!game.emojiImage) icon.style.setProperty('--badge-bg', game.accent || game.color);

    const text = el(
      'div',
      null,
      `<p class="welcome__game-name">${game.title}</p><p class="welcome__game-desc">${DESCRIPTIONS[game.id] || game.tagline}</p>`
    );

    card.appendChild(icon);
    card.appendChild(text);
    container.appendChild(card);
  });
}

renderGames();
