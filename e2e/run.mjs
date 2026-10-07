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
  check('catalog-relative figure reads "Top N% for your taste"', matches.length === 5 && matches.every(text => /^Top \d+% for your taste$/.test(text) && !text.startsWith('Top 0%')), matches.join(', '));

  const restCount = await page.locator('.more-picks .movie-card').count();
  check('the rest of the list renders', restCount >= 10, `${restCount} cards`);
  check('no horizontal scroll on results at 375px', await noSideScroll());

  const small = await page.$$eval('#results-screen button', buttons => buttons.filter(b => b.getBoundingClientRect().height < 44).length);
  check('results buttons are at least 44px tall', small === 0);

  await page.screenshot({ path: path.join(shots, '2-results-top.png') });
  await page.screenshot({ path: path.join(shots, '3-results-full.png'), fullPage: true });

  // Detail page
  async function openDetailFromTop(index) {
    await page.locator('.top-pick h3 a').nth(index).click();
    await page.waitForSelector('#detail-screen .detail');
  }
  const detailText = selector => page.locator(selector).first().innerText();

  let opened = -1;
  let scrollBefore = 0;
  for (const index of [4, 3, 2]) {
    await page.locator('.top-pick h3 a').nth(index).scrollIntoViewIfNeeded();
    scrollBefore = await page.evaluate(() => window.scrollY);
    await openDetailFromTop(index);
    if (await page.locator('.detail-rt').count() > 0) { opened = index; break; }
    await page.goBack();
    await page.waitForSelector('.top-pick');
  }
  check('clicking a top card opens #/movie/Q... and shows the page', opened >= 0 && /#\/movie\/Q\d+$/.test(page.url()), page.url());

  const heading = await detailText('#detail-heading');
  check('page title reflects the film and focus is on the heading',
    (await page.title()).startsWith(heading) && await page.evaluate(() => document.activeElement?.id === 'detail-heading'), await page.title());
  check('poster (or placeholder) is shown', (await page.locator('.detail-poster img, .detail-poster .poster-placeholder').count()) === 1);
  check('Rotten Tomatoes line is shown and nothing prints null',
    /^Rotten Tomatoes: \d+%$/.test(await detailText('.detail-rt')) && !(await page.locator('#detail-screen').innerText()).includes('null'));
  check('full plot is shown', (await detailText('.detail-plot')).length > 50);
  check('"Top N% for your taste" is shown', /^Top \d+% for your taste$/.test(await detailText('.detail-match')));

  const values = (await page.locator('.contrib-value').allInnerTexts()).map(text => Number(text.replace('−', '-')));
  const totalText = await detailText('.contrib-total');
  const total = Number(totalText.replace('Total: ', '').replace('−', '-'));
  const sumOfParts = values.reduce((sum, value) => sum + value, 0);
  check('breakdown lists every rated film and the parts add up to the total',
    values.length === 15 && Math.abs(sumOfParts - total) < 0.001, `${values.length} rows, sum ${sumOfParts.toFixed(4)}, ${totalText}`);

  const trailer = page.locator('.trailer-link');
  const trailerHref = await trailer.getAttribute('href');
  check('trailer link is a YouTube search that opens safely in a new tab',
    trailerHref.startsWith('https://www.youtube.com/results?search_query=') && trailerHref.endsWith('trailer')
      && (await trailer.getAttribute('target')) === '_blank' && (await trailer.getAttribute('rel')) === 'noopener%20noreferrer'.replace('%20', ' '), trailerHref);

  const watch = await page.locator('.where-to-watch a').evaluateAll(links => links.map(a => ({ href: a.href, target: a.target, rel: a.rel })));
  check('three where-to-watch links with the right country codes',
    watch.length === 3 && ['/ca/search?q=', '/us/search?q=', '/uk/search?q='].every((part, i) => watch[i].href.includes(`justwatch.com${part}`))
      && watch.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer'), watch.map(link => link.href).join(' '));
  check('streaming-services slot exists for later', (await page.locator('#streaming-services').count()) === 1);

  check('no horizontal scroll on the detail page', await noSideScroll());
  const smallTargets = await page.$$eval('#detail-screen a, #detail-screen button', nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).length);
  check('detail links and buttons are at least 44px tall', smallTargets === 0, `${smallTargets} too small`);
  await page.screenshot({ path: path.join(shots, '6-detail-top.png') });
  await page.screenshot({ path: path.join(shots, '7-detail-full.png'), fullPage: true });

  await page.goBack();
  await page.waitForSelector('.top-pick');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('browser Back returns to results and restores the scroll position',
    (await page.locator('#results-screen').isVisible()) && !page.url().includes('#/movie') && scrollBefore > 100 && Math.abs(scrollAfter - scrollBefore) < 80, `${scrollBefore} -> ${scrollAfter}`);

  await page.locator('.more-picks a').first().click();
  await page.waitForSelector('#detail-screen .detail');
  check('a film from the compact grid opens its page too', /#\/movie\/Q\d+$/.test(page.url()));
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForSelector('.top-pick');
  check('the in-page Back button returns to results', (await page.locator('#results-screen').isVisible()) && !page.url().includes('#/movie'));

  await openDetailFromTop(0);
  const detailUrl = page.url();
  const detailHeading = await detailText('#detail-heading');
  await page.reload();
  await page.waitForSelector('#detail-screen .detail');
  check('opening a detail URL directly after a reload works, with the breakdown',
    page.url() === detailUrl && (await detailText('#detail-heading')) === detailHeading && (await page.locator('.contrib-row').count()) === 15);
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForSelector('.top-pick');
  check('Back after a direct open still returns to results', (await page.locator('#results-screen').isVisible()) && !page.url().includes('#/movie'));

  await page.evaluate(() => { location.hash = '#/movie/Q0'; });
  await page.waitForSelector('#detail-heading');
  check('an unknown id shows "Movie not found" with a way back', (await detailText('#detail-heading')) === 'Movie not found' && (await page.getByRole('button', { name: /Back/ }).count()) === 1);
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForSelector('.top-pick');
  check('Back from "Movie not found" returns to results', await page.locator('#results-screen').isVisible());

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
