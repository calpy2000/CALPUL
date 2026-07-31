// Generalizes JEWELZ's "already played today" lockout so every game gets it for free.
//
// This file is tiny on purpose — it's a thin wrapper around
// game-storage.js's loadProgress(), translating the raw saved record into
// one of three plain-English "status" values that every game's index.js
// branches on. Keeping this logic in one place means all three games agree
// on what "in progress" vs "completed" means, instead of each one
// re-implementing (and possibly getting subtly wrong) the same check.

import { loadProgress } from './game-storage.js';

// Returns one of:
//   { status: 'not-started' }                 -> nothing saved for today yet
//   { status: 'in-progress', record }          -> game should resume from record.data
//   { status: 'completed', record }            -> game should stay locked, show the end screen
//
// `record` (when present) is the same object saveProgress() wrote out:
// { date, completed, data }. Games read `record.data` to restore whatever
// game-specific state they saved (tile positions, elapsed time, etc.).
export function getDailyStatus(gameId) {
  const record = loadProgress(gameId);
  if (!record) return { status: 'not-started' };
  // The ternary (condition ? a : b) picks 'completed' or 'in-progress' based
  // on the boolean `record.completed` flag that saveProgress() stored.
  return { status: record.completed ? 'completed' : 'in-progress', record };
}
