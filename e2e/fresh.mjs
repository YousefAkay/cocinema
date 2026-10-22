// Fresh visits and refreshes: a refresh in the same tab resumes where the visitor was, a new tab
// or a new window opens on the landing screen with Continue, and direct links still open as before.
import { chromium } from 'playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

function watch(page) {
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
  });
  return page;
}

// storageState carries localStorage but never sessionStorage, which is what a new window gets.
async function newContext(storageState) {
  return browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block', storageState });
}

async function open(context, hash = '') {
  const page = watch(await context.newPage());
  await page.goto(server.base + hash);
  await page.waitForSelector('.length-card');
  return page;
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4') || 'null'));
const title = page => page.locator('#rating-screen .rating-title').innerText();
const continueText = page => page.locator('#continue-button').innerText();
const rate = async (page, score) => {
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.click('.confirm-score');
};

try {
  // ---- Mid-onboarding
  const a = await newContext();
  const first = await open(a);
  await chooseAndStart(first, 10);
  await first.waitForSelector('.rating-frame');
  for (const score of [9, 4, 7]) await rate(first, score);
  const fourth = await title(first);
  await first.reload();
  await first.waitForSelector('.rating-frame');
  check('a refresh on the rating screen resumes on the same film', (await title(first)) === fourth, fourth);

  const tab = await open(a);
  await tab.waitForSelector('#continue-button:not([hidden])');
  check('a new tab opens on the landing screen with "Continue (4 of 10)"',
    await tab.locator('#landing-screen').isVisible() && (await continueText(tab)) === 'Continue (4 of 10)', await continueText(tab));
  check('nothing saved is lost on a fresh visit', (await saved(tab)).ratings.length === 3);
  await tab.click('#continue-button');
  await tab.waitForSelector('.rating-frame');
  check('Continue resumes on the same film', (await title(tab)) === fourth);

  const window = await newContext(await a.storageState());
  const fresh = await open(window);
  await fresh.waitForSelector('#continue-button:not([hidden])');
  check('a new window opens on the landing screen with Continue', await fresh.locator('#landing-screen').isVisible()
    && (await continueText(fresh)) === 'Continue (4 of 10)');
  await fresh.reload();
  await fresh.waitForSelector('#continue-button:not([hidden])');
  check('a refresh on the landing screen stays on the landing screen', await fresh.locator('#landing-screen').isVisible());
  await window.close();
  await a.close();

  // ---- A finished session
  const b = await newContext();
  const done = await open(b);
  await chooseAndStart(done, 5);
  await done.waitForSelector('.rating-frame');
  for (const score of [9, 3, 8, 2, 10]) await rate(done, score);
  await done.waitForSelector('.top-pick');
  const topTitle = await done.locator('.top-pick h3').first().innerText();
  await done.reload();
  await done.waitForSelector('.top-pick');
  check('a refresh on the results stays on the results', await done.locator('#results-screen').isVisible());

  const later = await newContext(await b.storageState());
  const back = await open(later);
  await back.waitForSelector('#continue-button:not([hidden])');
  check('a fresh visit after finishing shows the landing screen with "See your last picks"',
    await back.locator('#landing-screen').isVisible() && (await continueText(back)) === 'See your last picks', await continueText(back));
  await back.click('#continue-button');
  await back.waitForSelector('.top-pick');
  check('"See your last picks" opens the same results', (await back.locator('.top-pick h3').first().innerText()) === topTitle);

  // ---- Direct links on a fresh visit
  const qid = await done.locator('.top-pick a[href^="#/movie/"]').first().getAttribute('href');
  const film = watch(await later.newPage());
  await film.goto(server.base + qid);
  await film.waitForSelector('#detail-screen .detail');
  check('a film-page link opens the film page on a fresh visit', await film.locator('#detail-screen').isVisible() && film.url().endsWith(qid));
  await film.getByRole('button', { name: /Back/ }).click();
  await film.waitForSelector('.top-pick');
  check('Back from that film page goes to the results, as before', await film.locator('#results-screen').isVisible());

  const payload = await done.evaluate(async () => {
    const { encodeTaste } = await import('./cowatch.js');
    return encodeTaste([{ id: 'http://www.wikidata.org/entity/Q25188', score: 9 }, { id: 'http://www.wikidata.org/entity/Q190050', score: 3 },
      { id: 'http://www.wikidata.org/entity/Q47703', score: 8 }]);
  });
  const friend = watch(await later.newPage());
  await friend.goto(`${server.base}#/with/${payload}`);
  await friend.waitForSelector('.friend-banner');
  check('a co-watch link opens the friend banner on a fresh visit', await friend.locator('#landing-screen').isVisible()
    && await friend.locator('.friend-banner').isVisible());
  await later.close();
  await b.close();

  // ---- Private mode: sessionStorage throws, the app still works
  const c = await newContext();
  await c.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });
  });
  const locked = await open(c);
  await chooseAndStart(locked, 10);
  await locked.waitForSelector('.rating-frame');
  await rate(locked, 8);
  await locked.reload();
  await locked.waitForSelector('#continue-button:not([hidden])');
  check('with sessionStorage blocked, the app works and a reload offers Continue', await locked.locator('#landing-screen').isVisible());
  await c.close();
} catch (error) {
  check('the fresh-visit checks ran without an error', false, error.message);
}

check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
server.close();
process.exit(summary() ? 1 : 0);
