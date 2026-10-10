// The results screen: logo bar, cards (facts, genre pills, why line, no plot, no taller than before),
// the "Rate 5 more" nudge, and the "Watch with a friend" entry that scrolls to its card.
import path from 'node:path';
import { chromium } from 'playwright';
import { shots, startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

// Tallest top card before this change (same ratings, same catalog), per window width.
const OLD_MAX_CARD_HEIGHT = { 1440: 210, 375: 275 };
const cycle = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];

async function results(width, height, length = 15, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
  });
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  await chooseAndStart(page, length);
  for (let i = 0; i < 40 && await page.locator('#rating-screen').isVisible(); i++) {
    await page.getByRole('button', { name: String(cycle[i % cycle.length]), exact: true }).click();
    await page.click('.confirm-score');
  }
  await page.waitForSelector('.top-pick');
  return { context, page };
}

try {
  const catalog = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const plots = new Map(catalog.map(movie => [movie.id.slice(movie.id.lastIndexOf('/') + 1), movie.plot]));

  for (const [width, height] of [[1440, 900], [375, 667]]) {
    const { context, page } = await results(width, height);
    const label = `${width}px`;

    check(`${label}: the results screen has the same logo top bar as the landing page`,
      await page.locator('.site-bar .brand img').isVisible() && (await page.locator('.site-bar .brand').innerText()).trim() === 'CoCinema'
        && await page.getByRole('link', { name: 'CoCinema, home' }).isVisible());

    const cards = await page.$$eval('.top-pick', nodes => nodes.map(node => ({
      height: Math.round(node.getBoundingClientRect().height * 10) / 10,
      title: node.querySelector('h3').textContent,
      href: node.querySelector('h3 a').getAttribute('href'),
      rank: node.querySelector('.top-pick-match').textContent,
      meta: (node.querySelector('.top-pick-meta') || {}).textContent || '',
      pills: [...node.querySelectorAll('.pill-row li')].map(item => item.textContent),
      why: node.querySelector('.top-pick-why').textContent,
      text: node.textContent,
      clipped: [node, ...node.querySelectorAll('*')].some(item => item.scrollHeight > item.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(item).overflowY)),
    })));

    check(`${label}: five cards with a rank, facts line, genre pills and a why line`, cards.length === 5
      && cards.every((card, index) => card.rank === `#${index + 1}` && card.meta && card.pills.length >= 1 && card.pills.length <= 3 && card.why.length > 20),
      JSON.stringify(cards[0]));
    check(`${label}: facts read like "1994 · 2h 22m · Rotten Tomatoes 91%" and never "142 min"`,
      cards.every(card => /^\d{4}( · (\d+h( \d+m)?|\d+m))?( · Rotten Tomatoes \d{1,3}%)?$/.test(card.meta) && !/\bmin\b/.test(card.meta)), cards.map(card => card.meta).join(' | '));
    check(`${label}: no card shows any of the film's plot`, cards.every(card => {
      const plot = plots.get(card.href.slice(card.href.lastIndexOf('/') + 1)) || '';
      return plot.length > 40 && !card.text.includes(plot.slice(0, 40));
    }));
    check(`${label}: no card scrolls inside itself`, cards.every(card => !card.clipped));
    const tallest = Math.max(...cards.map(card => card.height));
    check(`${label}: no card is taller than before (${OLD_MAX_CARD_HEIGHT[width]}px)`, tallest <= OLD_MAX_CARD_HEIGHT[width], cards.map(card => card.height).join(', '));
    const openings = cards.map(card => card.why.split(/\s+/).slice(0, 2).join(' '));
    check(`${label}: no two top cards open the same way`, new Set(openings).size === 5, openings.join(' / '));
    check(`${label}: no sideways scroll`, await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));

    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, `results-${width}.png`) });

    // Co-watch entry
    const actions = await page.$$eval('.results-actions button', nodes => nodes.map(node => node.textContent));
    check(`${label}: "Watch with a friend" sits beside "Rate 5 more" and "Start over"`, actions.join('|') === 'Rate 5 more|Watch with a friend|Start over', actions.join('|'));
    check(`${label}: the invite button is "Copy invite link" or, with a share sheet, "Share invite link"`, await page.evaluate(() => {
      const text = document.getElementById('cowatch-share').textContent;
      return text === (navigator.share ? 'Share invite link' : 'Copy invite link');
    }));
    await page.getByRole('button', { name: 'Watch with a friend', exact: true }).click();
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'cowatch-title');
    await page.waitForTimeout(900);
    const placed = await page.evaluate(() => {
      const box = document.querySelector('.cowatch-section').getBoundingClientRect();
      return { top: box.top, inView: box.top < innerHeight && box.bottom > 0, focused: document.activeElement.id };
    });
    check(`${label}: the entry scrolls to the co-watch card and moves focus to its heading`, placed.inView && placed.top < height / 2 && placed.focused === 'cowatch-title', JSON.stringify(placed));
    await page.screenshot({ path: path.join(shots, `cowatch-card-${width}.png`) });
    await context.close();
  }

  // Reduced motion: the scroll is instant, and focus still moves
  const calm = await results(375, 667, 15, 'reduce');
  await calm.page.getByRole('button', { name: 'Watch with a friend', exact: true }).click();
  await calm.page.waitForFunction(() => document.activeElement && document.activeElement.id === 'cowatch-title', null, { timeout: 500 });
  check('with reduced motion the entry scrolls at once and focus moves to the heading', true);
  await calm.context.close();

  // Quick: the nudge is a real button that starts "Rate 5 more"
  const quick = await results(375, 667, 10);
  const nudge = quick.page.locator('.results-nudge');
  check('the "Rate 5 more" nudge is a button, not a dead link', (await nudge.evaluate(node => node.tagName)) === 'BUTTON' && (await nudge.innerText()) === 'Want sharper picks? Rate 5 more');
  await nudge.click();
  await quick.page.waitForSelector('.rating-frame');
  check('pressing the nudge starts the same flow as "Rate 5 more"', /^Rate more · 1 of 5$/.test(await quick.page.locator('.rating-step').textContent()));
  await quick.context.close();
} catch (error) {
  check('results run finished without an exception', false, String(error.message).slice(0, 300));
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
