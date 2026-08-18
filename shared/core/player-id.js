// Anonymous per-device proxy ID, for counting roughly how many distinct
// players are using the site once there's no tester code left to identify
// them by (see [[project_tester_engagement_tracking]] in project memory for
// the full reasoning — this is device/browser-scoped, not a true per-human
// count, same known limitation any backend-free "unique visitor" approach
// has). Generated once, the first time the hub is opened from the Home
// Screen icon, then reused forever after via localStorage — there's no
// event for "the tile was just added" on any platform (iOS exposes none at
// all), so first standalone launch is the earliest point any code can
// actually run in the installed context, and is the practical equivalent.
//
// crypto.randomUUID() (built into every modern browser, no library needed)
// draws from ~5×10³⁶ possible values — collision odds stay effectively zero
// at any realistic scale this site will ever reach, unlike a hand-rolled
// short random number where the odds become non-trivial once the real
// player count reaches the thousands.

const STORAGE_KEY = 'pusulz_player_id';

export function getOrCreatePlayerId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
