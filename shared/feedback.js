// Full-page structured feedback form — reached via the tester panel's "Send
// feedback" button (see shared/core/tools-panel.js, which builds this
// page's URL with ?game=... and ?returnTo=... already attached). Lives here
// as ONE shared page rather than a per-game copy, since every game and the
// hub link to the exact same file.

import { todayDateString } from './core/date-utils.js';
import { getTodayScore, getTodayOutcome, loadProgress } from './core/game-storage.js';
import { getDailyStatus } from './core/daily-lock.js';
import { getStoredTester } from './core/beta-gate.js';
import { GAMES } from '../games-registry.js';
import { hidePageLoadingIndicator } from './core/loading-indicator.js';

// See loading-indicator.js's own comment: every file imported above has
// already finished loading by the time this line runs, so the spinner's
// job is done. This page previously had no spinner wiring at all.
hidePageLoadingIndicator();

// Chromium's User-Agent Client Hints API (Chrome, Edge, Samsung Internet —
// not Firefox, and Safari never implements it on any platform) exposes
// device detail that navigator.userAgent no longer reliably carries once
// "UA reduction" strips it out — notably the real Android model, and the
// underlying Windows/Mac version. getHighEntropyValues() is async, so this
// kicks off the request once here at page load and caches whatever comes
// back; describeDevice() below reads the cache synchronously, which in
// practice is always well after this settles (near-instant) — the tester
// still has a whole form to fill in first. Stays null on any browser
// without the API, which describeDevice() treats as "no extra info".
let highEntropyDeviceInfo = null;
if (navigator.userAgentData?.getHighEntropyValues) {
  navigator.userAgentData
    .getHighEntropyValues(['platformVersion', 'model', 'architecture'])
    .then((info) => { highEntropyDeviceInfo = info; })
    .catch(() => {});
}

const FEEDBACK_EMAIL = 'pusulzbetafeedback@gmail.com';
const HUB_TITLE = 'PUSULZ'; // matches <title>PUSULZ</title> in the hub's own index.html

// Matches the emoji shown next to each option's tagline in feedback.html's
// "How you feeling?" rating row — kept here as its own small lookup (rather
// than reading it back out of the DOM) since the radio's `value` is just
// the plain tagline text ("happy"), not the emoji.
const SATISFACTION_EMOJI = {
  fuming: '🤬',
  peeved: '🙁',
  OK: '😐',
  happy: '🙂',
  'wowser!': '🤩',
  'n/a': '🤷',
};

const params = new URLSearchParams(window.location.search);
const game = params.get('game') || HUB_TITLE;
// Falls back to the hub itself if this page is ever opened with no
// ?returnTo= (e.g. typed in directly) — shared/feedback.html sits one level
// above the hub's own index.html, hence '../index.html'.
const returnTo = params.get('returnTo') || '../index.html';

document.getElementById('feedback-back').href = returnTo;
document.getElementById('feedback-email').textContent = FEEDBACK_EMAIL;

// Appends one option per game (SOLVZ, GLYMPZ, ...) after the fixed Home
// Page/All/None choices already in the HTML, then defaults the whole
// dropdown to wherever the tester actually opened "Send feedback" from —
// the hub maps to "Home Page", any game page maps to that game's own title.
const sectionSelect = document.getElementById('feedback-section');
GAMES.forEach((g) => {
  const option = document.createElement('option');
  option.value = g.title;
  option.textContent = g.title;
  sectionSelect.appendChild(option);
});
sectionSelect.value = game === HUB_TITLE ? 'Home Page' : game;

