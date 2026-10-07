// Draws the app icons, favicon and link-preview image from simple original SVG shapes and
// renders them to PNG with the headless browser. Run with: npm run build:assets
// No network, no posters, nothing taken from anyone else's artwork.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src');
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const VIOLET = '#7c3aed';
const VIOLET_LIGHT = '#b79cff';
const DARK = '#0b0a12';

// A film frame with a play triangle. `content` scales the drawing inside the square so the
// maskable version keeps everything inside the safe zone.
function iconSvg({ rounded, content = 1 }) {
  const shift = (1 - content) * 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${VIOLET_LIGHT}"/><stop offset="1" stop-color="${VIOLET}"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#g)"/>
  <g transform="translate(${shift} ${shift}) scale(${content})">
    <rect x="118" y="146" width="276" height="220" rx="30" fill="none" stroke="#fff" stroke-width="22"/>
    <polygon points="226,204 226,308 316,256" fill="#fff"/>
    <g fill="#fff" opacity="0.9">
      <rect x="150" y="118" width="26" height="14" rx="4"/><rect x="243" y="118" width="26" height="14" rx="4"/><rect x="336" y="118" width="26" height="14" rx="4"/>
      <rect x="150" y="380" width="26" height="14" rx="4"/><rect x="243" y="380" width="26" height="14" rx="4"/><rect x="336" y="380" width="26" height="14" rx="4"/>
    </g>
  </g>
</svg>`;
}

function ogHtml(iconDataUri) {
  return `<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;
    background:radial-gradient(900px 500px at 78% 20%, rgba(124,92,255,0.45), transparent 70%), ${DARK};
    font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;color:#ececf3;position:relative">
  <div style="position:absolute;left:84px;top:96px">
    <img src="${iconDataUri}" width="120" height="120" style="display:block">
    <div style="margin-top:36px;font-size:112px;font-weight:800;letter-spacing:-4px;line-height:1;
      background:linear-gradient(135deg,#fff 30%,${VIOLET_LIGHT});-webkit-background-clip:text;color:transparent">CoCinema</div>
    <div style="margin-top:28px;font-size:40px;font-weight:600;line-height:1.3;max-width:640px">Rate a few movies.<br>Get picks that match your taste.</div>
    <div style="margin-top:28px;font-size:28px;color:#8b8ba0">Runs in your browser. No account.</div>
  </div>
  <svg style="position:absolute;right:60px;top:70px" width="440" height="500" viewBox="0 0 440 500">
    <g transform="rotate(-8 220 250)">
      <rect x="40" y="70" width="230" height="340" rx="22" fill="#16161f" stroke="#2a2a38" stroke-width="3"/>
      <rect x="62" y="92" width="186" height="190" rx="12" fill="#2a2a38"/>
      <rect x="62" y="304" width="120" height="14" rx="7" fill="#3a3a4c"/><rect x="62" y="332" width="80" height="12" rx="6" fill="#2a2a38"/>
    </g>
    <g transform="rotate(7 300 260)">
      <rect x="170" y="40" width="230" height="340" rx="22" fill="${VIOLET}"/>
      <rect x="192" y="62" width="186" height="190" rx="12" fill="rgba(255,255,255,0.18)"/>
      <polygon points="260,120 260,196 322,158" fill="#fff"/>
      <rect x="192" y="274" width="120" height="14" rx="7" fill="rgba(255,255,255,0.7)"/><rect x="192" y="302" width="80" height="12" rx="6" fill="rgba(255,255,255,0.4)"/>
    </g>
  </svg>
</body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });

async function render(html, width, height, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`wrote ${path.relative(root, file)} (${width}x${height})`);
}

const pageFor = (svg, size) => `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;

const rounded = iconSvg({ rounded: true });
const square = iconSvg({ rounded: false });
const maskable = iconSvg({ rounded: false, content: 0.78 });

fs.writeFileSync(path.join(out, 'favicon.svg'), rounded + '\n');
await render(pageFor(rounded, 192), 192, 192, path.join(out, 'icons', 'icon-192.png'), true);
await render(pageFor(rounded, 512), 512, 512, path.join(out, 'icons', 'icon-512.png'), true);
await render(pageFor(maskable, 512), 512, 512, path.join(out, 'icons', 'icon-maskable-512.png'));
await render(pageFor(square, 180), 180, 180, path.join(out, 'icons', 'apple-touch-icon.png'));
await render(pageFor(rounded, 32), 32, 32, path.join(out, 'icons', 'favicon-32.png'), true);

const iconUri = `data:image/svg+xml;base64,${Buffer.from(rounded).toString('base64')}`;
await render(ogHtml(iconUri), 1200, 630, path.join(out, 'og-image.png'));

await browser.close();
