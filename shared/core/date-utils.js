// Shared date helpers so "today" and "day of year" are computed the same way
// everywhere. This file uses `export`, which is part of the ES module system
// (note <script type="module"> in every game's HTML). It means: any other
// file can `import { todayDateString } from './date-utils.js'` and use these
// functions directly, without loading a separate <script> tag for them or
// polluting the global `window` object. Modules also only run once total,
// even if multiple files import them — so this is a safe place for shared
// logic that many files depend on.

// `date = new Date()` is a default parameter: if you call todayDateString()
// with no argument, `date` defaults to right now. If you pass a specific
// Date object in (useful for testing), that gets used instead.
export function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  // getMonth() is 0-indexed (January = 0), so +1 to get a normal month number.
  // padStart(2, '0') left-pads single digits with a zero, e.g. "7" -> "07",
  // so the result always sorts and reads correctly as YYYY-MM-DD.
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns which day of the calendar year `date` falls on (1 = Jan 1st,
// 366 = Dec 31st in a leap year). This is what picks each day's puzzle: SOLVZ
// indexes into its 366 pre-generated puzzles with this number, and GLYMPZ picks
// which numbered image file to load.
export function dayOfYear(date = new Date()) {
  // "Day 0 of January" is JavaScript's Date shorthand for "the day before
  // January 1st" — i.e. December 31st of the *previous* year. Subtracting
  // that from `date` gives the elapsed time since the year began.
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start; // subtracting two Dates gives milliseconds between them
  const oneDay = 1000 * 60 * 60 * 24; // ms in a day: 1000ms * 60s * 60min * 24hr
  return Math.floor(diff / oneDay);
}
