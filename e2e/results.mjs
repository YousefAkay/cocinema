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
      return !card.text.includes(plot.slice(0, 40));
    }));
    check(`${label}: no card scrolls inside itself`, cards.every(card => !card.clipped));
    const tallest = Math.max(...cards.map(card => card.height));
    check(`${label}: no card is taller than before (${OLD_MAX_CARD_HEIGHT[width]}px)`, tallest <= OLD_MAX_CARD_HEIGHT[width], cards.map(card => card.height).join(', '));
    check(`${label}: no why line is cut short with these ratings`, await page.$$eval('.top-pick-why', nodes => nodes.every(node => node.scrollHeight <= node.clientHeight + 1)));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, `results-${width}.png`) });
    // The worst case: very long film names in the why line must not make a card taller than before.
    const worst = await page.evaluate(() => {
      const long = 'Because you gave The Lord of the Rings: The Fellowship of the Ring a 10, Harry Potter and the Chamber of Secrets a 9 and Pirates of the Caribbean: The Curse of the Black Pearl a 9, this one rose up your list. Your 2 for Indiana Jones and the Kingdom of the Crystal Skull held it back a little.';
      const card = document.querySelector('.top-pick');
      card.querySelector('h3 a').textContent = 'Pirates of the Caribbean: Dead Mans Chest and Other Long Names';
      card.querySelector('.top-pick-why').textContent = long;
      return Math.round(card.getBoundingClientRect().height);
    });
    check(`${label}: even a very long why line and title keep a card within the old height`, worst <= OLD_MAX_CARD_HEIGHT[width], String(worst));
    const openings = cards.map(card => card.why.split(/\s+/).slice(0, 2).join(' '));
    check(`${label}: no two top cards open the same way`, new Set(openings).size === 5, openings.join(' / '));
    check(`${label}: no sideways scroll`, await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));


    // The Watch with a friend banner
    const actions = await page.$$eval('.results-actions button', nodes => nodes.map(node => node.textContent));
    check(`${label}: "Rate 5 more" and "Start over" sit together in their own row`, actions.join('|') === 'Rate 5 more|Start over', actions.join('|'));
    check(`${label}: there is no separate "Watch with a friend" button or card at the bottom`, (await page.getByRole('button', { name: 'Watch with a friend', exact: true }).count()) === 0 && (await page.locator('.cowatch-section').count()) === 0);
    const place = await page.evaluate(() => {
      const banner = document.querySelector('.cowatch-banner').getBoundingClientRect();
      const heading = document.querySelector('.top-picks h2').getBoundingClientRect();
      const card = document.querySelector('.top-pick').getBoundingClientRect();
      const header = document.querySelector('.site-bar').getBoundingClientRect();
      return { bannerTop: Math.round(banner.top), bannerBottom: Math.round(banner.bottom), headingTop: Math.round(heading.top), cardTop: Math.round(card.top), cardBottom: Math.round(card.bottom), headerBottom: Math.round(header.bottom), innerHeight };
    });
    check(`${label}: the banner is directly under the header and above "Your top picks"`, place.bannerTop >= place.headerBottom && place.bannerTop - place.headerBottom < 40 && place.bannerBottom <= place.headingTop, JSON.stringify(place));
    check(`${label}: the first top pick is still fully on screen (top ${place.cardTop}, bottom ${place.cardBottom})`, place.cardBottom <= place.innerHeight);
    console.log(`   first card top: ${place.cardTop}px`);
    check(`${label}: the banner is compact (${Math.round(place.bannerBottom - place.bannerTop)}px)`, place.bannerBottom - place.bannerTop <= (width === 1440 ? 110 : 150));
    check(`${label}: the invite button is "Copy invite link" or, with a share sheet, "Share invite link"`, await page.evaluate(() => {
      const text = document.getElementById('cowatch-share').textContent;
      return text === (navigator.share ? 'Share invite link' : 'Copy invite link');
    }));
    check(`${label}: the privacy line is visible in the banner`, /never sent to a server\. Anyone who has the link can see them\./.test(await page.locator('.cowatch-banner .cowatch-privacy').innerText()) && await page.locator('.cowatch-privacy').isVisible());

    // Keyboard: the invite button is the first thing after the logo link
    await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
    await page.locator('.site-bar .brand').focus();
    await page.keyboard.press('Tab');
    check(`${label}: Tab from the logo link reaches the invite button`, await page.evaluate(() => document.activeElement.id === 'cowatch-share'));
    await page.keyboard.press('Tab');
    check(`${label}: then the "Try a sample friend" control`, await page.evaluate(() => document.activeElement.classList.contains('cowatch-toggle')));

    // Share: the button does the sharing itself and confirms it
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.evaluate(() => { if (navigator.share) navigator.share = async () => {}; });
    await page.click('#cowatch-share');
    await page.waitForFunction(() => document.getElementById('cowatch-status').textContent.length > 0);
    const confirmation = await page.locator('#cowatch-status').innerText();
    check(`${label}: the share button confirms what it did`, /^(Link shared\.|Link copied\. Send it to your friend\.)$/.test(confirmation), confirmation);
    await page.screenshot({ path: path.join(shots, `cowatch-banner-${width}.png`) });

    // Sample friends: collapsed, then open inline, clearly labelled
    check(`${label}: the sample friends start collapsed`, await page.locator('#cowatch-samples').isHidden());
    await page.click('.cowatch-toggle');
    check(`${label}: "Try a sample friend" opens three labelled sample options inline`, (await page.locator('.cowatch-sample').allInnerTexts()).join('|') === 'Horror fan (sample)|Romance fan (sample)|Sci-fi fan (sample)'
      && (await page.locator('.cowatch-toggle').getAttribute('aria-expanded')) === 'true' && /not real people/.test(await page.locator('#cowatch-samples').innerText()));
    check(`${label}: no sideways scroll with the samples open`, await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Horror fan (sample)' }).click();
    await page.waitForSelector('.combined');
    check(`${label}: a sample friend leads to the shared list`, (await page.locator('.combined-card').count()) === 10 && /Horror fan \(sample\)/.test(await page.locator('.combined-figures').first().innerText()));
    await context.close();
  }

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
