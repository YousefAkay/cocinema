// Short sessions and the results that cannot rank yet: a Taster where most films are skipped, or
// every film gets the same score, must lead to "Rate more" and then to real picks, never to a dead
// end. Also a share link made from a Taster session, and a friend who rates too few.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function person() {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
  return { context, page };
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4') || 'null'));
const onRating = page => page.locator('#rating-screen').isVisible();
async function rate(page, score) {
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
}
const skip = page => page.getByRole('button', { name: "Haven't seen it" }).click();
const genreN = async page => Number(/· (\d+) \//.exec(await page.locator('#rating-screen .rating-step').textContent())[1]);

// Rates the first film of each of the first genres with the given scores, then skips everything else.
async function rateThenSkip(page, scores) {
  let given = 0;
  for (let guard = 0; guard < 80 && await onRating(page); guard++) {
    if (given < scores.length && (await genreN(page)) === given + 1) {
      await rate(page, scores[given++]);
    } else {
      await skip(page);
    }
  }
}

async function scan(page, name) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  check(`axe: ${name} has no violations`, violations.length === 0, violations.map(v => `${v.id} ${v.nodes.map(n => n.target.join(' ')).join(' ; ')}`).join(', '));
}

// Works through "Rate 5 more" with varied scores until the results show picks.
async function recover(page) {
  const scores = [9, 3, 8, 2, 10];
  for (let i = 0; i < 5 && await onRating(page); i++) {
    await page.waitForSelector('#rating-screen .rating-widget');
    await rate(page, scores[i]);
  }
  await page.waitForSelector('.top-pick, .combined, .not-enough');
}

