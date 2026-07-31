// Two static icons for MUVEEZ — a clapperboard and a movie projector,
// picked by the user out of a gallery of six Canvas-drawn concepts (a film
// reel, camera, and film strip were also explored). Same gradient + bevel
// + glow language used everywhere else in the hub (see games/jewelz's
// jewel/player/bar icons, games/slydz's/games/quadz's tile icons).
//
// Both are drawn generically at (cx, cy) with an overall `size` budget, so
// the same drawing code works whether it's rendered as a small header/hub
// icon or (in principle) larger — `R` below is just an internal working
// unit derived from `size`, matching the pattern of the gallery previews
// these were designed in.

function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

// Draws a striped bar of width w, height h, with its LEFT edge at the
// origin and extending right/up — used for both the board's top edge and
// the hinged arm, so both share identical stripe rendering.
function stripedBar(context, w, h) {
  roundRect(context, 0, -h, w, h, 5);
  const barGrad = context.createLinearGradient(0, -h, 0, 0);
  barGrad.addColorStop(0, '#3a4152');
  barGrad.addColorStop(1, '#20242e');
  context.fillStyle = barGrad;
  context.fill();
  context.save();
  roundRect(context, 0, -h, w, h, 5);
  context.clip();
  context.fillStyle = '#f6ad37';
  const stripeW = h * 0.55;
  for (let x = -h * 1.5; x < w + h; x += stripeW * 2) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + stripeW, 0);
    context.lineTo(x + stripeW + h, -h);
    context.lineTo(x + h, -h);
    context.closePath();
    context.fill();
  }
  context.restore();
}

// Taller than the first pass — closer to Phosphor's own "film-slate" icon's
// proportions (board + open arm reads as roughly as tall as it is wide,
// rather than noticeably wider than tall).
export function drawClapperboard(context, cx, cy, size) {
  const R = size * 0.25;
  context.save();
  context.translate(cx - R * 0.85, cy + R * 0.6);
  const boardW = R * 1.7, boardH = R * 1.05;

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = size * 0.06;
  context.shadowOffsetY = size * 0.02;
  roundRect(context, 0, 0, boardW, boardH, boardH * 0.09);
  const bodyGrad = context.createLinearGradient(0, 0, 0, boardH);
  bodyGrad.addColorStop(0, '#2b3140');
  bodyGrad.addColorStop(1, '#181c24');
  context.fillStyle = bodyGrad;
  context.fill();
  context.restore();

  context.save();
  context.translate(0, boardH * 0.3);
  stripedBar(context, boardW, boardH * 0.3);
  context.restore();

  context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  context.lineWidth = Math.max(1, size * 0.007);
  context.beginPath();
  context.moveTo(boardW * 0.12, boardH * 0.78);
  context.lineTo(boardW * 0.88, boardH * 0.78);
  context.stroke();

  context.save();
  context.rotate(-0.38); // opens a little wider now that there's more room
  stripedBar(context, boardW, boardH * 0.34);
  context.restore();

  const hingeGrad = context.createRadialGradient(-2, -2, 1, 0, 0, boardH * 0.06);
  hingeGrad.addColorStop(0, '#f3f4f6');
  hingeGrad.addColorStop(1, '#6b7280');
  context.beginPath();
  context.arc(0, 0, boardH * 0.045, 0, Math.PI * 2);
  context.fillStyle = hingeGrad;
  context.fill();

  context.restore();
}

