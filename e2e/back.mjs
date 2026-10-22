// Going back to the previous film during onboarding and in "Rate 5 more": skipped films come back
// fresh, rated films come back with their score, the visitor then carries on from the first film
// not yet answered, and all of it survives a refresh.
import { chromium } from 'playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function person() {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
  });
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  await chooseAndStart(page, 10);
  await page.waitForSelector('.rating-frame');
  return { context, page };
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4') || 'null'));
const title = page => page.locator('#rating-screen .rating-title').innerText();
const label = page => page.locator('#rating-screen .rating-step').textContent();
const genreOf = text => text.split(' · ')[0];
const selectedScore = page => page.evaluate(() => {
  const pressed = document.querySelectorAll('.rating-widget button[aria-pressed="true"]');
  return pressed.length === 1 ? Number(pressed[0].textContent) : pressed.length === 0 ? null : 'several';
});
const back = page => page.locator('.back-button');
async function rate(page, score) {
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.click('.confirm-score');
}
const skip = page => page.getByRole('button', { name: "Haven't seen it" }).click();
const pressBack = page => back(page).click();

try {
  // ---- The first film: Back is there but disabled, and it is reachable and named
  const a = await person();
  check('Back sits in the top row beside Home', await a.page.locator('.rating-top .rating-nav .home-button + .back-button').isVisible());
  check('Back is disabled on the very first film', await back(a.page).isDisabled());
  check('Back has an accessible name that starts with its visible text',
    await a.page.getByRole('button', { name: 'Back to the previous film' }).count() === 1);

  // ---- The example: skip A, skip B, Back, Back, rate A; B and C are never shown again
  const filmA = await title(a.page);
  const genreA = genreOf(await label(a.page));
  await skip(a.page);
  const filmB = await title(a.page);
  await skip(a.page);
  const filmC = await title(a.page);
  check('skipping A and B stays in the same genre and reaches C', genreOf(await label(a.page)) === genreA && new Set([filmA, filmB, filmC]).size === 3);
  check('Back is enabled once a film has been answered', await back(a.page).isEnabled());
  check('two films are skipped before going back', (await saved(a.page)).skipped.length === 2);

  await pressBack(a.page);
  check('Back shows B, the previous film', (await title(a.page)) === filmB && genreOf(await label(a.page)) === genreA);
  check('B is no longer skipped and shows no score', (await saved(a.page)).skipped.length === 1 && (await selectedScore(a.page)) === null);
  check('focus moves to the new film title so a screen reader announces it, as on every step',
    await a.page.evaluate(() => document.activeElement.classList.contains('rating-title') && document.activeElement.getAttribute('aria-label').includes(document.activeElement.textContent)));
  await pressBack(a.page);
  check('Back again shows A', (await title(a.page)) === filmA);
  check('A and B are both no longer skipped', (await saved(a.page)).skipped.length === 0);
  check('Back is disabled again on the first film', await back(a.page).isDisabled());

  await rate(a.page, 8);
  const afterA = await label(a.page);
  check('rating A as 8 finishes the genre and moves on to the next one', genreOf(afterA) !== genreA && afterA.includes('2 / 10'), afterA);
  const savedA = await saved(a.page);
  check('A is saved as 8 and nothing is skipped', savedA.ratings.length === 1 && savedA.ratings[0][1] === 8 && savedA.skipped.length === 0);

  const seen = [];
  for (let i = 0; i < 40 && await a.page.locator('#rating-screen').isVisible(); i++) {
    seen.push(await title(a.page));
    await rate(a.page, [9, 3, 8, 2, 10][i % 5]);
  }
  await a.page.waitForSelector('.top-pick');
  check('B and C are never shown for the rest of the session', !seen.includes(filmB) && !seen.includes(filmC) && !seen.includes(filmA), seen.join(' | '));
  check('all ten genres end with one rating each', (await saved(a.page)).ratings.length === 10);

  // ---- "Rate 5 more": Back works there too
  await a.page.getByRole('button', { name: 'Rate 5 more', exact: true }).click();
  await a.page.waitForSelector('.rating-frame');
  check('Back is disabled on the first "Rate 5 more" film', await back(a.page).isDisabled());
  const extraFirst = await title(a.page);
  await skip(a.page);
  check('after a skip in "Rate 5 more", Back is enabled', await back(a.page).isEnabled());
  await pressBack(a.page);
  check('Back in "Rate 5 more" returns to the skipped film, no longer skipped',
    (await title(a.page)) === extraFirst && !(await saved(a.page)).skipped.length && (await label(a.page)).includes('1 of 5'));
  await rate(a.page, 7);
  check('rating it counts as the first extra film', (await label(a.page)).includes('2 of 5'));
  await pressBack(a.page);
  check('Back to a rated extra film shows its score and is not counted twice',
    (await title(a.page)) === extraFirst && (await selectedScore(a.page)) === 7 && (await label(a.page)).includes('1 of 5'));
  await a.page.reload();
  await a.page.waitForSelector('.rating-frame');
  check('a refresh in "Rate 5 more" after Back keeps the same film and score',
    (await title(a.page)) === extraFirst && (await selectedScore(a.page)) === 7);
  await a.page.click('.confirm-score');
  check('keeping the score moves on to the next extra film', (await label(a.page)).includes('2 of 5') && (await title(a.page)) !== extraFirst);
  await a.context.close();

  // ---- Changing a rated score, and taking a rating back
  const b = await person();
  const first = await title(b.page);
  const firstGenre = genreOf(await label(b.page));
  await rate(b.page, 6);
  const second = await title(b.page);
  await pressBack(b.page);
  check('Back to a rated film shows it with the previous score selected', (await title(b.page)) === first && (await selectedScore(b.page)) === 6);
  check('the title announces the score already given',
    (await b.page.locator('.rating-title').getAttribute('aria-label')).endsWith(`${first}, your score 6`));
  await rate(b.page, 9);
  check('changing the score saves the new one and returns to the next film not answered',
    (await title(b.page)) === second && (await saved(b.page)).ratings.length === 1 && (await saved(b.page)).ratings[0][1] === 9);
  await pressBack(b.page);
  check('the changed score is the one selected on the way back', (await selectedScore(b.page)) === 9);
  await b.page.click('.confirm-score');
  check('confirming the same score again just moves on', (await title(b.page)) === second && (await saved(b.page)).ratings[0][1] === 9);
  await pressBack(b.page);
  await skip(b.page);
  const afterTakeBack = await saved(b.page);
  check('"Haven\'t seen it" on a rated film removes the rating and marks it skipped',
    afterTakeBack.ratings.length === 0 && afterTakeBack.skipped.length === 1);
  check('that genre is open again, so its next film comes up',
    genreOf(await label(b.page)) === firstGenre && ![first, second].includes(await title(b.page)));

  // ---- Refresh after Back
  const current = await title(b.page);
  await rate(b.page, 5);
  const skippedFilm = await title(b.page);
  await skip(b.page);
  await pressBack(b.page);
  await b.page.reload();
  await b.page.waitForSelector('.rating-frame');
  check('refreshing right after Back shows the same film', (await title(b.page)) === skippedFilm && await back(b.page).isEnabled());
  check('after the refresh that film is still not skipped', !(await saved(b.page)).skipped.includes((await saved(b.page)).trail.at(-1)));
  await pressBack(b.page);
  await b.page.reload();
  await b.page.waitForSelector('.rating-frame');
  check('refreshing after going back to a rated film keeps it and its score', (await title(b.page)) === current && (await selectedScore(b.page)) === 5);
  await b.context.close();

  // ---- A save from before Back existed (no trail) still loads, and Back still works
  const c = await person();
  const oldFirst = await title(c.page);
  await rate(c.page, 4);
  await skip(c.page);
  const oldCurrent = await title(c.page);
  await c.page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('cocinema:v4'));
    delete value.trail;
    localStorage.setItem('cocinema:v4', JSON.stringify(value));
  });
  await c.page.reload();
  await c.page.waitForSelector('.rating-frame');
  check('a save with no trail loads on the same film', (await title(c.page)) === oldCurrent);
  await pressBack(c.page);
  await pressBack(c.page);
  check('Back walks the rebuilt history to the first film and its score', (await title(c.page)) === oldFirst && (await selectedScore(c.page)) === 4 && await back(c.page).isDisabled());

  // ---- Keyboard: Back is reachable with Tab and shows a focus ring
  await rate(c.page, 4);
  await c.page.locator('.home-button').focus();
  await c.page.keyboard.press('Tab');
  const ring = await c.page.evaluate(() => {
    const element = document.activeElement;
    return { isBack: element.classList.contains('back-button'), outline: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth };
  });
  check('Tab from Home reaches Back, with a visible focus ring', ring.isBack && ring.outline === 'solid' && ring.width === '3px', JSON.stringify(ring));
  await c.page.keyboard.press('Enter');
  check('Enter on Back goes back', (await title(c.page)) === oldFirst);
  await c.context.close();
} catch (error) {
  check('back run finished without an exception', false, String(error.message).slice(0, 300));
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
