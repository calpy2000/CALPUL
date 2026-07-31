// Fetches famous paintings via the Met Museum's Open Access API (free, no
// key, all confirmed public domain). For each artist, searches with
// `isHighlight=true` (the Met's own curated "notable/well-known work" flag)
// so we get famous pieces rather than obscure minor works, then picks the
// first result that has isPublicDomain:true and a primaryImage.
//
// Usage: node fetch-paintings-batch.js <startDay>

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'glympz', 'images');
const SIZE = 500;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// The Met's `q=` search is full-text relevance search across ALL fields
// (medium, exhibition history, culture, etc.) — it does NOT guarantee a
// match is actually attributed to the artist you searched for (confirmed
// by testing: searching "Rembrandt" surfaced a completely unrelated
// Byzantine reliquary that just happened to rank as relevant). The
// `artistOrCulture=true` param that's supposed to restrict this returned 0
// results even for known-good queries, so rather than trust it, this
// verifies the match CLIENT-SIDE: only accepts an object whose own
// `artistDisplayName` field actually contains the artist's last name.
function lastName(fullName) {
  return fullName.trim().split(/\s+/).pop().toLowerCase();
}

async function findPaintingImage(artist) {
  const target = lastName(artist);
  // isHighlight=true first (the Met's own "notable work" flag, for the most
  // recognizable pieces); if nothing verifiably matches, widen the net.
  for (const isHighlight of [true, false]) {
    const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(artist)}&hasImages=true${isHighlight ? '&isHighlight=true' : ''}`;
    const searchRes = await fetch(searchUrl);
    const searchJson = await searchRes.json();
    const ids = searchJson.objectIDs || [];
    for (const id of ids.slice(0, 15)) {
      const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
      const obj = await objRes.json();
      await sleep(150);
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
  if (!imgRes.ok) return false;
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
  const startDay = parseInt(process.argv[2], 10);
  if (!startDay) {
    console.error('Usage: node fetch-paintings-batch.js <startDay>');
    process.exit(1);
  }
  const artists = JSON.parse(fs.readFileSync(path.join(__dirname, 'paintings-artists.json'), 'utf8'));

  const failures = [];
  for (let i = 0; i < artists.length; i++) {
    const day = startDay + i;
    const artist = artists[i];
    try {
      const found = await findPaintingImage(artist);
      if (!found) { failures.push({ day, artist, reason: 'no verified Met result' }); console.log(`day ${day} (${artist}): FAILED - no verified result`); continue; }
      const ok = await saveCropped(found.imageUrl, day);
      console.log(`day ${day} (searched "${artist}", got "${found.title}" by ${found.artistDisplayName}): ${ok ? 'ok' : 'FAILED - download error'}`);
      if (!ok) failures.push({ day, artist, reason: 'download failed' });
    } catch (err) {
      failures.push({ day, artist, reason: err.message });
      console.log(`day ${day} (${artist}): FAILED - ${err.message}`);
    }
    await sleep(300);
  }

  console.log(`\nDone. ${artists.length - failures.length}/${artists.length} succeeded.`);
  if (failures.length) fs.writeFileSync(path.join(__dirname, `painting-failures-${Date.now()}.json`), JSON.stringify(failures, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
