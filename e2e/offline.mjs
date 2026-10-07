// Offline checks: load once online, go offline, and use the whole app; then simulate a new deploy.
import { chromium } from 'playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

function watch(page) {
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
}

const scoreCycle = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];
const cacheNames = page => page.evaluate(() => caches.keys());

try {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  watch(page);

  // First visit, online
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  check('the service worker registers and activates, controlling the whole site', scope === `${server.origin}/`, scope);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  check('the cache is created under one versioned name', (await cacheNames(page)).join() === 'cocinema-v1', (await cacheNames(page)).join());
  const cachedPaths = await page.evaluate(async () => (await (await caches.open('cocinema-v1')).keys()).map(request => new URL(request.url).pathname));
  const needed = ['/src/main.js', '/src/style.css', '/src/detail.js', '/data/catalog.json', '/data/onboarding.json', '/data/availability.json'];
  check('app code and all three data files were saved', needed.every(path => cachedPaths.includes(path)), `${cachedPaths.length} files`);
  check('no poster or font from another origin was cached', cachedPaths.length > 0 && !(await page.evaluate(async () => (await (await caches.open('cocinema-v1')).keys()).some(request => new URL(request.url).origin !== location.origin))));

  // Offline: landing
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.length-card');
  await page.locator('.length-card:has(input[value="15"])').click();
  await page.waitForSelector('#start-button:not([disabled])');
  check('offline: the landing page loads and, after choosing a length, Get started is enabled', await page.locator('#landing-screen').isVisible());
  check('offline: the notice appears', await page.locator('#offline-notice').isVisible() && (await page.locator('#offline-notice').innerText()) === 'Offline - using saved data');

  // Offline: the site root redirects into the app
  await page.goto(`${server.origin}/`);
  await page.waitForSelector('.length-card');
  check('offline: opening the site root still reaches the app', page.url() === server.base && await page.locator('#landing-screen').isVisible(), page.url());

  // Offline: full onboarding, results, film page, refresh
  await chooseAndStart(page);
  let step = 0;
  while (await page.locator('#rating-screen').isVisible() && step < 60) {
    await page.getByRole('button', { name: String(scoreCycle[step % scoreCycle.length]), exact: true }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    step++;
  }
  await page.waitForSelector('.top-pick');
  check('offline: onboarding completes and results show', (await page.locator('.top-pick').count()) === 5 && (await page.locator('.more-picks .movie-card').count()) > 5, `${step} ratings`);

  const imagesLoaded = await page.$$eval('#results-screen img', images => images.filter(image => image.complete && image.naturalWidth > 0).length);
  const placeholders = await page.locator('#results-screen .poster-placeholder').count();
  check('offline: posters fall back to placeholder cards', imagesLoaded === 0 && placeholders >= 5, `${placeholders} placeholders`);

  await page.locator('.top-pick h3 a').first().click();
  await page.waitForSelector('#detail-screen .detail');
  await page.waitForSelector('.country-block');
  check('offline: a film page opens with its plot, breakdown and saved streaming data',
    (await page.locator('.detail-plot').innerText()).length > 50 && (await page.locator('.contrib-row').count()) === 15 && (await page.locator('.country-block').count()) === 3);
  const detailUrl = page.url();
  await page.reload();
  await page.waitForSelector('#detail-screen .detail');
  check('offline: refreshing the film page works', page.url() === detailUrl && (await page.locator('.contrib-row').count()) === 15);
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForSelector('.top-pick');
  await page.reload();
  await page.waitForSelector('.top-pick');
  check('offline: refreshing the results works', (await page.locator('.top-pick').count()) === 5);
  check('offline: no uncaught errors', problems.length === 0, problems.join(' | '));

  // Back online
  await context.setOffline(false);
  await page.waitForFunction(() => document.getElementById('offline-notice').hidden);
  check('back online: the notice goes away', !(await page.locator('#offline-notice').isVisible()));

  // A new deploy: the cache name changes, the old cache goes, files are fetched again
  const before = server.state.counts.get('/src/main.js') || 0;
  server.state.swVersion = 'cocinema-v2-test';
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  for (let attempt = 0; attempt < 60 && (await cacheNames(page)).join() !== 'cocinema-v2-test'; attempt++) {
    await page.waitForTimeout(250);
  }
  check('an update deletes the old cache and keeps only the new one', (await cacheNames(page)).join() === 'cocinema-v2-test', (await cacheNames(page)).join());
  const fetched = (server.state.counts.get('/src/main.js') || 0) - before;
  const newPaths = await page.evaluate(async () => (await (await caches.open('cocinema-v2-test')).keys()).map(request => new URL(request.url).pathname));
  check('an update fetches the files again into the new cache', fetched >= 1 && newPaths.includes('/src/main.js') && newPaths.includes('/data/catalog.json'), `${fetched} new request(s), ${newPaths.length} files`);

  // Network-first for code, so a phone with signal gets the newest file
  const mainBefore = server.state.counts.get('/src/main.js');
  const catalogBefore = server.state.counts.get('/data/catalog.json');
  await page.reload();
  await page.waitForSelector('.top-pick');
  await page.waitForTimeout(500);
  check('online: code is fetched from the network, not just the cache', server.state.counts.get('/src/main.js') > mainBefore);
  check('online: data files are served from the cache and refreshed in the background', server.state.counts.get('/data/catalog.json') > catalogBefore);
  server.state.swVersion = null;
  await context.close();

  // A browser where registration fails behaves exactly like one without a service worker
  const plain = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await plain.addInitScript(() => { navigator.serviceWorker.register = () => Promise.reject(new Error('blocked')); });
  const plainPage = await plain.newPage();
  watch(plainPage);
  await plainPage.goto(server.base);
  await plainPage.waitForSelector('.length-card');
  await chooseAndStart(plainPage);
  await plainPage.waitForSelector('#rating-screen .rating-widget');
  check('the app works when the service worker cannot register', await plainPage.locator('#rating-screen').isVisible());
  await plain.close();
  check('no uncaught errors overall', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('offline run finished without an exception', false, error.message);
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
