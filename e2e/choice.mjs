// Quick (10) or Full (15): nothing is chosen for the visitor, and the choice survives a refresh.
import { chromium } from 'playwright';
import { startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
const scoreCycle = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];

const newPage = async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
  return { context, page };
};

const parseLabel = text => {
  const match = /^(.+) · (\d+) \/ (\d+)$/.exec(text.trim());
  return match ? { genre: match[1], n: Number(match[2]), of: Number(match[3]) } : null;
};
const currentStep = async page => parseLabel(await page.locator('#rating-screen > h1').textContent());

// Rates through onboarding, recording each genre and "n / of" label as it first appears.
async function finishOnboarding(page, seen) {
  let guard = 0;
  while (await page.locator('#rating-screen').isVisible() && guard++ < 80) {
    const step = await currentStep(page);
    if (step && !seen.some(entry => entry.n === step.n)) seen.push(step);
    await page.getByRole('button', { name: String(scoreCycle[guard % scoreCycle.length]), exact: true }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await page.waitForSelector('.top-pick');
  return seen;
}

async function rateFiveMore(page) {
  const before = await page.locator('.top-pick h3').allInnerTexts();
  await page.getByRole('button', { name: 'Rate 5 more' }).click();
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('#rating-screen .rating-widget');
    await page.getByRole('button', { name: String([8, 3, 9, 2, 10][i]), exact: true }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await page.waitForSelector('.top-pick');
  return JSON.stringify(before) !== JSON.stringify(await page.locator('.top-pick h3').allInnerTexts());
}

try {
  // Nothing is chosen by default
  const first = await newPage();
  await first.page.goto(server.base);
  await first.page.waitForSelector('.length-card');
  const radios = first.page.locator('input[type="radio"][name="length"]');
  check('two real radio inputs, inside a fieldset with a legend',
    (await radios.count()) === 2 && (await first.page.locator('fieldset.length-choice > legend').innerText()).includes('How many films'));
  check('neither option is selected on first load', (await first.page.locator('input[name="length"]:checked').count()) === 0);
  check('Get started is disabled and the status says "Choose a length to begin"',
    await first.page.locator('#start-button').isDisabled() && (await first.page.locator('#length-status').innerText()) === 'Choose a length to begin');
  const sizes = await first.page.$$eval('.length-card', cards => cards.map(card => Math.round(card.getBoundingClientRect().height)));
  check('both choice cards are at least 44px tall', sizes.every(height => height >= 44), sizes.join(', '));
  check('no horizontal scroll on the landing screen', await first.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  await first.page.locator('.length-card:has(input[value="10"])').click();
  await first.page.waitForSelector('#start-button:not([disabled])');
  check('choosing Quick enables Get started and says "Ready: 10 films, about a minute"', (await first.page.locator('#length-status').innerText()) === 'Ready: 10 films, about a minute');
  await first.page.locator('.length-card:has(input[value="15"])').click();
  check('choosing Full says "Ready: 15 films, about two minutes"', (await first.page.locator('#length-status').innerText()) === 'Ready: 15 films, about two minutes');
  await first.page.reload();
  await first.page.waitForSelector('.length-card');
  check('reloading the landing page shows nothing selected', (await first.page.locator('input[name="length"]:checked').count()) === 0 && await first.page.locator('#start-button').isDisabled());
  await first.context.close();

  // Quick: 10 steps, refresh in the middle keeps the length and the same genres
  const quick = await newPage();
  await quick.page.goto(server.base);
  await quick.page.waitForSelector('.length-card');
  await chooseAndStart(quick.page, 10);
  await quick.page.waitForSelector('#rating-screen .rating-widget');
  const seenQuick = [];
  for (let i = 0; i < 3; i++) {
    seenQuick.push(await currentStep(quick.page));
    await quick.page.getByRole('button', { name: '8', exact: true }).click();
    await quick.page.getByRole('button', { name: 'Confirm' }).click();
  }
  const beforeRefresh = await currentStep(quick.page);
  check('Quick shows "n / 10" starting at 1', seenQuick[0].n === 1 && seenQuick[0].of === 10, JSON.stringify(seenQuick[0]));
  await quick.page.reload();
  await quick.page.waitForSelector('#rating-screen .rating-widget');
  const afterRefresh = await currentStep(quick.page);
  check('a refresh mid-session keeps the length and the same genre', JSON.stringify(beforeRefresh) === JSON.stringify(afterRefresh) && afterRefresh.of === 10, JSON.stringify(afterRefresh));
  const quickSteps = await finishOnboarding(quick.page, [...seenQuick]);
  const quickGenres = quickSteps.map(step => step.genre);
  check('a Quick session covers exactly 10 different genres', quickSteps.length === 10 && new Set(quickGenres).size === 10, quickGenres.join(', '));
  const basis = await quick.page.locator('.results-basis').innerText();
  check('results say how many films the picks are based on', /^These picks are based on the \d+ films? you rated\.$/.test(basis), basis);
  check('Quick results nudge towards "Rate 5 more"', (await quick.page.locator('.results-nudge').innerText()) === 'Want sharper picks? Rate 5 more.');
  check('"Rate 5 more" works in Quick mode and changes the list', await rateFiveMore(quick.page));
  await quick.page.reload();
  await quick.page.waitForSelector('.top-pick');
  check('a refresh on Quick results keeps the Quick results', (await quick.page.locator('.results-nudge').count()) === 1);

  await quick.page.getByRole('button', { name: 'Start over' }).click();
  await quick.page.waitForSelector('.length-card');
  check('Start over returns to the landing screen with nothing selected',
    (await quick.page.locator('#landing-screen').isVisible()) && (await quick.page.locator('input[name="length"]:checked').count()) === 0 && await quick.page.locator('#start-button').isDisabled());
  await quick.context.close();

  // A second Quick session asks about a different set or order of genres
  const again = await newPage();
  await again.page.goto(server.base);
  await again.page.waitForSelector('.length-card');
  await chooseAndStart(again.page, 10);
  await again.page.waitForSelector('#rating-screen .rating-widget');
  const againGenres = (await finishOnboarding(again.page, [])).map(step => step.genre);
  check('another Quick session covers a different 10 genres or a different order', againGenres.join() !== quickGenres.join(), againGenres.join(', '));
  await again.context.close();

  // Full: 15 steps, no nudge, Rate 5 more works
  const full = await newPage();
  await full.page.goto(server.base);
  await full.page.waitForSelector('.length-card');
  await chooseAndStart(full.page, 15);
  await full.page.waitForSelector('#rating-screen .rating-widget');
  const fullSteps = await finishOnboarding(full.page, []);
  check('Full shows "n / 15" and covers all 15 genres', fullSteps.length === 15 && fullSteps.every(step => step.of === 15) && new Set(fullSteps.map(step => step.genre)).size === 15);
  check('Full results have no "Want sharper picks" nudge but still say what they are based on', (await full.page.locator('.results-nudge').count()) === 0 && (await full.page.locator('.results-basis').count()) === 1);
  check('"Rate 5 more" works in Full mode and changes the list', await rateFiveMore(full.page));
  await full.context.close();

  check('no console errors or uncaught errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('choice run finished without an exception', false, error.message);
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
