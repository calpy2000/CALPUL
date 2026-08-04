// Single source-controlled switch for which tools panel (if any) shows on
// every page — the hub and all seven games call getToolMode() from here.
// Unlike a per-browser setting, this is ONE value baked directly into the
// deployed code: change TOOL_MODE below, commit, and push — the next
// deploy shows that mode to every visitor of the live site at once, so
// testers never need a special link, just the normal site URL.
//
//   'dev'  -> full dev panel (resets + solve/reveal shortcuts), for you
//   'test' -> tester panel (reset today's progress + send feedback)
//   'off'  -> no tools panel at all — the real-player experience
//
// Flip this back to 'off' before real players start using the site.
//
// HARD RULE: never push/deploy to GitHub (either PUSULZ or CALPUL) while
// this is set to 'dev'. 'dev' mode is for local-only work (e.g. building a
// devOnly game like VALUZ before it's ready for testers) — testers must
// only ever see a push made while this is 'test'. Flip back to 'test'
// before any push, no exceptions.
const TOOL_MODE = 'test';

export function getToolMode() {
  return TOOL_MODE;
}
