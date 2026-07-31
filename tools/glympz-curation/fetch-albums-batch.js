// Fetches album cover art via the iTunes Search API (free, no key needed).
// Artwork URLs come back capped at 100x100 by default — iTunes/Apple's CDN
// supports swapping that suffix for a much higher resolution, a well-known
// trick, which is what getHighResArtwork() does below.
//
// Usage: node fetch-albums-batch.js <startDay>

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'glympz', 'images');
const SIZE = 500;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getHighResArtwork(url100) {
  return url100.replace(/\d+x\d+bb\.jpg$/, '1200x1200bb.jpg');
}

async function fetchAlbumArt(artist, album) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + album)}&entity=album&limit=1`;
  const res = await fetch(url);
  const json = await res.json();
  const result = json.results && json.results[0];
  return result ? getHighResArtwork(result.artworkUrl100) : null;
}

async function saveCropped(imageUrl, dayNumber) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return false;
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  // Album artwork is already square, but crop defensively anyway in case a
  // particular result isn't exactly square.
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
  const startDay = parseInt(process.argv[2], 10);
  if (!startDay) {
    console.error('Usage: node fetch-albums-batch.js <startDay>');
    process.exit(1);
  }
  const albums = JSON.parse(fs.readFileSync(path.join(__dirname, 'albums-list.json'), 'utf8'));

  const failures = [];
  for (let i = 0; i < albums.length; i++) {
    const day = startDay + i;
    const { artist, album } = albums[i];
    try {
      const artUrl = await fetchAlbumArt(artist, album);
      if (!artUrl) { failures.push({ day, artist, album, reason: 'no iTunes result' }); console.log(`day ${day} (${artist} - ${album}): FAILED - no result`); continue; }
      const ok = await saveCropped(artUrl, day);
      console.log(`day ${day} (${artist} - ${album}): ${ok ? 'ok' : 'FAILED - download error'}`);
      if (!ok) failures.push({ day, artist, album, reason: 'download failed' });
    } catch (err) {
      failures.push({ day, artist, album, reason: err.message });
      console.log(`day ${day} (${artist} - ${album}): FAILED - ${err.message}`);
    }
    await sleep(300);
  }

  console.log(`\nDone. ${albums.length - failures.length}/${albums.length} succeeded.`);
  if (failures.length) fs.writeFileSync(path.join(__dirname, `album-failures-${Date.now()}.json`), JSON.stringify(failures, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
