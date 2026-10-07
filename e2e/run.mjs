// Headless browser check at phone size. Serves the repo on 127.0.0.1 only and drives the real page.
// Uses the Chrome that is already installed (no browser download).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/src/`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
}

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const problems = [];
page.on('pageerror', error => problems.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
});

const ratedTitles = new Set();
const scoreCycle = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];

async function rateCurrent(score) {
  const title = await page.locator('#rating-screen .movie-card p').innerText();
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  ratedTitles.add(title);
}

async function topTitles() {
  return page.locator('.top-pick h3, .more-picks .movie-card p').allInnerTexts();
}

const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

try {
  await page.goto(base);
  await page.waitForSelector('#start-button:not([disabled])');
  await page.screenshot({ path: path.join(shots, '1-landing.png') });

  // Onboarding
  await page.click('#start-button');
  let step = 0;
  while (await page.locator('#rating-screen').isVisible()) {
    await rateCurrent(scoreCycle[step % scoreCycle.length]);
    step++;
    if (step > 60) break;
  }
  await page.waitForSelector('.top-pick');
  check('onboarding completes and shows results', await page.locator('#results-screen').isVisible(), `${step} ratings`);

  // Results
  const topCount = await page.locator('.top-pick').count();
  check('exactly 5 top cards', topCount === 5, `found ${topCount}`);

  const whys = await page.locator('.top-pick-why').allInnerTexts();
  const named = whys.every(text => {
    const titles = [...text.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    return text.trim().length > 0 && titles.length > 0 && titles.every(title => ratedTitles.has(title));
  });
  check('every why line is non-empty and names only movies the user rated', named, whys[0]);

  const matches = await page.locator('.top-pick-match').allInnerTexts();
  check('scores read as whole-number "N% match"', matches.length === 5 && matches.every(text => /^\d+% match$/.test(text)), matches.join(', '));

  const restCount = await page.locator('.more-picks .movie-card').count();
  check('the rest of the list renders', restCount >= 10, `${restCount} cards`);
  check('no horizontal scroll on results at 375px', await noSideScroll());

  const small = await page.$$eval('#results-screen button', buttons => buttons.filter(b => b.getBoundingClientRect().height < 44).length);
  check('results buttons are at least 44px tall', small === 0);

  await page.screenshot({ path: path.join(shots, '2-results-top.png') });
  await page.screenshot({ path: path.join(shots, '3-results-full.png'), fullPage: true });

  // Rate 5 more, with a refresh in the middle and one skip
  const before = await topTitles();
  await page.getByRole('button', { name: 'Rate 5 more' }).click();
  await page.waitForSelector('#rating-screen .rating-widget');
  const firstLabel = await page.locator('#rating-screen > p:first-child').innerText();
  check('extra flow starts at "1 of 5"', /1 of 5/i.test(firstLabel), firstLabel);
  check('the rating step is scrolled to the top', await page.evaluate(() => window.scrollY === 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, '4-rate-more.png') });

  await rateCurrent(9);
  await page.getByRole('button', { name: "Haven't seen it" }).click();
  await page.waitForSelector('#rating-screen .rating-widget');
  await rateCurrent(2);

  const midTitle = await page.locator('#rating-screen .movie-card p').innerText();
  const midLabel = await page.locator('#rating-screen > p:first-child').innerText();
  await page.reload();
  await page.waitForSelector('#rating-screen .rating-widget');
  const afterTitle = await page.locator('#rating-screen .movie-card p').innerText();
  const afterLabel = await page.locator('#rating-screen > p:first-child').innerText();
  check('refresh mid-flow resumes on the same film and step', afterTitle === midTitle && afterLabel === midLabel && /3 of 5/i.test(afterLabel), `${afterLabel}: ${afterTitle}`);

  for (const score of [8, 3, 10]) {
    await rateCurrent(score);
  }
  await page.waitForSelector('.top-pick');
  const after = await topTitles();
  check('extra flow (5 ratings, 1 skip) returns to results', (await page.locator('.top-pick').count()) === 5);
  check('the recomputed list differs from before', JSON.stringify(before) !== JSON.stringify(after));
  const overlap = after.filter(title => ratedTitles.has(title)).length;
  check('newly rated films are not recommended again', overlap === 0, `${overlap} rated films shown`);
  check('no horizontal scroll after the extra flow', await noSideScroll());

  // Refresh on results
  await page.reload();
  await page.waitForSelector('.top-pick');
  const reloaded = await topTitles();
  check('refresh on results shows the same updated results', JSON.stringify(reloaded) === JSON.stringify(after));

  // Start over
  await page.getByRole('button', { name: 'Start over' }).click();
  check('Start over returns to the landing screen', await page.locator('#landing-screen').isVisible());
  await page.reload();
  await page.waitForSelector('#start-button:not([disabled])');
  const saved = await page.evaluate(() => localStorage.getItem('cocinema:v2'));
  check('after Start over and a refresh, nothing is resumed', (await page.locator('#landing-screen').isVisible()) && saved === null);
  await page.screenshot({ path: path.join(shots, '5-after-start-over.png') });

  check('no console errors or page errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('run finished without an exception', false, error.message);
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${shots}`);
process.exit(failed === 0 ? 0 : 1);
