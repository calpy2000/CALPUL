// Single source of truth for the end-of-game panel's one-line copy (see
// shell.js's showEndScreen and shell.css's .shell-end-screen__panel). Every
// game classifies its OWN outcome — only the calling game knows things like
// WARPZ's "reached the end of the obstacle sequence" vs MOJEEZ's numeric
// 4/4 — and hands that classification + a pre-formatted score/time string
// to getEndPanelContent(), which just looks up the matching emoji/headline/
// text. Keeping the copy itself in one table (rather than scattered across
// 10 games' own message-building code, as it used to be) is what makes it
// possible to review/edit every game's wording in one place.
//
// Scenario priority (decided once, by the calling game, before calling
// showEndScreen — this module doesn't re-derive it):
//   1. outcome: 'max'    — the best possible result for that game
//   2. outcome: 'loss'   — ran out of guesses/lives (MUVEEZ only)
//      outcome: 'zero'   — completed with a genuine zero score
//      outcome: 'reveal' — player gave up and revealed the solution
//   3. isNewBest: true   — beat a previous best that was a MEANINGFUL
//      comparison point (not the player's first-ever play, and not a
//      previous best of exactly 0 — see each game's showAsPB calculation)
//   4. fallback          — a normal, unremarkable completed run
const GAME_COPY = {
  valuz: {
    max: 'a full house, take a bow',
    normal: (s) => `you got ${s} right`,
  },
  mojeez: {
    max: '4 for 4, impressive!',
    normal: (s) => `you got ${s} right`,
  },
  muveez: {
    max: 'you got it in 1, what a ⭐',
    loss: 'you failed to guess the movie',
    normal: (s) => `you got it in ${s}`,
  },
  warpz: {
    max: 'you made it to the end',
    normal: (s) => `you scored ${s} points`,
  },
  jewelz: {
    normal: (s) => `you scored ${s} points`,
  },
  rainz: {
    normal: (s) => `you scored ${s} points`,
  },
  glympz: {
    normal: (s) => `you solved it in ${s}`,
  },
  slydz: {
    normal: (s) => `you solved it in ${s}`,
  },
  quadz: {
    normal: (s) => `you solved it in ${s}`,
  },
  solvz: {
    normal: (s) => `you solved it in ${s}`,
  },
  totalz: {
    normal: (s) => `you solved it in ${s}`,
  },
  culuz: {
    // Outcome is always exactly 'max' (tapped the gold star) or 'loss' (5
    // fails used) — never a normal/undefined completion — but `normal` is
    // still supplied for parity with every other game's copy table.
    max: 'you found the gold star',
    loss: 'you ran out of chances',
    normal: (s) => `you scored ${s} points`,
  },
};

// VALUZ and MOJEEZ are the only two games with a per-tile "more info"
// popover (tap a graded tile to see its explanation — see each game's own
// index.js and shared/feedback.js's mention of the same mechanism). Their
// end-panel gets a "tap for more" hint so players discover it; no other
// game has this popover, so no other game gets the hint.
//
// `tapHint` is a plain boolean, not baked into `text` as HTML — shell.js
// renders it as a SEPARATE sibling element from the truncating message
// span, not a child of it. It has to live outside that span: the message
// span needs overflow:hidden for its own text-overflow:ellipsis
// truncation to work, and that clips ANY descendant that visually grows
// past the box (e.g. the taphint pill's throb animation), not just
// overflowing text. Keeping the hint as a sibling means it's never
// truncated and never clipped, regardless of how long the game's own
// message text is.
const GAMES_WITH_TAP_HINT = ['valuz', 'mojeez'];

// `outcome` is one of 'max' | 'loss' | 'zero' | 'reveal' | undefined
// (undefined = a normal completed run, further split by `isNewBest`).
// `scoreText` is a pre-formatted display value (e.g. "4", "2:07", "3
// guesses") — only used for the 'normal'-tier text, since every other
// scenario's copy is fixed and doesn't need the actual score.
export function getEndPanelContent({ gameId, outcome, scoreText, isNewBest = false }) {
  const copy = GAME_COPY[gameId];
  if (!copy) {
    throw new Error(`end-panel-content.js: no copy defined for gameId "${gameId}"`);
  }
  const tapHint = GAMES_WITH_TAP_HINT.includes(gameId);

  if (outcome === 'max') return { emoji: '🎉', headline: 'WOW!!', text: copy.max, tapHint };
  if (outcome === 'loss') return { emoji: '🙁', headline: 'BAD LUCK', text: copy.loss, tapHint };
  if (outcome === 'zero') return { emoji: '🙁', headline: 'BAD LUCK', text: 'you scored zero!', tapHint };
  if (outcome === 'reveal') return { emoji: '🙁', headline: 'BAD LUCK', text: 'you revealed the answer', tapHint };
  if (isNewBest) return { emoji: '🤩', headline: 'WELL DONE', text: "that's a new PB", tapHint };
  return { emoji: '👍🏼', headline: 'NICE', text: copy.normal(scoreText), tapHint };
}
