/**
 * Rasterises the Smart Warning mark into every icon the product needs:
 * PWA icons, an Apple touch icon, Android launcher mipmaps (legacy, round and
 * adaptive foreground) and the Capacitor splash screens.
 *
 * Every output is derived from the same vector source, so the mark can be
 * replaced in one place and regenerated.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const CLIENT = path.resolve(process.argv[2] || '../client');
const PUBLIC = path.join(CLIENT, 'public');
const RES = path.join(CLIENT, 'android/app/src/main/res');

const BG = '#080808';
const RED = '#e51c24';

// The mark, in its own 683x1245 space.
const MARK = `
    <path d="M8 495 L180 369.4 L180 651.4 L8 544.6 Z"/>
    <path d="M8 582.6 L180 689.4 L180 1119.4 L8 1245 Z"/>
    <path d="M245 142.4 L440 0 L440 812.8 L245 691.8 Z"/>
    <path d="M255 736 L430 844.6 L405 1050 L280 1050 Z"/>
    <path d="M275 1115 L410 1115 L410 1245 L275 1245 Z"/>
    <path d="M505 335 L675 210.9 L675 958.8 L505 853.2 Z"/>
    <path d="M505 891.2 L675 996.8 L675 1120.9 L505 1245 Z"/>`;

const MARK_W = 683;
const MARK_H = 1245;

/**
 * Compose the mark, scaled to `markHeight`, centred on a canvas.
 * `bg` may be null for a transparent foreground layer.
 */
function canvas(w, h, markHeight, bg, { round = false, rx = 0 } = {}) {
  const s = markHeight / MARK_H;
  const x = (w - MARK_W * s) / 2;
  const y = (h - markHeight) / 2;
  let backdrop = '';
  if (bg && round) backdrop = `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="${bg}"/>`;
  else if (bg) backdrop = `<rect width="${w}" height="${h}" rx="${rx}" fill="${bg}"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + backdrop
    + `<g transform="translate(${x} ${y}) scale(${s})" fill="${RED}">${MARK}</g></svg>`,
  );
}

/**
 * Every asset here is two flat colours plus antialiased edges. Written as
 * 24-bit RGB the splash screens alone came to 6.5 MB and added 5 MB to the APK;
 * as palette PNGs they are a rounding error. 64 colours is far more than the
 * artwork needs and leaves the diagonal edges clean.
 */
const write = async (svg, out, w, h) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Each SVG declares its target size in px, so density is a supersample
  // factor: 72 renders 1:1. Small icons benefit from rendering large and
  // downsampling; the 1920px splashes must not, or the intermediate raster
  // blows past sharp's pixel limit. Scale the factor to the target.
  const factor = Math.max(1, Math.min(4, Math.floor(2048 / Math.max(w, h))));
  await sharp(svg, { density: 72 * factor })
    .resize(w, h)
    .png({ palette: true, colours: 64, compressionLevel: 9, effort: 10 })
    .toFile(out);
};

(async () => {
  const made = [];

  // --- PWA / web ---------------------------------------------------------
  // Mark occupies ~64% of the icon height: enough presence to read at 48px in a
  // task switcher, enough margin that a rounded mask never touches it.
  for (const size of [192, 512]) {
    const out = path.join(PUBLIC, `icon-${size}.png`);
    await write(canvas(size, size, size * 0.645, BG, { rx: size * 0.1875 }), out, size, size);
    made.push(out);
  }
  // Maskable: full bleed, mark inside the guaranteed centre 80%.
  await write(canvas(512, 512, 512 * 0.52, BG), path.join(PUBLIC, 'icon-maskable-512.png'), 512, 512);
  made.push('icon-maskable-512.png');

  // iOS applies its own rounding and does not support transparency well.
  await write(canvas(180, 180, 180 * 0.645, BG), path.join(PUBLIC, 'apple-touch-icon.png'), 180, 180);
  made.push('apple-touch-icon.png');

  // --- Android launcher --------------------------------------------------
  const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [density, factor] of Object.entries(DENSITIES)) {
    const legacy = Math.round(48 * factor);
    // Adaptive foreground is a 108dp canvas whose outer 18dp on each side is
    // reserved for masking and parallax — only the inner 72dp is guaranteed.
    const fg = Math.round(108 * factor);

    await write(canvas(legacy, legacy, legacy * 0.645, BG, { rx: legacy * 0.1875 }),
      path.join(RES, `mipmap-${density}/ic_launcher.png`), legacy, legacy);
    await write(canvas(legacy, legacy, legacy * 0.58, BG, { round: true }),
      path.join(RES, `mipmap-${density}/ic_launcher_round.png`), legacy, legacy);
    // 0.58 of the full canvas keeps the mark inside the 72dp safe zone.
    await write(canvas(fg, fg, fg * 0.58, null),
      path.join(RES, `mipmap-${density}/ic_launcher_foreground.png`), fg, fg);
    made.push(`mipmap-${density} (${legacy}px legacy, ${fg}px foreground)`);
  }

  // --- Capacitor splash screens -----------------------------------------
  // Regenerated at whatever size each one already is, so no density is missed
  // and none is silently resized.
  const splashDirs = fs.readdirSync(RES).filter((d) => fs.existsSync(path.join(RES, d, 'splash.png')));
  for (const dir of splashDirs) {
    const file = path.join(RES, dir, 'splash.png');
    const { width, height } = await sharp(file).metadata();
    // Sized off the SHORT edge so the mark is identical in portrait and
    // landscape rather than stretching with the canvas.
    await write(canvas(width, height, Math.min(width, height) * 0.34, BG), file, width, height);
    made.push(`${dir}/splash.png (${width}x${height})`);
  }

  console.log(made.join('\n'));
  console.log(`\n${made.length} asset groups generated`);
})();