// "M:SS" for anything under an hour (matches the hub's own formatTime()),
// falling back to "H:MM:SS" for the unlikely case a total daily play time
// crosses 60 minutes — the per-game Time column will never need the hour
// part, but the total-duration footer below might on a heavy testing day.
function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const secs = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${secs}` : `${m}:${secs}`;
}

// 'not-started' -> Not played, 'in-progress' -> In progress, 'completed' ->
// Completed — same three states daily-lock.js defines, just written out in
// full words for a tester reading the email rather than code branching on it.
function statusLabel(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'in-progress') return 'In progress';
  return 'Not played';
}

// Turns a saveTodayOutcome() record (see game-storage.js) into a short
// human label. A game can rack up more than one at once — e.g. SLYDZ/QUADZ
// can be "Used help" AND still land a "New best" — so this returns every
// applicable label, not just one, joined for the table cell. Order runs
// "how you got there" (help/revealed/failed) before "how it turned out"
// (equalled/new best), and null (nothing recorded — game hasn't been
// finished today) falls back to '—', same as every other empty cell.
function formatOutcomeLabel(outcome) {
  if (!outcome) return '—';
  const labels = [];
  if (outcome.usedHelp) labels.push('Used help');
  if (outcome.revealed) labels.push('Revealed');
  if (outcome.failed) labels.push('Failed');
  if (outcome.isTie) labels.push('Equalled best');
  if (outcome.isNewBest) labels.push('New best');
  return labels.length ? labels.join(', ') : '—';
}

// Best-effort iPhone model guess from screen dimensions. iOS Safari never
// puts the real model in navigator.userAgent (Apple has kept it generic
// since iOS 13) and doesn't support the User-Agent Client Hints API other
// browsers expose for this — so CSS logical resolution (screen size x
// devicePixelRatio) is the only signal left, matched against Apple's
// published per-model dimensions. Several models are physically identical
// and thus indistinguishable this way (e.g. 12/12 Pro/13/14 all report
// 390x844 @3x) — those list every candidate rather than guessing one.
// screen.width/height reflect the CURRENT orientation, not always portrait,
// so the lookup key normalizes to (long side, short side) first. Anything
// not in the table — a brand-new model released after this was written, or
// an old one not worth covering — just falls back to plain "iPhone" rather
// than guessing wrong.
const IPHONE_MODELS_BY_RESOLUTION = {
  '568x320@2': 'iPhone 5/5s/5c/SE (1st gen)',
  '667x375@2': 'iPhone 6/6s/7/8/SE (2nd/3rd gen)',
  '736x414@3': 'iPhone 6/6s/7/8 Plus',
  '812x375@3': 'iPhone X/XS/11 Pro',
  '896x414@2': 'iPhone XR/11',
  '896x414@3': 'iPhone XS Max/11 Pro Max',
  '780x360@3': 'iPhone 12 mini/13 mini',
  '844x390@3': 'iPhone 12/12 Pro/13/14/16e',
  '926x428@3': 'iPhone 12 Pro Max/13 Pro Max/14 Plus',
  '852x393@3': 'iPhone 14 Pro/15/15 Pro/16',
  '932x430@3': 'iPhone 14 Pro Max/15 Plus/15 Pro Max/16 Plus',
  '874x402@3': 'iPhone 16 Pro',
  '956x440@3': 'iPhone 16 Pro Max',
};

function guessIphoneModel() {
  const long = Math.max(window.screen.width, window.screen.height);
  const short = Math.min(window.screen.width, window.screen.height);
  const dpr = window.devicePixelRatio || 1;
  return IPHONE_MODELS_BY_RESOLUTION[`${long}x${short}@${dpr}`] || null;
}

// Fallback Android model parse straight out of navigator.userAgent, for
// browsers with no Client Hints support (Firefox Android, older Chrome) —
// describeDevice() below prefers highEntropyDeviceInfo.model when that's
// available, since newer Chrome has started blanking the model out of the
// UA string the same way it long has for desktop. UA strings put the model
// right after the OS version, e.g. "...Android 13; Pixel 7) AppleWebKit..."
// or "...Android 13; Pixel 7 Build/TQ3A...) AppleWebKit...", hence stopping
// the capture at " Build/" or the closing paren, whichever comes first.
function guessAndroidModel(ua) {
  const match = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/);
  return match ? match[1].trim() : null;
}

// Best-effort device/browser summary for the feedback email — there's no
// backend here (see the module comment above), so this is just parsed
// straight out of navigator.userAgent client-side. UA strings are a bit
// fuzzy (Chrome's own UA also contains "Safari", iPadOS often reports as a
// Mac, etc.) — this only needs to be good enough for "which device did the
// tester see this on," not a precise analytics-grade parse.
function describeDevice() {
  const ua = navigator.userAgent;

  let os = 'Unknown OS';
  if (/iPhone/.test(ua)) {
    const model = guessIphoneModel();
    os = model ? `iPhone (probably ${model})` : 'iPhone';
  } else if (/iPad/.test(ua)) {
    os = 'iPad';
  } else if (/Android/.test(ua)) {
    const model = highEntropyDeviceInfo?.model || guessAndroidModel(ua);
    os = model ? `Android (${model})` : 'Android';
  } else if (/Mac OS X/.test(ua)) {
    os = 'Mac';
    // architecture is Client Hints-only (Chrome/Edge on Mac) — Safari never
    // supports the API at all, so this quietly no-ops there.
    if (highEntropyDeviceInfo?.architecture === 'arm') os = 'Mac (Apple Silicon)';
    else if (highEntropyDeviceInfo?.architecture === 'x86') os = 'Mac (Intel)';
  } else if (/Windows/.test(ua)) {
    os = 'Windows';
    // Windows 11 still reports itself as "Windows NT 10.0" in the UA string
    // proper — telling it apart from Windows 10 needs Client Hints'
    // platformVersion, whose major component is >= 13 on 11 and lower on 10
    // (Chromium's own documented mapping, not guessable from anything else
    // exposed to the page).
    const platformMajorVersion = parseInt(highEntropyDeviceInfo?.platformVersion, 10);
    if (!Number.isNaN(platformMajorVersion)) {
      os = platformMajorVersion >= 13 ? 'Windows 11' : 'Windows 10';
    }
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/CriOS\//.test(ua)) browser = 'Chrome (iOS)';
  else if (/FxiOS\//.test(ua)) browser = 'Firefox (iOS)';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';

  return `${os} · ${browser} · ${window.screen.width}×${window.screen.height}`;
}

// Escapes the few characters that would otherwise break HTML structure (or
// get silently swallowed by the browser) when free-typed text — Details,
// mainly — gets dropped into buildGameplayTableHtml()/buildMessage()'s HTML
// string below. Not a security boundary (this only ever goes onto the
// tester's own clipboard) — just what's needed for e.g. a Details note
// containing "<3" or "a && b" to paste back out as literal text instead of
// being interpreted as a tag.
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Reads every game's saved state ONCE — shared by both the plain-text table
// (buildGameplayTableText) and the real HTML <table> (buildGameplayTableHtml)
// below, so the two never have a chance to drift out of sync with each other.
function computeGameplayRows() {
  let totalSeconds = 0;

  const rows = GAMES.map((g) => {
    const status = getDailyStatus(g.id).status;

    const score = getTodayScore(g.id);
    const scoreLabel = score === null ? '—' : g.scoreIsTime ? formatDuration(score) : String(score);

    // Every game's saveProgress() `data` payload includes `seconds` (see
    // each game's index.js) regardless of whether its SCORE is a duration —
    // this is genuinely separate info from the Score column above for the
    // 3 count-based games (JEWELZ/MUVEEZ/RAINZ), and duplicates it for the
    // 4 time-based ones, which is expected (their score IS the time).
    const seconds = loadProgress(g.id)?.data?.seconds;
    const timeLabel = typeof seconds === 'number' ? formatDuration(seconds) : '—';
    if (typeof seconds === 'number') totalSeconds += seconds;

    const outcomeLabel = formatOutcomeLabel(getTodayOutcome(g.id));

    return { game: g.title, status: statusLabel(status), score: scoreLabel, time: timeLabel, outcome: outcomeLabel };
  });

  return { rows, totalSeconds };
}

// Builds a plain-text table (space-padded columns, like `git diff --stat`)
// — this is what mailto: bodies are stuck with, since the mailto: protocol
// has no way to carry HTML at all. Column widths are computed from the
// actual content rather than hard-coded, so a longer status/outcome value
// never gets clipped.
//
// NOTE: this only lines up visually in a monospace-font body. Most mail
// apps' plain-text compose view renders that way, but it's not guaranteed
// (a proportional font still shows every row, just not column-aligned) —
// see buildGameplayTableHtml() below for the "Copy feedback" path's fix
// for that.
function buildGameplayTableText(rows, totalSeconds) {
  const header = ['Game', 'Status', 'Score', 'Time', 'Outcome'];
  const rowArrays = rows.map((r) => [r.game, r.status, r.score, r.time, r.outcome]);

  const columns = [header, ...rowArrays];
  const widths = header.map((_, col) => Math.max(...columns.map((row) => row[col].length)));
  const formatRow = (row) => row.map((cell, col) => cell.padEnd(widths[col])).join('  ');
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');

  const table = [formatRow(header), divider, ...rowArrays.map(formatRow)].join('\n');
  return `${table}\n\nTotal play time today: ${formatDuration(totalSeconds)}`;
}

// A real HTML <table>, with inline styles (nothing relies on an external
// stylesheet, since this is headed for the clipboard, not a page this site
// controls) — guaranteed-aligned columns regardless of the destination's
// font, unlike the plain-text version above. Only reachable via "Copy
// feedback instead": mailto:'s body param can't carry HTML at all, so
// "Send feedback" is stuck with buildGameplayTableText() no matter what.
function buildGameplayTableHtml(rows, totalSeconds) {
  const thStyle = 'border:1px solid #c7cdd6;padding:4px 10px;text-align:left;background:#eef0f3;font-family:sans-serif;font-size:13px;';
  const tdStyle = 'border:1px solid #c7cdd6;padding:4px 10px;font-family:sans-serif;font-size:13px;';
  const th = (label) => `<th style="${thStyle}">${label}</th>`;
  const td = (value) => `<td style="${tdStyle}">${escapeHtml(value)}</td>`;

  const headerRow = `<tr>${['Game', 'Status', 'Score', 'Time', 'Outcome'].map(th).join('')}</tr>`;
  const bodyRows = rows
    .map((r) => `<tr>${[r.game, r.status, r.score, r.time, r.outcome].map(td).join('')}</tr>`)
    .join('');

  return (
    `<table style="border-collapse:collapse;">${headerRow}${bodyRows}</table>` +
    `<p style="font-family:sans-serif;font-size:13px;">Total play time today: <strong>${formatDuration(totalSeconds)}</strong></p>`
  );
}

// Reads the form and returns { subject, body }, or null (having already
// prompted the tester to fix whatever's missing) if the Type <select> or
// the Satisfaction rating hasn't been answered yet. Shared by both the
// Send and Copy buttons below, since they're built from the exact same
// fields.
function buildMessage() {
  const typeSelect = document.getElementById('feedback-type');
  const feedbackType = typeSelect.value;
  if (!feedbackType) {
    // reportValidity() shows the browser's own native "please select an
    // item" bubble, same one you'd get from a required <select> inside a
    // real <form>.
    typeSelect.reportValidity();
    return null;
  }

  const ratingInput = document.querySelector('input[name="feedback-rating"]:checked');
  if (!ratingInput) {
    // Same reportValidity() trick, called on the first radio in the group
    // (any one of them can anchor the "required" bubble for the whole
    // named group).
    document.querySelector('input[name="feedback-rating"]').reportValidity();
    return null;
  }
  const satisfaction = ratingInput.value;

  const details = document.getElementById('feedback-details').value.trim();
  const section = document.getElementById('feedback-section').value;
  const { rows, totalSeconds } = computeGameplayRows();

  // The tester's name comes from whichever entry code they typed into the
  // beta gate (see shared/core/beta-gate.js) — falls back to "Unknown" for
  // the rare case this page is opened on a device that somehow has no
  // stored tester (shouldn't normally happen, since the gate blocks the hub
  // itself until a code is entered).
  const tester = getStoredTester()?.name || 'Unknown';
  const device = describeDevice();

  const subject = `[${game}] ${feedbackType}`;
  const body = [
    `Tester: ${tester}`,
    `Section: ${section}`,
    `Date: ${todayDateString()}`,
    `Device: ${device}`,
    `Feedback type: ${feedbackType}`,
    `Satisfaction: ${SATISFACTION_EMOJI[satisfaction]} ${satisfaction}`,
    '',
    'Details:',
    details || '(add details here)',
    '',
    `Today's gameplay (${todayDateString()}):`,
    buildGameplayTableText(rows, totalSeconds),
  ].join('\n');

  // Only used by "Copy feedback instead" (see below) — mailto:'s body
  // param has no way to carry HTML, so "Send feedback" only ever uses
  // `body` above.
  const html =
    `<p style="font-family:sans-serif;font-size:13px;">` +
    `Tester: ${escapeHtml(tester)}<br>` +
    `Section: ${escapeHtml(section)}<br>` +
    `Date: ${todayDateString()}<br>` +
    `Device: ${escapeHtml(device)}<br>` +
    `Feedback type: ${escapeHtml(feedbackType)}<br>` +
    `Satisfaction: ${SATISFACTION_EMOJI[satisfaction]} ${escapeHtml(satisfaction)}</p>` +
    `<p style="font-family:sans-serif;font-size:13px;"><strong>Details:</strong><br>${escapeHtml(details || '(add details here)').replace(/\n/g, '<br>')}</p>` +
    `<p style="font-family:sans-serif;font-size:13px;"><strong>Today's gameplay (${todayDateString()}):</strong></p>` +
    buildGameplayTableHtml(rows, totalSeconds);

  return { subject, body, html };
}

