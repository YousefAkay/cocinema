// Every icon the page and the manifest point to resolves with the right content type, the root
// favicon.ico is served, and the logo shows in the top bar.
import { chromium } from 'playwright';
import { startServer, createRecorder } from './helpers.mjs';
import { readIco } from '../scripts/ico.js';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

const TYPES = { svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png' };
const extension = url => new URL(url).pathname.split('.').pop();

try {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(server.base);
  await page.waitForSelector('.brand img');

  // Icon links in the page
  const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
    .map(link => ({ rel: link.rel, href: link.href, type: link.getAttribute('type'), sizes: link.getAttribute('sizes') })));
  check('the page declares an SVG icon, an ICO icon, a root /favicon.ico and an Apple touch icon',
    links.some(link => link.type === 'image/svg+xml')
      && links.some(link => link.type === 'image/x-icon' && link.sizes === '16x16 32x32 48x48')
      && links.some(link => link.href === `${server.origin}/favicon.ico`)
      && links.some(link => link.rel === 'apple-touch-icon' && link.sizes === '180x180'), links.map(link => `${link.rel} ${link.href.replace(server.origin, '')}`).join(' | '));

  for (const link of links) {
    const response = await page.request.get(link.href);
    const contentType = response.headers()['content-type'] || '';
    const expected = link.type || TYPES[extension(link.href)];
    check(`icon link ${link.href.replace(server.origin, '')} returns 200 as ${expected}`, response.status() === 200 && contentType.startsWith(expected), `${response.status()} ${contentType}`);
  }

  // The root favicon.ico
  const root = await page.request.get(`${server.origin}/favicon.ico`);
  const rootBytes = await root.body();
  const ico = readIco(rootBytes);
  check('/favicon.ico at the site root is served, as a 16, 32 and 48 pixel icon',
    root.status() === 200 && root.headers()['content-type'].startsWith('image/x-icon') && ico.map(entry => entry.width).join() === '16,32,48', `${root.status()} ${root.headers()['content-type']}`);
  const redirect = await page.request.get(`${server.origin}/`, { maxRedirects: 0 });
  check('the / to /src/ redirect still works', redirect.status() === 308 && redirect.headers().location === '/src/');
  const worker = await page.request.get(`${server.base}sw.js`);
  check('sw.js is still served uncached and allowed to control the whole site',
    worker.headers()['service-worker-allowed'] === '/' && /max-age=0/.test(worker.headers()['cache-control']));

  // Manifest icons
  const manifestHref = await page.evaluate(() => document.querySelector('link[rel="manifest"]').href);
  const manifestResponse = await page.request.get(manifestHref);
  const manifest = await manifestResponse.json();
  check('the manifest loads as a web manifest', manifestResponse.status() === 200 && /manifest\+json/.test(manifestResponse.headers()['content-type']));
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestHref).href;
    const response = await page.request.get(url);
    const bytes = await response.body();
    const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    check(`manifest icon ${icon.src} (${icon.purpose}) returns 200 as image/png at ${icon.sizes}`,
      response.status() === 200 && response.headers()['content-type'].startsWith('image/png') && `${width}x${height}` === icon.sizes);
  }
  check('the manifest has 192 and 512 icons for any purpose and a 512 maskable icon',
    manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any')
      && manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any')
      && manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));

  const og = await page.request.get(await page.evaluate(() => document.querySelector('meta[property="og:image"]').content.replace('https://cocinema-pi.vercel.app', location.origin)));
  check('og-image.png returns 200 as image/png', og.status() === 200 && og.headers()['content-type'].startsWith('image/png'));

  // The logo in the page
  const logo = await page.evaluate(() => {
    const image = document.querySelector('.brand img');
    const box = image.getBoundingClientRect();
    return { loaded: image.complete && image.naturalWidth > 0, alt: image.getAttribute('alt'), width: Math.round(box.width), height: Math.round(box.height), src: new URL(image.src).pathname };
  });
  check('the top-bar logo renders at about 28px with an empty alt', logo.loaded && logo.alt === '' && logo.width === 28 && logo.height === 28 && logo.src === '/src/logo.svg', JSON.stringify(logo));
  await page.locator('.topbar').screenshot({ path: `${(await import('./helpers.mjs')).shots}/14-topbar-logo.png` });
  check('no horizontal scroll at 375px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('no uncaught errors', problems.length === 0, problems.join(' | '));
  await context.close();
} catch (error) {
  check('icon run finished without an exception', false, error.message);
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
