// Draws every icon and the link-preview image from one source mark, src/logo.svg, and renders
// them with the headless browser. Run with: npm run build:assets
// Everything is original artwork. No network, no posters, nothing taken from anyone else's work.
//
// Reads:  src/logo.svg (rounded app mark), src/logo-maskable.svg (padded for circular cropping)
// Writes: src/favicon.svg, src/favicon.ico (16, 32, 48), src/icons/icon-192.png, icon-512.png,
//         icon-maskable-512.png, apple-touch-icon.png (180), src/og-image.png (1200x630)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildIco } from './ico.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src');
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const VIOLET = '#7C3AED';
const LIGHT_ACCENT = '#B79CFF';
const TEXT = '#F2EFFA';
const DARK = '#0B0A12';

const logo = fs.readFileSync(path.join(out, 'logo.svg'), 'utf8');
const maskable = fs.readFileSync(path.join(out, 'logo-maskable.svg'), 'utf8');
// The Apple touch icon is square with no transparent corners; the phone rounds it itself.
const square = logo.replace('rx="16"', 'rx="0"');

const browser = await chromium.launch({ channel: 'chrome' });

async function renderPng(html, width, height, transparent = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  await page.close();
  return png;
}

const pageFor = (svg, size) => `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;

async function writeIcon(svg, size, file, transparent) {
  const png = await renderPng(pageFor(svg, size), size, size, transparent);
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(root, file)} (${size}x${size})`);
  return png;
}

// Favicons
fs.writeFileSync(path.join(out, 'favicon.svg'), logo);
console.log('wrote src/favicon.svg');
const icoEntries = [];
for (const size of [16, 32, 48]) {
  icoEntries.push({ size, png: await renderPng(pageFor(logo, size), size, size, true) });
}
fs.writeFileSync(path.join(out, 'favicon.ico'), buildIco(icoEntries));
console.log('wrote src/favicon.ico (16, 32, 48)');

// App icons
await writeIcon(logo, 192, path.join(out, 'icons', 'icon-192.png'), true);
await writeIcon(logo, 512, path.join(out, 'icons', 'icon-512.png'), true);
await writeIcon(maskable, 512, path.join(out, 'icons', 'icon-maskable-512.png'), false);
await writeIcon(square, 180, path.join(out, 'icons', 'apple-touch-icon.png'), false);

// Link-preview image: the mark and the wordmark side by side, then the tagline and an abstract graphic
const manropeUri = `data:font/woff2;base64,${fs.readFileSync(path.join(out, 'fonts', 'manrope-variable-latin.woff2')).toString('base64')}`;
const markUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;

const ogHtml = `<!doctype html><html><head><style>
@font-face { font-family: 'Manrope'; font-weight: 200 800; src: url(${manropeUri}) format('woff2'); }
</style></head><body style="margin:0;width:1200px;height:630px;overflow:hidden;
    background:radial-gradient(900px 500px at 78% 20%, rgba(124,58,237,0.45), transparent 70%), ${DARK};
    font-family:'Manrope',system-ui,sans-serif;color:${TEXT};position:relative">
  <div style="position:absolute;left:84px;top:140px">
    <div style="display:flex;align-items:center;gap:24px">
      <img src="${markUri}" width="104" height="104" style="display:block">
      <div style="font-size:88px;font-weight:800;letter-spacing:-3px;line-height:1"><span style="color:${LIGHT_ACCENT}">Co</span><span style="color:${TEXT}">Cinema</span></div>
    </div>
    <div style="margin-top:48px;font-size:40px;font-weight:700;line-height:1.3;max-width:620px">Rate a few movies.<br>Get picks that match your taste.</div>
    <div style="margin-top:28px;font-size:28px;font-weight:500;color:#A9A4C0">Runs in your browser. No account.</div>
  </div>
  <svg style="position:absolute;right:60px;top:70px" width="440" height="500" viewBox="0 0 440 500">
    <g transform="rotate(-8 220 250)">
      <rect x="40" y="70" width="230" height="340" rx="22" fill="#15131F" stroke="#2B2740" stroke-width="3"/>
      <rect x="62" y="92" width="186" height="190" rx="12" fill="#2B2740"/>
      <rect x="62" y="304" width="120" height="14" rx="7" fill="#3a3555"/><rect x="62" y="332" width="80" height="12" rx="6" fill="#2B2740"/>
    </g>
    <g transform="rotate(7 300 260)">
      <rect x="170" y="40" width="230" height="340" rx="22" fill="${VIOLET}"/>
      <rect x="192" y="62" width="186" height="190" rx="12" fill="rgba(255,255,255,0.18)"/>
      <polygon points="260,120 260,196 322,158" fill="#fff"/>
      <rect x="192" y="274" width="120" height="14" rx="7" fill="rgba(255,255,255,0.7)"/><rect x="192" y="302" width="80" height="12" rx="6" fill="rgba(255,255,255,0.4)"/>
    </g>
  </svg>
</body></html>`;

const og = await renderPng(ogHtml, 1200, 630);
fs.writeFileSync(path.join(out, 'og-image.png'), og);
console.log('wrote src/og-image.png (1200x630)');

await browser.close();
