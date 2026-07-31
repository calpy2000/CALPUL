// Namespaced localStorage helpers shared by every game.
//
// localStorage is a simple key/value store built into every browser. Data
// put in it survives page reloads and browser restarts (it does NOT survive
// "clear browsing data", and it's per-browser/per-device — there's no server
// involved, which is why a different browser or incognito window starts
// fresh). Every value is stored as a *string*, so objects have to be
// serialized with JSON.stringify() before saving and JSON.parse()'d back out
// after loading — that pattern shows up throughout this file.
//
// All keys are prefixed with the game's id (see storageKey below) so e.g.
// SOLVZ's saved progress ("solvz_progress") can never collide with GLYMPZ's
// ("glympz_progress") even though they use the exact same functions here.

import { todayDateString } from './date-utils.js';

// Builds the actual localStorage key, e.g. storageKey('solvz', 'progress')
// returns "solvz_progress". Not exported — only this file needs it, everything
// outside calls the named functions below instead of building keys itself.
function storageKey(gameId, name) {
  return `${gameId}_${name}`;
}

// --- In-progress / completed state for "today" ---
// `data` can hold anything game-specific (tile order, elapsed time, etc.).
// `completed: true` marks today's attempt as finished (locks further play).

// The `{ completed = false } = {}` part is a destructured parameter with a
// default. It means: saveProgress(id, data) works fine (completed defaults to
// false), and so does saveProgress(id, data, { completed: true }) — callers
// pass an options *object* instead of a long list of positional arguments,
// which is a common JS pattern once a function has more than one or two
// optional settings.
export function saveProgress(gameId, data, { completed = false } = {}) {
  const record = {
    date: todayDateString(), // stamped so loadProgress() can tell a stale (yesterday's) save apart from today's
    completed,
    data,
  };
  // JSON.stringify turns the record object into a string like
  // '{"date":"2026-07-27","completed":false,"data":{...}}' — that string is
  // the only thing localStorage actually knows how to store.
  localStorage.setItem(storageKey(gameId, 'progress'), JSON.stringify(record));
}

export function loadProgress(gameId) {
  const raw = localStorage.getItem(storageKey(gameId, 'progress'));
  if (!raw) return null; // nothing saved yet for this game, ever

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    // Malformed/corrupted JSON in storage (shouldn't normally happen, but
    // being defensive here is cheap) — treat it the same as "nothing saved".
    return null;
  }

  if (record.date !== todayDateString()) return null; // yesterday's save doesn't count today
  return record;
}

export function clearProgress(gameId) {
  localStorage.removeItem(storageKey(gameId, 'progress'));
  // Also clears today's own stamped score (but NOT best-score history —
  // that's clearAllData()'s job) so replaying today after a dev-panel reset
  // doesn't show a stale "Today: ..." left over from the run being reset.
  localStorage.removeItem(storageKey(gameId, 'todayScore'));
  localStorage.removeItem(storageKey(gameId, 'todayScoreDate'));
}

// Wipes everything for a game, including best-score history. Dev/testing use only —
// normal gameplay should only ever need clearProgress().
export function clearAllData(gameId) {
  clearProgress(gameId); // also clears today's stamped score, see above
  localStorage.removeItem(storageKey(gameId, 'bestScore'));
  localStorage.removeItem(storageKey(gameId, 'bestScoreDate'));
}

// --- Best score tracking ---
// `higherIsBetter: false` for time-based games where a lower number wins.

export function getBestScore(gameId) {
  const raw = localStorage.getItem(storageKey(gameId, 'bestScore'));
  // localStorage only stores strings, so a saved score like `47` comes back
  // as the string "47" — Number(...) converts it back to an actual number
  // so callers can compare/format it normally. `null` (no value saved yet)
  // is kept distinct from `0` (a real score of zero), which is why this
  // checks `raw === null` rather than something like `!raw`.
  return raw === null ? null : Number(raw);
}

export function getBestScoreDate(gameId) {
  return localStorage.getItem(storageKey(gameId, 'bestScoreDate'));
}

// Call this whenever a game ends with a score. It compares against the
// stored best and only overwrites it if the new score actually wins, then
// hands back a small summary object the caller uses to decide what message
// to show ("new best!" vs "solved" etc.) — see the various games' index.js.
export function submitScore(gameId, score, { higherIsBetter = true } = {}) {
  const previousBest = getBestScore(gameId);
  const isFirst = previousBest === null;
  const isNewBest =
    isFirst || (higherIsBetter ? score > previousBest : score < previousBest);
  const isTie = !isFirst && score === previousBest;

  if (isNewBest) {
    localStorage.setItem(storageKey(gameId, 'bestScore'), String(score));
    localStorage.setItem(storageKey(gameId, 'bestScoreDate'), todayDateString());
  }

  // Returning an object (rather than e.g. just `isNewBest`) lets the caller
  // read whichever fields it needs without extra function calls.
  return { previousBest, isNewBest, isTie, isFirst };
}

// --- Today's own score (separate from best-ever) ---
// The footer shows "Best" and "Today" side by side (see shell.js's
// formatFooterScore()) — but getBestScoreDate() alone can't tell us what
// today's score WAS if it didn't beat the best (that function only updates
// when a new best is actually reached). These two keep today's result
// around on its own, so it can still be shown even on a day that didn't set
// a new record.

export function saveTodayScore(gameId, score) {
  localStorage.setItem(storageKey(gameId, 'todayScore'), String(score));
  localStorage.setItem(storageKey(gameId, 'todayScoreDate'), todayDateString());
}

export function getTodayScore(gameId) {
  // Same staleness guard as loadProgress() above — a score saved on an
  // earlier day shouldn't leak into today's footer.
  if (localStorage.getItem(storageKey(gameId, 'todayScoreDate')) !== todayDateString()) {
    return null;
  }
  const raw = localStorage.getItem(storageKey(gameId, 'todayScore'));
  return raw === null ? null : Number(raw);
}

// --- Today's outcome (what actually happened, separate from `completed`) ---
// `completed` (on the record saveProgress() writes) only ever means "today's
// attempt is locked, win or lose" — it's the same whether the player won,
// gave up and revealed the solution, or (in JEWELZ/RAINZ) died. This is the
// extra layer each game's own win/loss/reveal code calls once, right next to
// its existing submitScore()/saveProgress() calls, so the feedback page can
// later show what actually happened rather than just "Completed".
//
// `outcome` shape: { revealed, usedHelp, failed, isNewBest, isTie } — every
// field a plain boolean. Not every game can produce every field (e.g. SOLVZ
// has no reveal/help/fail concept at all) — games that don't apply just pass
// `false` for those, which is what feedback.js's formatOutcomeLabel() (see
// that file) expects.

export function saveTodayOutcome(gameId, outcome) {
  localStorage.setItem(storageKey(gameId, 'todayOutcome'), JSON.stringify(outcome));
  localStorage.setItem(storageKey(gameId, 'todayOutcomeDate'), todayDateString());
}

export function getTodayOutcome(gameId) {
  // Same staleness guard as getTodayScore() above.
  if (localStorage.getItem(storageKey(gameId, 'todayOutcomeDate')) !== todayDateString()) {
    return null;
  }
  const raw = localStorage.getItem(storageKey(gameId, 'todayOutcome'));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Malformed/corrupted JSON in storage (shouldn't normally happen) —
    // treat it the same as "nothing saved" rather than throwing.
    return null;
  }
}
