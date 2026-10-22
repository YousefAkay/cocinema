// Taster (5), Quick (10) or Full (15): nothing is chosen for the visitor, and the choice survives a refresh.
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
const currentStep = async page => parseLabel(await page.locator('#rating-screen .rating-step').textContent());

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
  await page.getByRole('button', { name: 'Rate 5 more', exact: true }).click();
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
  // First question: General or Pick a genre, nothing chosen, and the length not asked yet.
  check('the first question is General or Pick a genre, as two radios in a fieldset with a legend, neither chosen',
    (await first.page.locator('#mode-choice input[type="radio"][name="mode"]').count()) === 2
      && (await first.page.locator('#mode-choice .length-title').allInnerTexts()).join('|') === 'General|Pick a genre'
      && (await first.page.locator('#mode-choice > legend').innerText()).length > 0
      && (await first.page.locator('input[name="mode"]:checked').count()) === 0);
  check('before a mode is chosen the length cards are hidden, Get started is disabled and the status says what is missing',
    await first.page.locator('#length-choice').isHidden() && await first.page.locator('#genre-choice').isHidden()
      && await first.page.locator('#start-button').isDisabled() && (await first.page.locator('#length-status').innerText()) === 'Choose General or a genre to begin');
  await first.page.locator('.length-card:has(input[value="general"])').click();
  check('General shows the length cards and no genre chips', await first.page.locator('#length-choice').isVisible() && await first.page.locator('#genre-choice').isHidden());
  const radios = first.page.locator('input[type="radio"][name="length"]');
  check('three real radio inputs, inside a fieldset with a legend',
    (await radios.count()) === 3 && (await first.page.locator('#length-choice > legend').innerText()).includes('How many films'));
  check('the cards read Taster, Quick, Full in that order',
    (await first.page.locator('#length-choice .length-title').allInnerTexts()).join('|') === 'Taster|Quick|Full'
      && (await first.page.locator('.length-card:has(input[value="5"]) .length-detail').innerText()) === '5 films, rougher picks');
  check('no option is selected on first load', (await first.page.locator('input[name="length"]:checked').count()) === 0);
  check('with General chosen, Get started is disabled and the status says "Choose a length to begin"',
    await first.page.locator('#start-button').isDisabled() && (await first.page.locator('#length-status').innerText()) === 'Choose a length to begin');
  const sizes = await first.page.$$eval('#length-choice .length-card', cards => cards.map(card => Math.round(card.getBoundingClientRect().height)));
  check('all three choice cards are at least 44px tall', sizes.length === 3 && sizes.every(height => height >= 44), sizes.join(', '));
  const cardsFit = await first.page.$$eval('#length-choice .length-card', cards => cards.every(card => {
    const box = card.getBoundingClientRect();
    const text = card.querySelector('.length-detail').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && text.right <= box.right && parseFloat(getComputedStyle(card.querySelector('.length-detail')).fontSize) >= 14;
  }));
  check('at 375px the three cards fit the width and their text is at least 14px', cardsFit);

  // Selecting any card, including Taster with its longer sentence, moves nothing on the page.
  const layout = () => first.page.evaluate(() => ['#length-choice', '.start-row', '.length-status-row', '.poster-strip', '#how']
    .map(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return [box.top + scrollY, box.height].map(Math.round).join(','); }).join(' '));
  const unselected = await layout();
  const layouts = [];
  for (const value of ['5', '10', '15', '5']) {
    await first.page.locator(`.length-card:has(input[value="${value}"])`).click();
    layouts.push(await layout());
  }
  check('choosing Taster, Quick or Full never shifts the layout', layouts.every(entry => entry === unselected), `${unselected} / ${layouts.join(' / ')}`);

  const tasterText = await first.page.locator('#length-status').innerText();
  check('choosing Taster shows a short note about rougher picks, the 3-film minimum and rating more',
    tasterText === "Rougher picks from 5 films. Rate at least 3 with different scores; you can always add more.", tasterText);
  const noteLines = await first.page.locator('#length-status').evaluate(node => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  check('at 375px the Taster note takes at most two lines', noteLines <= 2, `${noteLines} lines`);
  check('the invisible sizing copy matches the Taster note', (await first.page.locator('#length-status-spacer').textContent()) === tasterText);
  await first.page.locator('.length-card:has(input[value="10"])').click();
  check('the Taster sentence goes away for Quick', !/rougher|at least 3/.test(await first.page.locator('#length-status').innerText()));
  await first.page.locator('.length-card:has(input[value="15"])').click();
  check('and for Full', !/rougher|at least 3/.test(await first.page.locator('#length-status').innerText()));
  check('the spacer that holds the row open is hidden from screen readers',
    (await first.page.locator('#length-status-spacer').getAttribute('aria-hidden')) === 'true' && await first.page.locator('#length-status-spacer').evaluate(node => getComputedStyle(node).visibility === 'hidden'));
  check('no horizontal scroll on the landing screen', await first.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  await first.page.locator('.length-card:has(input[value="10"])').click();
  await first.page.waitForSelector('#start-button:not([disabled])');
  check('choosing Quick enables Get started and says "Ready: 10 films"', (await first.page.locator('#length-status').innerText()) === 'Ready: 10 films');
  await first.page.locator('.length-card:has(input[value="15"])').click();
  check('choosing Full says "Ready: 15 films"', (await first.page.locator('#length-status').innerText()) === 'Ready: 15 films');

  // No duration claim anywhere in the choice area: it depends on how fast someone rates.
  const noDuration = /minute|second|\bmin\b|\bsec\b|hour|takes about|~/i;
  const choiceText = async () => (await first.page.locator('#length-choice').innerText()) + ' ' + (await first.page.locator('#length-status').innerText());
  await first.page.locator('.length-card:has(input[value="5"])').click();
  const tasterChoice = await choiceText();
  await first.page.locator('.length-card:has(input[value="10"])').click();
  const quickText = await choiceText();
  await first.page.locator('.length-card:has(input[value="15"])').click();
  const fullText = await choiceText();
  check('the three options and the status line never mention minutes, seconds or any duration',
    !noDuration.test(tasterChoice) && !noDuration.test(quickText) && !noDuration.test(fullText) && quickText.includes('Ready: 10 films') && fullText.includes('Ready: 15 films'),
    `${quickText.replace(/\s+/g, ' ')} || ${fullText.replace(/\s+/g, ' ')}`);
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
  check('Quick results nudge towards "Rate 5 more"', (await quick.page.locator('.results-nudge').innerText()) === 'Want sharper picks? Rate 5 more');
  check('"Rate 5 more" works in Quick mode and changes the list', await rateFiveMore(quick.page));
  await quick.page.reload();
  await quick.page.waitForSelector('.top-pick');
  check('a refresh on Quick results keeps the Quick results', (await quick.page.locator('.results-nudge').count()) === 1);

  await quick.page.getByRole('button', { name: 'Start over' }).click();

  await quick.page.locator('dialog .confirm-ok').click();
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

  // Taster: 5 steps, a refresh keeps the length, the nudge shows, Rate 5 more works
  const taster = await newPage();
  await taster.page.goto(server.base);
  await taster.page.waitForSelector('.length-card');
  await chooseAndStart(taster.page, 5);
  await taster.page.waitForSelector('#rating-screen .rating-widget');
  const tasterFirst = await currentStep(taster.page);
  check('Taster shows "n / 5" starting at 1', tasterFirst.n === 1 && tasterFirst.of === 5, JSON.stringify(tasterFirst));
  await taster.page.getByRole('button', { name: '9', exact: true }).click();
  await taster.page.getByRole('button', { name: 'Confirm' }).click();
  const tasterMid = await currentStep(taster.page);
  await taster.page.reload();
  await taster.page.waitForSelector('#rating-screen .rating-widget');
  check('a refresh in a Taster session keeps the length and the same genre', JSON.stringify(await currentStep(taster.page)) === JSON.stringify(tasterMid) && tasterMid.of === 5);
  const tasterSteps = await finishOnboarding(taster.page, [tasterFirst]);
  check('a Taster session covers exactly 5 different genres', tasterSteps.length === 5 && new Set(tasterSteps.map(step => step.genre)).size === 5,
    tasterSteps.map(step => step.genre).join(', '));
  check('Taster results nudge towards "Rate 5 more"', (await taster.page.locator('.results-nudge').innerText()) === 'Want sharper picks? Rate 5 more');
  check('Taster results say they are based on 5 films', (await taster.page.locator('.results-basis').innerText()) === 'These picks are based on the 5 films you rated.');
  check('"Rate 5 more" works in Taster mode and changes the list', await rateFiveMore(taster.page));
  await taster.context.close();

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
