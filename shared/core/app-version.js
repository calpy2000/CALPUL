// Single source of truth for the version number shown top-right of the
// dev/tester tools panel's title row (see tools-panel.js). Format is
// MAJOR.MINOR, plain integers, no zero-padding (e.g. "1.2", "1.12").
//
// MINOR is bumped by 1 automatically as one of the changes included in
// every push to GitHub — so it roughly tracks "how many pushes since the
// last major version." MAJOR only changes when the user explicitly asks
// for it, which also resets MINOR back to 1.
export const APP_VERSION = '4.21';
