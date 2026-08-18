// Best-effort device/browser summary, parsed client-side out of
// navigator.userAgent (plus the Client Hints API where available) — there's
// no backend here, so this is the only signal available. UA strings are a
// bit fuzzy (Chrome's own UA also contains "Safari", iPadOS often reports
// as a Mac, etc.) — this only needs to be good enough for "which device was
// this," not a precise analytics-grade parse.
//
// Promoted out of shared/feedback.js (which originally had its own private
// copy of all of this) once the hub needed the identical device string for
// its own tester-activity logging — see index.js's tile click handler.

// Chromium's User-Agent Client Hints API (Chrome, Edge, Samsung Internet —
// not Firefox, and Safari never implements it on any platform) exposes
// device detail that navigator.userAgent no longer reliably carries once
// "UA reduction" strips it out — notably the real Android model, and the
// underlying Windows/Mac version. getHighEntropyValues() is async, so this
// kicks off the request once here at module load and caches whatever comes
// back; describeDevice() below reads the cache synchronously, which in
// practice is always well after this settles (near-instant). Stays null on
// any browser without the API, which describeDevice() treats as "no extra
// info".
let highEntropyDeviceInfo = null;
if (navigator.userAgentData?.getHighEntropyValues) {
  navigator.userAgentData
    .getHighEntropyValues(['platformVersion', 'model', 'architecture'])
    .then((info) => { highEntropyDeviceInfo = info; })
    .catch(() => {});
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

export function describeDevice() {
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
