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
const TOOL_MODE = 'test';

export function getToolMode() {
  return TOOL_MODE;
}