try {
  // ---- A Taster with most films skipped: 2 ratings
  const a = await person();
  await a.page.goto(server.base);
  await a.page.waitForSelector('.length-card');
  await chooseAndStart(a.page, 5);
  await a.page.waitForSelector('#rating-screen .rating-widget');
  await rateThenSkip(a.page, [9, 3]);
  await a.page.waitForSelector('.not-enough');
  const state = await saved(a.page);
  check('the Taster ended with 2 ratings and the rest skipped', state.ratings.length === 2 && state.skipped.length > 10 && state.genreIndex === 5,
    `${state.ratings.length} rated, ${state.skipped.length} skipped`);
  const text = await a.page.locator('.not-enough').innerText();
  check('the results say how many were rated and that a few more are needed',
    /You've rated 2 films so far\./.test(text) && /needs at least 3, with different scores/.test(text), text.replace(/\n/g, ' | '));
  check('the results are not only "Start over": no picks, and "Rate 5 more" comes first',
    (await a.page.locator('.top-pick').count()) === 0
      && (await a.page.locator('.not-enough .results-actions button').allInnerTexts()).join('|') === 'Rate 5 more|Start over');
  check('"Rate 5 more" is the primary button and Start over the secondary one',
    await a.page.locator('.not-enough button.rate-more').isVisible() && await a.page.locator('.not-enough button.start-over').isVisible());
  check('focus moves to the message heading', await a.page.evaluate(() => document.activeElement.id === 'not-enough-title'));
  check('no "Watch with a friend" invite is offered before there are picks', (await a.page.locator('#cowatch-share').count()) === 0);
  await scan(a.page, 'the not-enough results');
  await a.page.reload();
  await a.page.waitForSelector('.not-enough');
  check('a refresh shows the same message', /You've rated 2 films so far/.test(await a.page.locator('.not-enough').innerText()));

  await a.page.locator('.not-enough button.rate-more').click();
  await a.page.waitForSelector('#rating-screen .rating-widget');
  check('"Rate 5 more" starts the Rate more flow', /Rate more · 1 of 5/.test(await a.page.locator('#rating-screen .rating-step').textContent()));
  await recover(a.page);
  check('after rating more, real picks appear', await a.page.locator('.top-pick').first().isVisible() && (await a.page.locator('.not-enough').count()) === 0);
  check('and they are based on 7 films', (await a.page.locator('.results-basis').innerText()) === 'These picks are based on the 7 films you rated.');
  await a.context.close();

  // ---- Rate more that still cannot rank: 1 rating, then five more all with the same score
  const b = await person();
  await b.page.goto(server.base);
  await b.page.waitForSelector('.length-card');
  await chooseAndStart(b.page, 5);
  await b.page.waitForSelector('#rating-screen .rating-widget');
  await rateThenSkip(b.page, [7]);
  await b.page.waitForSelector('.not-enough');
  check('with one rating the message uses the singular', /You've rated 1 film so far\./.test(await b.page.locator('.not-enough').innerText()));
  await b.page.locator('.not-enough button.rate-more').click();
  await b.page.waitForSelector('#rating-screen .rating-widget');
  for (let i = 0; i < 5; i++) {
    await b.page.waitForSelector('#rating-screen .rating-widget');
    await rate(b.page, 7);
  }
  await b.page.waitForSelector('#results-screen .not-enough');
  check('if Rate more still cannot rank, the same way forward is offered again',
    /You've rated 6 films, all with the same score/.test(await b.page.locator('.not-enough').innerText()) && await b.page.locator('.not-enough button.rate-more').isVisible());
  await b.page.locator('.not-enough button.rate-more').click();
  await recover(b.page);
  check('and a second round of Rate more with different scores reaches real picks', await b.page.locator('.top-pick').first().isVisible());
  await b.context.close();

  // ---- Every film with the same score
  const c = await person();
  await c.page.goto(server.base);
  await c.page.waitForSelector('.length-card');
  await chooseAndStart(c.page, 5);
  await c.page.waitForSelector('#rating-screen .rating-widget');
  for (let i = 0; i < 10 && await onRating(c.page); i++) await rate(c.page, 7);
  await c.page.waitForSelector('.not-enough');
  const same = await c.page.locator('.not-enough').innerText();
  check('five ratings all the same score explain that different scores are needed', /You've rated 5 films, all with the same score/.test(same), same.replace(/\n/g, ' | '));
  await c.page.locator('.not-enough button.rate-more').click();
  await recover(c.page);
  check('after rating more with different scores, real picks appear', await c.page.locator('.top-pick').first().isVisible());
  await c.context.close();

  // ---- The same message in a Quick session
  const d = await person();
  await d.page.goto(server.base);
  await d.page.waitForSelector('.length-card');
  await chooseAndStart(d.page, 10);
  await d.page.waitForSelector('#rating-screen .rating-widget');
  await rateThenSkip(d.page, [8, 2]);
  await d.page.waitForSelector('.not-enough');
  check('a Quick session with too few ratings gets the same way forward', await d.page.locator('.not-enough button.rate-more').isVisible());
  await d.context.close();

  // ---- A share link made from a Taster session, opened by a friend who rates too few
  const e = await person();
  await e.page.goto(server.base);
  await e.page.waitForSelector('.length-card');
  await chooseAndStart(e.page, 5);
  for (const score of [9, 2, 8, 3, 10]) {
    await e.page.waitForSelector('#rating-screen .rating-widget');
    await rate(e.page, score);
  }
  await e.page.waitForSelector('.top-pick');
  await e.page.locator('#cowatch-share').click();
  await e.page.waitForFunction(() => document.getElementById('cowatch-status').textContent.length > 0);
  const link = await e.page.evaluate(() => navigator.clipboard.readText());
  check('a Taster session can make a share link', link.includes('#/with/'), link.length + ' characters');

  const f = await person();
  await f.page.goto(link);
  await f.page.waitForSelector('.friend-banner');
  check('the friend sees "They rated 5 films"', /They rated 5 films\./.test(await f.page.locator('.friend-banner').innerText()));
  await chooseAndStart(f.page, 5);
  await f.page.waitForSelector('#rating-screen .rating-widget');
  await rateThenSkip(f.page, [6, 6]);
  await f.page.waitForSelector('.not-enough');
  const friendText = await f.page.locator('#results-screen').innerText();
  check('a friend who rated too few sees their own count and the way forward, not a message about the link',
    /You've rated 2 films so far/.test(friendText) && !/link|your friend/i.test(friendText), friendText.replace(/\n/g, ' | '));
  await f.page.locator('.not-enough button.rate-more').click();
  await recover(f.page);
  check('after rating more, the friend reaches "Films you\'d both enjoy"',
    await f.page.locator('.combined').isVisible() && (await f.page.locator('#combined-title').innerText()) === "Films you'd both enjoy");
  await e.context.close();
  await f.context.close();
} catch (error) {
  check('taster run finished without an exception', false, String(error.message).slice(0, 300));
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
