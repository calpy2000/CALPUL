// Standalone tester-onboarding page — deliberately outside the hub/beta-gate
// flow (this IS the page that hands out the code, so it can't require one to
// view it). Meant to be shared as a link (WhatsApp, email, text) with a
// personal ?code=XXXXXX already attached, e.g.:
//   welcome.html?code=RCWCHP
// Falls back to a generic (non-personalized) version if opened with no code,
// or a code that doesn't match any real tester — still fully usable, just
// without a name or a pre-filled personal link.

import { GAMES } from './games-registry.js';
import { hidePageLoadingIndicator } from './shared/core/loading-indicator.js';

hidePageLoadingIndicator();

const SITE_URL = 'https://calpy2000.github.io/PUSULZ/';

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

// Same "fetch relative to this file's own location" trick beta-gate.js uses
// — harmless here (this file only ever lives at the project root, same
// level as testers.json), but keeps the pattern consistent.
async function fetchTesters() {
  const url = new URL('./testers.json', import.meta.url);
  const res = await fetch(url);
  return res.json();
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

function renderSetup(tester, code) {
  const container = document.getElementById('welcome-setup');

  if (!tester) {
    // No valid code attached to this link — nothing personal to hand out,
    // so this just points them at the plain URL and asks them to find
    // their code rather than pretending to have one.
    container.appendChild(
      el(
        'div',
        'welcome__no-code-note',
        `This link doesn't have your personal code attached to it. Open Safari and go to <strong>${SITE_URL}</strong>, then enter the code from the message you got this link in — or get in touch if you can't find it.`
      )
    );
    return;
  }

  const personalLink = `${SITE_URL}?code=${code}`;

  const pathA = el(
    'div',
    'welcome__path-card',
    `<span class="welcome__path-label">If you're on the device you'll use for testing</span>
     <ol>
       <li>Tap your personal link below — it already has your code built in, so it'll take you straight in, no typing needed:
         <a class="welcome__step-url" href="${personalLink}">${personalLink}</a>
       </li>
       <li><strong>Create your own PUSULZ tile</strong> so it's easy to jump back in every day: tap the <strong>Share</strong> icon in Safari (square with an arrow, along the bottom of the screen), then scroll down and tap <strong>"Add to Home Screen,"</strong> then <strong>"Add"</strong> in the top-right. You'll get a proper PUSULZ app icon on your home screen — tap that from now on to open it full-screen, just like a real app.</li>
     </ol>`
  );

  const pathB = el(
    'div',
    'welcome__path-card',
    `<span class="welcome__path-label">If you're on another device right now (laptop, etc.)</span>
     <ol>
       <li>On the device you'll use for testing, open Safari and go to:
         <a class="welcome__step-url" href="${SITE_URL}">${SITE_URL}</a>
       </li>
       <li>Enter your unique entry code when asked:
         <div class="welcome__code-box"><span class="label">Your code</span><span class="code">${code}</span></div>
         Make a note of it somewhere safe — but you won't need to type it again after this. It's remembered on this device from now on.
       </li>
       <li><strong>Create your own PUSULZ tile</strong>: tap the <strong>Share</strong> icon in Safari, then <strong>"Add to Home Screen,"</strong> then <strong>"Add."</strong> Tap that icon from now on to open PUSULZ full-screen, just like a real app.</li>
     </ol>`
  );

  container.appendChild(pathA);
  container.appendChild(pathB);
}

async function init() {
  renderGames();

  const code = new URLSearchParams(window.location.search).get('code');
  let tester = null;
  if (code) {
    try {
      const testers = await fetchTesters();
      const match = Object.entries(testers).find(([, c]) => c === code.trim().toUpperCase());
      if (match) tester = { name: match[0], code: match[1] };
    } catch {
      // Network hiccup — falls through to the generic (no-name) version,
      // same "don't block on it" spirit as beta-gate.js's own tryCodeFromUrl().
    }
  }

  if (tester) {
    document.getElementById('welcome-headline').textContent = `Hi ${tester.name}, welcome to the PUSULZ beta! 🎉`;
  }

  renderSetup(tester, tester ? tester.code : null);
}

init();
