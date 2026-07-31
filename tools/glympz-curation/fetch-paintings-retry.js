// Same Met Museum fetch logic as fetch-paintings-batch.js, but for an
// explicit non-contiguous list of days (the batch script assumes
// startDay, startDay+1, startDay+2... which doesn't fit retrying only the
// specific days that failed the first time around).
//
// Usage: node fetch-paintings-retry.js <dayRanges>
//   dayRanges: "118,121-123,144-162"
// Pulls artist names positionally from paintings-artists.json using
// index = day - 117 (day 117 is index 0, the first day of the paintings
// block), so it stays in sync with fetch-paintings-batch.js's numbering.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'glympz', 'images');
const SIZE = 500;
const PAINTINGS_START_DAY = 117;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseDayRanges(str) {
  const days = [];
  str.split(',').forEach((part) => {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let d = a; d <= b; d++) days.push(d);
    } else {
      days.push(Number(part));
    }
  });
  return days;
}

function lastName(fullName) {
  return fullName.trim().split(/\s+/).pop().toLowerCase();
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`non-JSON response (likely rate-limited): ${text.slice(0, 80)}`);
    err.rateLimited = true;
    throw err;
  }
}

async function findPaintingImage(artist) {
  const target = lastName(artist);
  for (const isHighlight of [true, false]) {
    const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(artist)}&hasImages=true${isHighlight ? '&isHighlight=true' : ''}`;
    const searchJson = await fetchJson(searchUrl);
    const ids = searchJson.objectIDs || [];
    // Fewer candidates + a longer gap between them — checking 15 candidates
    // back-to-back at 150ms is itself enough of a burst to trip the same
    // throttle that hits at the day level, before we even get to the next
    // artist.
    for (const id of ids.slice(0, 8)) {
      const obj = await fetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
      await sleep(500);
      const artistMatches = obj.artistDisplayName && obj.artistDisplayName.toLowerCase().includes(target);
      if (artistMatches && obj.isPublicDomain && obj.primaryImage) {
        return { title: obj.title, artistDisplayName: obj.artistDisplayName, imageUrl: obj.primaryImage };
      }
    }
  }
  return null;
}

async function saveCropped(imageUrl, dayNumber) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    if (imgRes.status === 429 || imgRes.status >= 500) {
      const err = new Error(`image download throttled (HTTP ${imgRes.status})`);
      err.rateLimited = true;
      throw err;
    }
    return false;
  }
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.max(0, Math.round((meta.width - side) / 2));
  const top = Math.max(0, Math.round((meta.height - side) / 2));
  await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE)
    .jpeg({ quality: 88 })
    .toFile(path.join(IMAGES_DIR, `${dayNumber}.jpg`));
  return true;
}

async function main() {
  const dayRangesStr = process.argv[2];
  if (!dayRangesStr) {
    console.error('Usage: node fetch-paintings-retry.js <dayRanges>');
    process.exit(1);
  }
  const artists = JSON.parse(fs.readFileSync(path.join(__dirname, 'paintings-artists.json'), 'utf8'));
  const days = parseDayRanges(dayRangesStr);

  const BACKOFFS_MS = [15000, 30000, 60000];
  const failures = [];
  for (const day of days) {
    const artist = artists[day - PAINTINGS_START_DAY];
    if (!artist) { console.log(`day ${day}: no artist at this index, skipping`); continue; }

    let lastErr = null;
    let succeeded = false;
    for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
      try {
        const found = await findPaintingImage(artist);
        if (!found) { lastErr = { reason: 'no verified Met result', rateLimited: false }; break; }
        const ok = await saveCropped(found.imageUrl, day);
        if (!ok) { lastErr = { reason: 'download failed', rateLimited: false }; break; }
        console.log(`day ${day} (searched "${artist}", got "${found.title}" by ${found.artistDisplayName}): ok${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);
        succeeded = true;
        break;
      } catch (err) {
        lastErr = { reason: err.message, rateLimited: !!err.rateLimited };
        if (err.rateLimited && attempt < BACKOFFS_MS.length) {
          const waitMs = BACKOFFS_MS[attempt];
          console.log(`day ${day} (${artist}): rate-limited, backing off ${waitMs / 1000}s before retry...`);
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }
    if (!succeeded) {
      failures.push({ day, artist, reason: lastErr.reason });
      console.log(`day ${day} (${artist}): FAILED - ${lastErr.reason}`);
    }
    await sleep(2000);
  }

  console.log(`\nDone. ${days.length - failures.length}/${days.length} succeeded.`);
  if (failures.length) fs.writeFileSync(path.join(__dirname, `painting-retry-failures-${Date.now()}.json`), JSON.stringify(failures, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