// `skipBeam` exists purely for measurement purposes (see renderIconDataURL
// below) — the beam's long, mostly-faint tail was getting counted as
// "content" when auto-sizing the icon, which shrank the actual solid
// object (body/lens/reels) to make room for a light effect that's mostly
// transparent anyway. The real, visible render always includes it.
export function drawProjector(context, cx, cy, size, { skipBeam = false } = {}) {
  const R = size * 0.25;
  context.save();
  context.translate(cx - R * 0.15, cy + R * 0.1);

  // Light beam first, so the body/lens sit on top of it.
  if (!skipBeam) {
  context.beginPath();
  context.moveTo(R * 0.55, -R * 0.12);
  context.lineTo(R * 2.0, -R * 0.75);
  context.lineTo(R * 2.0, R * 0.55);
  context.lineTo(R * 0.55, R * 0.05);
  context.closePath();
  const beamGrad = context.createLinearGradient(R * 0.55, 0, R * 2.0, 0);
  beamGrad.addColorStop(0, 'rgba(255, 196, 90, 0.85)');
  beamGrad.addColorStop(0.7, 'rgba(255, 196, 90, 0.28)');
  beamGrad.addColorStop(1, 'rgba(255, 196, 90, 0.05)');
  context.fillStyle = beamGrad;
  context.fill();
  }

  // Body — a little wider than the first pass, to comfortably fit the
  // bigger reels above without them overhanging the edges.
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.4)';
  context.shadowBlur = size * 0.05;
  const bodyGrad = context.createLinearGradient(0, -R * 0.5, 0, R * 0.3);
  bodyGrad.addColorStop(0, '#3a4152');
  bodyGrad.addColorStop(1, '#20242e');
  roundRect(context, -R * 1.05, -R * 0.5, R * 1.45, R * 0.8, 8);
  context.fillStyle = bodyGrad;
  context.fill();
  context.restore();

  // Body detail — vent slits and a small control knob, so the housing
  // reads as an actual object instead of a plain grey block.
  context.save();
  context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  context.lineWidth = R * 0.035;
  context.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const vy = -R * 0.08 + i * R * 0.12;
    context.beginPath();
    context.moveTo(-R * 0.75, vy);
    context.lineTo(-R * 0.25, vy);
    context.stroke();
  }
  const knobGrad = context.createRadialGradient(-R * 0.35 - 2, -R * 0.2 - 2, 1, -R * 0.35, -R * 0.2, R * 0.09);
  knobGrad.addColorStop(0, '#ffe1a8');
  knobGrad.addColorStop(1, '#b8720f');
  context.beginPath();
  context.arc(-R * 0.35, -R * 0.2, R * 0.09, 0, Math.PI * 2);
  context.fillStyle = knobGrad;
  context.fill();
  context.restore();

  // Lens barrel + glass.
  context.fillStyle = '#20242e';
  roundRect(context, R * 0.25, -R * 0.22, R * 0.35, R * 0.28, 4);
  context.fill();
  const lensGrad = context.createRadialGradient(R * 0.55, -R * 0.1, R * 0.02, R * 0.55, -R * 0.08, R * 0.2);
  lensGrad.addColorStop(0, '#ffe1a8');
  lensGrad.addColorStop(1, '#b8720f');
  context.beginPath();
  context.arc(R * 0.55, -R * 0.08, R * 0.2, 0, Math.PI * 2);
  context.fillStyle = lensGrad;
  context.fill();
  context.strokeStyle = '#0d0f14';
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.ellipse(R * 0.48, -R * 0.14, R * 0.05, R * 0.03, -0.5, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.6)';
  context.fill();

  // Two film reels on top — bigger than the first pass, and built like the
  // standalone "Film Reel" concept (metallic gradient body, pink sprocket
  // holes, dark center hub) rather than a plain dot.
  const reelR = R * 0.32;
  const reelY = -R * 0.62;
  const reelXs = [-R * 0.68, R * 0.04];
  reelXs.forEach((rx) => {
    const reelGrad = context.createRadialGradient(rx - reelR * 0.3, reelY - reelR * 0.3, reelR * 0.1, rx, reelY, reelR);
    reelGrad.addColorStop(0, '#4b5568');
    reelGrad.addColorStop(1, '#1a1d24');
    context.beginPath();
    context.arc(rx, reelY, reelR, 0, Math.PI * 2);
    context.fillStyle = reelGrad;
    context.fill();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const hx = rx + Math.cos(a) * reelR * 0.55;
      const hy = reelY + Math.sin(a) * reelR * 0.55;
      context.beginPath();
      context.arc(hx, hy, reelR * 0.22, 0, Math.PI * 2);
      context.fillStyle = '#ec4899';
      context.fill();
    }
    context.beginPath();
    context.arc(rx, reelY, reelR * 0.16, 0, Math.PI * 2);
    context.fillStyle = '#0d0f14';
    context.fill();
  });
  context.strokeStyle = '#1a1d24';
  context.lineWidth = R * 0.05;
  context.beginPath();
  context.moveTo(reelXs[0] + reelR, reelY);
  context.lineTo(reelXs[1] - reelR, reelY);
  context.stroke();

  context.restore();
}

const ICON_RENDER_SIZE = 128;

