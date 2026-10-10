// Accessibility scan (axe) at phone size on every screen, plus keyboard checks on the rating screen.
// Any serious or critical violation, or any violation at all, fails the run; rules are never switched off.
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { shots, startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
const report = [];

const newContext = () => browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });

function watch(page) {
  page.on('pageerror', error => problems.push(error.message));
}

async function scan(page, name) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      report.push(`${name}: [${violation.impact}] ${violation.id} -> ${node.target.join(' ')}`);
    }
  }
  const blocking = violations.filter(violation => ['serious', 'critical'].includes(violation.impact));
  check(`axe: ${name} has no violations`, violations.length === 0,
    violations.map(violation => `${violation.id}/${violation.impact} x${violation.nodes.length}`).join(', ') || 'clean');
  return blocking.length;
}

const scoreCycle = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];
async function rate(page, score) {
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
}
async function onboard(page, scores) {
  let step = 0;
  while (await page.locator('#rating-screen').isVisible() && step < 60) {
    await rate(page, scores[step % scores.length]);
    step++;
  }
}

try {
  // Landing, rating screen, results, film page, extra flow
  const context = await newContext();
  const page = await context.newPage();
  watch(page);
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  await scan(page, 'landing screen');

  await chooseAndStart(page);
  await page.waitForSelector('#rating-screen .rating-widget');
  await scan(page, 'rating screen');

  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click(); // no score yet: shows the hint
  await page.waitForSelector('.rating-hint:not(:empty)');
  await scan(page, 'rating screen with the "Pick a score first" hint');

  await onboard(page, scoreCycle);
  await page.waitForSelector('.top-pick');
  await scan(page, 'results screen with top-5 cards');
  await page.click('.cowatch-toggle');
  await scan(page, 'results screen with the Watch with a friend samples open');
  await page.setViewportSize({ width: 1440, height: 900 });
  await scan(page, 'results screen with the samples open at 1440 px');
  await page.click('.cowatch-toggle');
  await scan(page, 'results screen at 1440 px');
  await page.setViewportSize({ width: 375, height: 667 });

  await page.locator('.top-pick h3 a').first().click();
  await page.waitForSelector('.country-block');
  await scan(page, 'film page');
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForSelector('.top-pick');

  await page.getByRole('button', { name: 'Rate 5 more', exact: true }).click();
  await page.waitForSelector('#rating-screen .rating-widget');
  await scan(page, 'extra-rating flow');
  await page.click('.home-button');
  await page.waitForSelector('dialog.confirm-dialog[open]');
  await scan(page, 'leave-and-keep-your-ratings dialog');
  await page.keyboard.press('Escape');
  await context.close();

  // Empty-results message: every film rated the same, so there is no taste to rank by
  const flat = await newContext();
  const flatPage = await flat.newPage();
  watch(flatPage);
  await flatPage.goto(server.base);
  await flatPage.waitForSelector('.length-card');
  await chooseAndStart(flatPage);
  await onboard(flatPage, [5]);
  await flatPage.waitForSelector('#results-screen .start-over');
  await scan(flatPage, 'empty-results message');
  await flat.close();

  // Error state of the landing screen
  const broken = await newContext();
  const brokenPage = await broken.newPage();
  watch(brokenPage);
  await brokenPage.route('**/catalog.json', route => route.abort());
  await brokenPage.goto(server.base);
  await brokenPage.waitForSelector('#load-error:not([hidden])');
  await scan(brokenPage, 'landing screen error state');
  await broken.close();

  // Keyboard use on the rating screen
  const keyboard = await newContext();
  const kbPage = await keyboard.newPage();
  watch(kbPage);
  await kbPage.goto(server.base);
  await kbPage.waitForSelector('.length-card');
  const focused = () => kbPage.evaluate(() => {
    const node = document.activeElement;
    if (!node) return 'none';
    return node.tagName === 'INPUT' ? `input:${node.value}` : `${node.tagName.toLowerCase()}:${node.textContent.trim()}`;
  });

  check('landing: nothing is chosen and Get started is disabled until a choice is made',
    (await kbPage.locator('input[name="length"]:checked').count()) === 0 && await kbPage.locator('#start-button').isDisabled());
  await kbPage.keyboard.press('Tab');
  check('landing: Tab starts with the logo link home', (await focused()) === 'a:CoCinema' && (await kbPage.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'CoCinema, home', await focused());
  await kbPage.keyboard.press('Tab');
  check('landing: then the "How it works" link', (await focused()) === 'a:How it works', await focused());
  await kbPage.keyboard.press('Tab');
  check('landing: then the GitHub link', (await focused()).startsWith('a:Open source'), await focused());
  await kbPage.keyboard.press('Tab');
  check('landing: then the first length option', (await focused()) === 'input:10', await focused());
  await kbPage.keyboard.press('ArrowDown');
  check('landing: the arrow key moves to Full and chooses it', (await focused()) === 'input:15' && await kbPage.locator('input[value="15"]').isChecked());
  await kbPage.keyboard.press('ArrowUp');
  await kbPage.keyboard.press('Space');
  check('landing: Space chooses Quick', await kbPage.locator('input[value="10"]').isChecked());
  await kbPage.waitForSelector('#start-button:not([disabled])');
  await kbPage.keyboard.press('Tab');
  check('landing: the next Tab reaches Get started', (await focused()) === 'button:Get started', await focused());
  await kbPage.keyboard.press('Enter');
  await kbPage.waitForSelector('#rating-screen .rating-widget');
  const firstLabel = await kbPage.locator('#rating-screen .rating-step').textContent();
  const firstTitle = await kbPage.locator('#rating-screen .rating-title').textContent();
  check('starting moves focus to the film title heading', (await focused()) === `h1:${firstTitle}`, await focused());

  const order = [];
  for (let i = 0; i < 12; i++) {
    await kbPage.keyboard.press('Tab');
    order.push((await focused()).replace('button:', ''));
  }
  check('Tab order is logical: scores 1 to 10, Confirm, then "Haven\'t seen it"',
    order.join('|') === '1|2|3|4|5|6|7|8|9|10|Confirm|Haven\'t seen it', order.join('|'));

  const ring = await kbPage.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor, offset: parseFloat(style.outlineOffset) };
  });
  check('the focus ring is visible (solid, at least 2px, offset from the button)', ring.style === 'solid' && ring.width >= 2 && ring.offset >= 2, JSON.stringify(ring));

  // Back to the heading, then pick 7 and confirm with the keyboard only
  await kbPage.locator('#rating-screen .rating-title').focus();
  for (let i = 0; i < 7; i++) await kbPage.keyboard.press('Tab');
  check('Tab 7 times from the heading lands on score 7', (await focused()) === 'button:7', await focused());
  await kbPage.keyboard.press('Space');
  check('Space selects the score and exposes it as pressed', (await kbPage.getByRole('button', { name: '7', exact: true }).getAttribute('aria-pressed')) === 'true');
  await scan(kbPage, 'rating screen with a score selected');
  for (let i = 0; i < 4; i++) await kbPage.keyboard.press('Tab');
  check('three more Tabs and one more reach Confirm', (await focused()) === 'button:Confirm', await focused());
  await kbPage.keyboard.press('Enter');
  await kbPage.waitForFunction(old => document.querySelector('#rating-screen .rating-step')?.textContent !== old, firstLabel);
  const nextTitle = await kbPage.locator('#rating-screen .rating-title').textContent();
  check('Confirm by keyboard moves on and puts focus on the new film title heading', (await focused()) === `h1:${nextTitle}`, await focused());

  await kbPage.keyboard.press('Shift+Tab');
  await kbPage.keyboard.press('Enter'); // wherever focus lands first, Enter must not break the page
  check('the page is still usable after stray keys', await kbPage.locator('#rating-screen, #results-screen').first().isVisible());
  await keyboard.close();

  if (report.length > 0) {
    console.log('\nViolations:');
    report.forEach(line => console.log(`  ${line}`));
  }
  check('no uncaught errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('accessibility run finished without an exception', false, error.message);
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