// Writes both a text/plain and a text/html clipboard flavor for a built
// message (see buildMessage()) — shared by "Send feedback" (which copies as
// a formatting fallback, below) and "Copy feedback instead" (which copies as
// its own whole point). Returns whether the copy actually succeeded, since
// both ClipboardItem and writeText can throw (e.g. no HTTPS, denied
// permission) and each caller needs to react to that differently. Includes
// To:/Subject: as plain text lines (not just the body) so the copied block
// is self-contained — a tester pasting it into ANY app, email or otherwise,
// still has everything needed to send it on manually.
async function copyMessageToClipboard(message) {
  const fullText = `To: ${FEEDBACK_EMAIL}\nSubject: ${message.subject}\n\n${message.body}`;
  const fullHtml =
    `<p style="font-family:sans-serif;font-size:13px;">To: ${FEEDBACK_EMAIL}<br>Subject: ${escapeHtml(message.subject)}</p>` +
    message.html;
  try {
    if (window.ClipboardItem) {
      // Writing BOTH text/plain and text/html to the clipboard in one call
      // is what lets this paste as a real, aligned HTML <table> into a
      // rich-text compose box (the default in Gmail/Outlook web, not just
      // their plain-text mode) — the destination app picks whichever flavor
      // it understands, falling back to the plain-text version everywhere
      // else (a bare textarea, Notes, etc).
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([fullText], { type: 'text/plain' }),
          'text/html': new Blob([fullHtml], { type: 'text/html' }),
        }),
      ]);
    } else {
      // Older/unsupported browser — falls back to plain text only.
      await navigator.clipboard.writeText(fullText);
    }
    return true;
  } catch {
    return false;
  }
}

