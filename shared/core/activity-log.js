// Logs each tester's game entries to a Google Sheet (via a Google Form's
// response endpoint), so it's possible to gauge who's actively playing vs.
// dropped off without needing a real backend — this POSTs directly to
// Google's own already-running Forms infrastructure, the same shape as any
// other client-side-only API call already on this site (EmailJS was the
// original idea; a Form/Sheet was chosen instead once the realistic email
// volume math blew past the free tier — see project memory for the full
// reasoning, not repeated here).
//
// Throttled to once per tester per game per CALENDAR DAY, via a small
// localStorage flag checked before sending — a resume, a repeat visit, or
// the dev panel's "Reset today's progress" shouldn't re-fire, since the
// goal is "did this tester play this game today," not counting page loads.
//
// Fire-and-forget: never awaited by the caller (see index.js's tile click
// handler), and never throws — a network hiccup here must not delay or
// break the actual navigation into the game.

import { getStoredTester } from './beta-gate.js';
import { todayDateString } from './date-utils.js';
import { describeDevice } from './device-info.js';
import { getOrCreatePlayerId } from './player-id.js';

// The form's real response endpoint and each field's entry ID — from
// PUSULZ's own Google Form (created 2026-08-18), linked to a Google Sheet
// that gets one new row per submission. If the form's questions are ever
// rebuilt from scratch, these IDs change — regenerate them via the form's
// "⋮ → Pre-fill form" (type a distinct, easy-to-spot fake value into each
// field, then read the entry.NNNNNNN=value pairs back out of the
// generated link).
const FORM_RESPONSE_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScOlBm__wMRxjujJ-uh4VZdFxLOVrJ2y5AuWuszGQSiqGXzCg/formResponse';
const ENTRY_IDS = {
  tester: 'entry.17692534',
  game: 'entry.806180574',
  device: 'entry.1696129681',
  playerId: 'entry.738807896',
  date: 'entry.970415715',
  time: 'entry.922637502',
};

function currentTimeString(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function storageKey(gameId) {
  return `pusulz_activity_logged_${gameId}_${todayDateString()}`;
}

// Call right before navigating a tester into a game — see index.js's tile
// click handler. No-ops silently if there's no stored tester (shouldn't
// normally happen, since the beta-gate always runs first) or if this exact
// tester/game/day combination has already been logged.
export function logGameEntry(gameId, gameTitle) {
  const tester = getStoredTester();
  if (!tester) return;
  if (localStorage.getItem(storageKey(gameId)) === '1') return;
  // Marked BEFORE the fetch settles, not after — mode: 'no-cors' below means
  // the response can never actually be read to confirm success either way,
  // so there's nothing more reliable to wait on, and marking early also
  // avoids a double-send from a fast double-click/double-tap.
  localStorage.setItem(storageKey(gameId), '1');

  const body = new URLSearchParams({
    [ENTRY_IDS.tester]: tester.name,
    [ENTRY_IDS.game]: gameTitle,
    [ENTRY_IDS.device]: describeDevice(),
    [ENTRY_IDS.playerId]: getOrCreatePlayerId(),
    [ENTRY_IDS.date]: todayDateString(),
    [ENTRY_IDS.time]: currentTimeString(),
  });

  // navigator.sendBeacon(), not fetch() — this fires right before the tile
  // click navigates away to the game (see index.js), and a plain fetch()
  // can be silently cancelled by the browser the instant a page starts
  // unloading, before the request ever completes. sendBeacon() is the
  // browser's own purpose-built API for exactly this "small POST, right as
  // the page is going away" case — it's queued and guaranteed to still be
  // sent even after this page is gone, unlike fetch(). Passing a
  // URLSearchParams body sets the same application/x-www-form-urlencoded
  // content type Google Forms expects, same as the working curl test.
  // Falls back to a fire-and-forget fetch() on the rare browser without
  // sendBeacon support at all (very old browsers only).
  if (navigator.sendBeacon) {
    navigator.sendBeacon(FORM_RESPONSE_URL, body);
  } else {
    fetch(FORM_RESPONSE_URL, { method: 'POST', mode: 'no-cors', body }).catch(() => {});
  }
}