// Measures the actual drawn (non-transparent) pixel bounding box of
// whatever is on `context` — used below to auto-center and auto-scale each
// icon, since the clapperboard and projector were each hand-tuned to look
// right within their OWN gallery card and don't share a common visual
// center or size by construction.
function measureInkBBox(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// Renders `drawFn` once at a generous scratch size to measure where its
// ink actually lands, then redraws it scaled up to fill most of the real
// icon canvas and centered on it — so every icon this produces lines up
// the same way regardless of the hand-tuned offsets inside each drawFn
// (the clapperboard and projector were never designed to share a common
// center/size, only to look good in their own gallery card).
//
// `measureFn` (defaults to `drawFn` itself) is what gets used for the
// SIZING/centering pass only — the projector passes a beam-free variant
// here (see getProjectorIconDataURL below) so its long, faint light beam
// doesn't count toward "how big the object is."
function renderIconDataURL(drawFn, measureFn = drawFn) {
  const scratchSize = ICON_RENDER_SIZE * 2;
  const scratch = document.createElement('canvas');
  scratch.width = scratchSize;
  scratch.height = scratchSize;
  const scratchCtx = scratch.getContext('2d');
  measureFn(scratchCtx, scratchSize / 2, scratchSize / 2, ICON_RENDER_SIZE);

  const bbox = measureInkBBox(scratchCtx, scratchSize, scratchSize);
  const contentW = bbox.maxX - bbox.minX;
  const contentH = bbox.maxY - bbox.minY;
  const contentCx = (bbox.minX + bbox.maxX) / 2;
  const contentCy = (bbox.minY + bbox.maxY) / 2;

  const TARGET_FRACTION = 0.86; // how much of the icon canvas the content's longest side should fill
  const scale = (ICON_RENDER_SIZE * TARGET_FRACTION) / Math.max(contentW, contentH);

  const canvas = document.createElement('canvas');
  canvas.width = ICON_RENDER_SIZE;
  canvas.height = ICON_RENDER_SIZE;
  const context = canvas.getContext('2d');
  context.translate(ICON_RENDER_SIZE / 2, ICON_RENDER_SIZE / 2);
  context.scale(scale, scale);
  context.translate(-contentCx, -contentCy);
  // Same (cx, cy, size) as the scratch draw above — the transform just
  // applied is what repositions/rescales the result, not different inputs.
  drawFn(context, scratchSize / 2, scratchSize / 2, ICON_RENDER_SIZE);
  return canvas.toDataURL('image/png');
}

let cachedClapperboardDataURL = null;
export function getClapperboardIconDataURL() {
  if (!cachedClapperboardDataURL) cachedClapperboardDataURL = renderIconDataURL(drawClapperboard);
  return cachedClapperboardDataURL;
}

// The projector's own body/lens/reels are noticeably WIDER than tall (see
// drawProjector above), so scaling it up to the same visual size as the
// clapperboard inside an equally-SQUARE canvas meant its left/right edges
// had to be cropped to fit. Rather than crop, this renders the projector
// onto its own WIDER canvas — same height as the clapperboard's icon (so
// they still line up when placed side by side at a shared CSS height, via
// the `width: auto` override on this specific image — see style.css and
// games/muveez/style.css), sized to exactly fit the object at the chosen
// scale with nothing cut off. The beam still extends past the object's own
// bounding box and fades out, so a little extra right-hand margin gives it
// room without needing to contain its full theoretical length.
let cachedProjectorDataURL = null;
export function getProjectorIconDataURL() {
  if (cachedProjectorDataURL) return cachedProjectorDataURL;

  const TARGET_FRACTION = 0.86; // same height-fill ratio the clapperboard itself uses
  const scratchSize = ICON_RENDER_SIZE * 2;
  const scratch = document.createElement('canvas');
  scratch.width = scratchSize;
  scratch.height = scratchSize;
  const scratchCtx = scratch.getContext('2d');
  drawProjector(scratchCtx, scratchSize / 2, scratchSize / 2, ICON_RENDER_SIZE, { skipBeam: true });

  const bbox = measureInkBBox(scratchCtx, scratchSize, scratchSize);
  const contentW = bbox.maxX - bbox.minX;
  const contentH = bbox.maxY - bbox.minY;
  const contentCx = (bbox.minX + bbox.maxX) / 2;
  const contentCy = (bbox.minY + bbox.maxY) / 2;
  const scale = (ICON_RENDER_SIZE * TARGET_FRACTION) / contentH; // fit by HEIGHT (matches the clapperboard's height), width is free to grow

  const leftMargin = contentW * scale * 0.08;
  const rightMargin = contentW * scale * 0.55; // extra room for the beam to extend and fade into
  const topBottomMargin = contentH * scale * 0.12; // room so the scaled object's own top/bottom are never clipped — this is what the earlier version got wrong
  const canvasHeight = Math.ceil(contentH * scale + topBottomMargin * 2);
  const canvasWidth = Math.ceil(contentW * scale + leftMargin + rightMargin);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  context.translate(leftMargin + (contentW * scale) / 2, canvasHeight / 2);
  context.scale(scale, scale);
  context.translate(-contentCx, -contentCy);
  drawProjector(context, scratchSize / 2, scratchSize / 2, ICON_RENDER_SIZE);
  cachedProjectorDataURL = canvas.toDataURL('image/png');
  return cachedProjectorDataURL;
}