const copyStatus = document.getElementById('feedback-copy-status');
let copyStatusTimer = null;

document.getElementById('feedback-submit').addEventListener('click', () => {
  const message = buildMessage();
  if (!message) return;
  // mailto:'s body param can only ever carry plain text — a hard limitation
  // of the mailto: URL scheme itself — so this is always the plainer,
  // alignment-not-guaranteed table rather than the nicely-formatted one
  // "Copy feedback instead" can produce. An earlier version tried copying
  // that nicer table to the clipboard and asking the tester to paste it in
  // instead, but that reminder lives in the email BODY — by the time
  // they're looking at it they've already switched apps and away from any
  // on-page confirmation, and in practice testers missed it and sent the
  // placeholder text as-is. Pre-filling directly, even with plainer
  // formatting, is more reliable than a step that's easy to skip
  // unnoticed — "Copy feedback instead" remains the way to get the nicer
  // formatting, for anyone who wants it.
  //
  // Navigating to a mailto: URL is what actually opens the browser's
  // configured mail app (or a "choose an app" prompt) with the subject/body
  // pre-filled — there's no way to send the email directly from a static
  // page with no backend. If that opens an app the tester doesn't actually
  // use (e.g. an unconfigured default on their phone/PC), "Copy feedback
  // instead" below is the fallback.
  window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
});

document.getElementById('feedback-copy').addEventListener('click', async () => {
  const message = buildMessage();
  if (!message) return;

  clearTimeout(copyStatusTimer);
  const copied = await copyMessageToClipboard(message);
  copyStatus.textContent = copied
    ? 'Copied! Paste it into your mail app and send.'
    : "Couldn't copy automatically — please select and copy the text yourself.";
  copyStatusTimer = setTimeout(() => { copyStatus.textContent = ''; }, 4000);
});
