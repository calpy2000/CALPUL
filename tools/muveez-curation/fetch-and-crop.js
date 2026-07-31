// Test/utility script: given a Wikipedia article title, fetches that page's
// main image (piprop=original — usually the poster for film articles) at
// full resolution, then produces THREE square crops (top-weighted, center,
// bottom-weighted) so we can compare which framing works best for movie
// posters before committing to one approach for all 366.
//
// Usage: node fetch-and-crop.js "Jaws (film)" jaws

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'test-crops');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const wikiTitle = process.argv[2];
  const slug = process.argv[3];
  if (!wikiTitle || !slug) {
    console.error('Usage: node fetch-and-crop.js "<Wikipedia Title>" <slug>');
    process.exit(1);
  }

  const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(wikiTitle)}&format=json&redirects=1`;
  const apiRes = await fetch(apiUrl);
  const apiJson = await apiRes.json();
  const pages = apiJson.query && apiJson.query.pages;
  const page = pages && Object.values(pages)[0];
  const original = page && page.original;

  if (!original) {
    console.error('No image found for', wikiTitle, JSON.stringify(apiJson));
    return;
  }
  console.log('Source image:', original.source, `${original.width}x${original.height}`);

  const imgRes = await fetch(original.source);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const rawPath = path.join(OUT_DIR, `${slug}-raw${path.extname(original.source) || '.jpg'}`);
  fs.writeFileSync(rawPath, buffer);

  const meta = await sharp(buffer).metadata();
  const side = Math.min(meta.width, meta.height);

  const crops = {
    top: { left: Math.max(0, Math.round((meta.width - side) / 2)), top: 0 },
    center: { left: Math.max(0, Math.round((meta.width - side) / 2)), top: Math.max(0, Math.round((meta.height - side) / 2)) },
    bottom: { left: Math.max(0, Math.round((meta.width - side) / 2)), top: Math.max(0, meta.height - side) },
  };

  for (const [name, offset] of Object.entries(crops)) {
    const outPath = path.join(OUT_DIR, `${slug}-${name}.jpg`);
    await sharp(buffer)
      .extract({ left: offset.left, top: offset.top, width: side, height: side })
      .resize(500, 500)
      .jpeg({ quality: 88 })
      .toFile(outPath);
    console.log('Wrote', outPath);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
