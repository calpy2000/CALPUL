// Generic batch fetcher for anything sourced via Wikipedia's pageimages API
// (same technique proven in the MUVEEZ pipeline) — used for both
// "portraits" (historical figures, all safely public-domain since everyone
// on the list died decades ago) and "varied photos" (landmarks/nature/
// wildlife) since both are just "look up a Wikipedia topic, grab its main
// image" with no other differences.
//
// Crop style differs by category: portraits use a TOP-weighted crop (keeps
// the face in frame on a tall portrait photo, same reasoning as MUVEEZ's
// early poster-cropping experiments), photos use a plain CENTER crop (no
// single "important" region to protect).
//
// Usage: node fetch-wikipedia-batch.js <listFile> <dayRanges> <cropStyle>
//   dayRanges: "21-70" or "163-199,217,297,304,324,331,334,357,364"
//   cropStyle: "top" | "center"

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'glympz', 'images');
const SIZE = 500;

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

// Wikimedia's API etiquette (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)
// requires a descriptive User-Agent identifying the client — omitting it
// (the default from a plain fetch()) gets rate-limited almost immediately.
// A ~600ms delay between requests keeps well clear of the limit too.
const USER_AGENT = 'TODAYZ-GAMZ-GLYMPZ-image-curation/1.0 (personal hobby project, non-commercial)';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchTopic(topic) {
  // A 1000px thumbnail (piprop=thumbnail) instead of the full-res original —
  // some of these portraits are multi-megabyte scans, and those specific
  // full-size downloads kept hitting a persistent HTTP 429 even after a
  // 105s total backoff, while everything else succeeded immediately. We
  // resize to 500x500 anyway, so the smaller thumbnail (served off a
  // different, less aggressively throttled thumb path) is strictly better.
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=1000&titles=${encodeURIComponent(topic)}&format=json&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`non-JSON response (likely rate-limited): ${text.slice(0, 80)}`);
    err.rateLimited = true;
    throw err;
  }
  const pages = json.query && json.query.pages;
  const page = pages && Object.values(pages)[0];
  return page && page.thumbnail ? page.thumbnail.source : null;
}

async function saveCropped(imageUrl, dayNumber, cropStyle) {
  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!imgRes.ok) {
    // upload.wikimedia.org throttles under the same bursts that trip the
    // API rate limit; a non-2xx here (rather than a network error) is that
    // same signal, so treat it the same way (worth backing off and retrying)
    // instead of immediately giving up on the day.
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
  const top = cropStyle === 'top' ? 0 : Math.max(0, Math.round((meta.height - side) / 2));

  await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE)
    .jpeg({ quality: 88 })
    .toFile(path.join(IMAGES_DIR, `${dayNumber}.jpg`));
  return true;
}

async function main() {
  const [listFile, dayRangesStr, cropStyle] = process.argv.slice(2);
  if (!listFile || !dayRangesStr || !cropStyle) {
    console.error('Usage: node fetch-wikipedia-batch.js <listFile> <dayRanges> <cropStyle:top|center>');
    process.exit(1);
  }
  const topics = JSON.parse(fs.readFileSync(path.join(__dirname, listFile), 'utf8'));
  const days = parseDayRanges(dayRangesStr);

  // The sandbox's outbound network hits a burst throttle well before
  // Wikimedia's own documented limits would kick in (confirmed: the same
  // "too many requests" pattern happens on an entirely unrelated host, the
  // Met Museum API, at similar volumes) — so a fixed inter-request delay
  // isn't enough by itself. Back off hard and retry in place on a
  // rate-limited response instead of burning through the rest of the list
  // while blocked.
  const BACKOFFS_MS = [15000, 30000, 60000];

  const failures = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const topic = topics[i];
    if (!topic) { console.log(`day ${day}: no topic left in list, skipping`); continue; }

    let lastErr = null;
    let succeeded = false;
    for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
      try {
        const imageUrl = await fetchTopic(topic);
        if (!imageUrl) { lastErr = { reason: 'no Wikipedia image', rateLimited: false }; break; }
        const ok = await saveCropped(imageUrl, day, cropStyle);
        if (!ok) { lastErr = { reason: 'download failed', rateLimited: false }; break; }
        console.log(`day ${day} (${topic}): ok${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);
        succeeded = true;
        break;
      } catch (err) {
        lastErr = { reason: err.message, rateLimited: !!err.rateLimited };
        if (err.rateLimited && attempt < BACKOFFS_MS.length) {
          const waitMs = BACKOFFS_MS[attempt];
          console.log(`day ${day} (${topic}): rate-limited, backing off ${waitMs / 1000}s before retry...`);
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }
    if (!succeeded) {
      failures.push({ day, topic, reason: lastErr.reason });
      console.log(`day ${day} (${topic}): FAILED - ${lastErr.reason}`);
    }
    await sleep(2500); // stay well clear of the burst throttle
  }

  console.log(`\nDone. ${days.length - failures.length}/${days.length} succeeded.`);
  if (failures.length) {
    console.log('Failures:', JSON.stringify(failures, null, 2));
    fs.writeFileSync(path.join(__dirname, `failures-${Date.now()}.json`), JSON.stringify(failures, null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
