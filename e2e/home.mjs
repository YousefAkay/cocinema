// Going home: the logo link, the Home button, the browser's Back button, the confirmation dialog
// and "Continue". Ratings must survive every one of them.
import { chromium } from 'playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function person(size = { width: 375, height: 667 }) {
  const context = await browser.newContext({ viewport: size, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
  });
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  return { context, page };
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4') || 'null'));
const title = page => page.locator('#rating-screen .rating-title').innerText();
const rate = async (page, score) => {
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.click('.confirm-score');
};
const dialogVisible = page => page.locator('dialog.confirm-dialog[open]').isVisible();
const focusedText = page => page.evaluate(() => document.activeElement ? document.activeElement.textContent.trim() : '');

try {
  // ---- No ratings yet: Home goes straight to the landing screen
  const a = await person();
  check('the logo is a link with the accessible name "CoCinema, home" on the landing screen',
    await a.page.locator('#landing-screen').getByRole('link', { name: 'CoCinema, home' }).count() === 1);
  await chooseAndStart(a.page, 10);
  await a.page.waitForSelector('.rating-frame');
  check('the rating screen has the logo link and a Home button beside the counter',
    await a.page.getByRole('link', { name: 'CoCinema, home' }).isVisible()
      && await a.page.locator('.rating-top .home-button').isVisible() && await a.page.locator('.rating-top .rating-step').isVisible());
  await a.page.click('.home-button');
  check('with no ratings, Home goes directly to the landing screen (no dialog)',
    await a.page.locator('#landing-screen').isVisible() && !(await dialogVisible(a.page)));
  check('the landing screen after Home has no default length and no Continue when nothing is rated',
    (await a.page.locator('input[name="length"]:checked').count()) === 0 && await a.page.locator('#continue-button').isHidden());

  // ---- With ratings: the dialog
  await chooseAndStart(a.page, 10);
  await a.page.waitForSelector('.rating-frame');
  const first = await title(a.page);
  await rate(a.page, 8);
  const second = await title(a.page);
  await rate(a.page, 3);
  const third = await title(a.page);
  await a.page.click('.home-button');
  check('with ratings, Home opens a dialog named "Leave and keep your ratings?"',
    await a.page.getByRole('dialog', { name: 'Leave and keep your ratings?' }).isVisible());
  check('focus starts on "Keep going" and the page behind cannot be tabbed to', (await focusedText(a.page)) === 'Keep going');
  const cycle = [];
  for (let i = 0; i < 4; i++) {
    await a.page.keyboard.press('Tab');
    cycle.push(await focusedText(a.page));
  }
  check('Tab stays inside the dialog (it cycles between its two buttons)', cycle.every(text => text === 'Go home' || text === 'Keep going') && cycle.includes('Go home'), cycle.join(' > '));
  await a.page.keyboard.press('Escape');
  check('Escape closes the dialog and leaves the visitor on the same film', !(await dialogVisible(a.page)) && (await title(a.page)) === third);
  check('focus returns to the Home button', await a.page.evaluate(() => document.activeElement.classList.contains('home-button')));
  await a.page.click('.home-button');
  await a.page.getByRole('button', { name: 'Keep going' }).click();
  check('"Keep going" closes the dialog and stays on the film', !(await dialogVisible(a.page)) && (await title(a.page)) === third);

  await a.page.click('.home-button');
  await a.page.getByRole('button', { name: 'Go home' }).click();
  await a.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('"Go home" shows the landing screen and deletes nothing', (await saved(a.page)).ratings.length === 2);
  const continueText = await a.page.locator('#continue-button').innerText();
  check('the landing screen offers "Continue (3 of 10)" and still has no default length', continueText === 'Continue (3 of 10)'
    && (await a.page.locator('input[name="length"]:checked').count()) === 0 && await a.page.locator('#start-button').isDisabled(), continueText);
  await a.page.click('#continue-button');
  await a.page.waitForSelector('.rating-frame');
  check('Continue returns to the film the visitor was on', (await title(a.page)) === third, `${first} / ${second} / ${third}`);

  // ---- The browser's Back button
  await a.page.goBack();
  await a.page.waitForSelector('dialog.confirm-dialog[open]');
  check('the browser Back button also asks first, with ratings saved', await a.page.getByRole('dialog', { name: 'Leave and keep your ratings?' }).isVisible());
  await a.page.getByRole('button', { name: 'Keep going' }).click();
  check('after "Keep going" the visitor is still on the same film', (await title(a.page)) === third);
  await a.page.goBack();
  await a.page.waitForSelector('dialog.confirm-dialog[open]');
  await a.page.getByRole('button', { name: 'Go home' }).click();
  await a.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('Back then "Go home" shows the landing screen with the ratings kept',
    await a.page.locator('#landing-screen').isVisible() && (await saved(a.page)).ratings.length === 2);

  // ---- A refresh still resumes the session (existing behaviour)
  await a.page.reload();
  await a.page.waitForSelector('.rating-frame');
  check('a refresh resumes the saved session on the same film', (await title(a.page)) === third);

  // ---- Logo link from the results, a film page and the rating screen
  for (let i = 0; i < 40 && await a.page.locator('#rating-screen').isVisible(); i++) {
    await rate(a.page, [9, 3, 8, 2, 10][i % 5]);
  }
  await a.page.waitForSelector('.top-pick');
  await a.page.getByRole('link', { name: 'CoCinema, home' }).click();
  check('the logo link on the results screen asks first', await a.page.getByRole('dialog', { name: 'Leave and keep your ratings?' }).isVisible());
  check('on the results screen focus returns to the logo link after "Keep going"', await (async () => {
    await a.page.getByRole('button', { name: 'Keep going' }).click();
    return a.page.evaluate(() => document.activeElement.classList.contains('brand'));
  })());
  await a.page.locator('.top-pick h3 a').first().click();
  await a.page.waitForSelector('.detail');
  await a.page.getByRole('link', { name: 'CoCinema, home' }).click();
  check('the logo link on a film page asks first', await dialogVisible(a.page));
  await a.page.getByRole('button', { name: 'Go home' }).click();
  await a.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('from a film page, "Go home" shows the landing screen with Continue offered',
    await a.page.locator('#landing-screen').isVisible() && /^(Continue|See my picks)/.test(await a.page.locator('#continue-button').innerText()),
    await a.page.locator('#continue-button').innerText());
  await a.page.click('#continue-button');
  await a.page.waitForSelector('.top-pick');
  check('Continue after finishing returns to the results', true);

  // ---- Back with no ratings goes straight to the landing screen
  const b = await person();
  await chooseAndStart(b.page, 10);
  await b.page.waitForSelector('.rating-frame');
  await b.page.goBack();
  await b.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('Back with no ratings goes to the landing screen with no dialog', !(await dialogVisible(b.page)));

  // ---- Start over asks first, with the same dialog
  await a.context.close();
  await b.context.close();
  const c = await person();
  await chooseAndStart(c.page, 10);
  for (let i = 0; i < 40 && await c.page.locator('#rating-screen').isVisible(); i++) {
    await rate(c.page, [9, 3, 8, 2, 10][i % 5]);
  }
  await c.page.waitForSelector('.top-pick');
  await c.page.getByRole('button', { name: 'Start over' }).click();
  check('Start over opens a confirmation dialog', await c.page.getByRole('dialog', { name: 'Start over?' }).isVisible());
  await c.page.getByRole('button', { name: 'Keep my ratings' }).click();
  check('"Keep my ratings" keeps the results and the saved ratings', await c.page.locator('.top-pick').first().isVisible() && (await saved(c.page)).ratings.length === 10);
  check('focus returns to the Start over button', await c.page.evaluate(() => document.activeElement.classList.contains('start-over')));
  await c.page.getByRole('button', { name: 'Start over' }).click();
  await c.page.keyboard.press('Escape');
  check('Escape on the Start over dialog also keeps everything', (await saved(c.page)).ratings.length === 10 && await c.page.locator('.top-pick').first().isVisible());
  await c.page.getByRole('button', { name: 'Start over' }).click();
  await c.page.locator('dialog .confirm-ok').click();
  await c.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('confirming Start over clears the saved ratings', (await saved(c.page)) === null);
  await c.context.close();
} catch (error) {
  check('home run finished without an exception', false, String(error.message).slice(0, 300));
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
