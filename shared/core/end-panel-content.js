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
};

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

  if (outcome === 'max') return { emoji: '🎉', headline: 'WOW!!', text: copy.max };
  if (outcome === 'loss') return { emoji: '🙁', headline: 'BAD LUCK', text: copy.loss };
  if (outcome === 'zero') return { emoji: '🙁', headline: 'BAD LUCK', text: 'you scored zero!' };
  if (outcome === 'reveal') return { emoji: '🙁', headline: 'BAD LUCK', text: 'you revealed the answer' };
  if (isNewBest) return { emoji: '🤩', headline: 'WELL DONE', text: "that's a new PB" };
  return { emoji: '👍🏼', headline: 'NICE', text: copy.normal(scoreText) };
}
