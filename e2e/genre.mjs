// Genre mode at phone size: Pick a genre, then Comedy, then Taster. Skipping, rating, a refresh,
// Back, comedy-only results with no co-watch, and "Rate 5 more" staying in comedy. Also the genre
// chips, the sticky Get started band, and a friend's link hiding the General / Pick a genre question.
import path from 'node:path';
import { chromium } from 'playwright';
import { shots, startServer, createRecorder } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function person() {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
  await page.goto(server.base);
  await page.waitForSelector('.genre-chip input', { state: 'attached' });
  return { context, page };
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4') || 'null'));
const label = page => page.locator('#rating-screen .rating-step').textContent();
const title = page => page.locator('#rating-screen .rating-title').innerText();
const status = page => page.locator('#length-status').innerText();
async function rate(page, score) {
  await page.waitForSelector('#rating-screen .rating-widget');
  await page.getByRole('button', { name: String(score), exact: true }).click();
  await page.click('.confirm-score');
}
// Every catalog id in the list carries the comedy genre.
const allComedy = (page, ids) => page.evaluate(async list => {
  const catalog = await (await fetch('../data/catalog.json')).json();
  const byId = new Map(catalog.map(movie => [movie.id, movie]));
  return list.length > 0 && list.every(id => (byId.get(id).genres || []).includes('comedy'));
}, ids);
const resultIds = page => page.evaluate(() => [...new Set([...document.querySelectorAll('#results-screen a[href^="#/movie/"]')]
  .map(link => `http://www.wikidata.org/entity/${link.getAttribute('href').split('/').pop()}`))]);

try {
  // ---- The landing choice
  const a = await person();
  await a.page.locator('.length-card:has(input[value="genre"])').click();
  check('Pick a genre shows the genre chips and the length cards, and asks for a genre',
    await a.page.locator('#genre-choice').isVisible() && await a.page.locator('#length-choice').isVisible()
      && (await status(a.page)) === 'Choose a genre' && await a.page.locator('#start-button').isDisabled());
  const chips = await a.page.evaluate(async () => {
    const { availableGenres } = await import('./genres.js');
    const { genreName } = await import('./format.js');
    const catalog = await (await fetch('../data/catalog.json')).json();
    const expected = availableGenres(catalog).map(entry => genreName(entry.label));
    const shown = [...document.querySelectorAll('.genre-chip')].map(chip => {
      const text = chip.querySelector('span');
      const lines = Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight));
      return { name: text.textContent, lines, fits: chip.scrollWidth <= chip.clientWidth, height: chip.getBoundingClientRect().height };
    });
    return { expected, shown };
  });
  check('the chips are the offered genres, largest first', chips.shown.map(chip => chip.name).join('|') === chips.expected.join('|'), chips.expected.join(', '));
  check('every chip label, including Biographical and Rom-com, sits on one line and fits its chip at 375px',
    chips.shown.every(chip => chip.lines === 1 && chip.fits) && chips.shown.some(chip => chip.name === 'Biographical') && chips.shown.some(chip => chip.name === 'Rom-com'),
    JSON.stringify(chips.shown.filter(chip => chip.lines !== 1 || !chip.fits)));
  check('every chip is at least 44px tall', chips.shown.every(chip => chip.height >= 44));
  check('the genre choice is a radio group with a legend', (await a.page.locator('#genre-choice > legend').innerText()) === 'Which genre?'
    && (await a.page.locator('#genre-choice input[type="radio"][name="genre"]').count()) === chips.shown.length);

  // The sticky band: stuck while the grid is on screen, clear of anything focused with Tab.
  await a.page.evaluate(() => document.getElementById('genre-choice').scrollIntoView({ block: 'start' }));
  await a.page.waitForFunction(() => document.getElementById('start-zone').classList.contains('is-sticky'));
  const stuck = await a.page.evaluate(() => {
    const band = document.getElementById('start-zone').getBoundingClientRect();
    return { bottom: Math.round(band.bottom), height: innerHeight, padding: parseFloat(getComputedStyle(document.getElementById('start-zone')).paddingBottom) };
  });
  check('with the grid on screen, Get started sticks to the bottom of the window, with room below it', Math.abs(stuck.bottom - stuck.height) <= 1 && stuck.padding >= 12, JSON.stringify(stuck));
  await a.page.locator('.length-card:has(input[value="genre"])').focus();
  const covered = [];
  let stuckSteps = 0;
  for (let i = 0; i < chips.shown.length + 1; i++) {
    await a.page.keyboard.press(i === 0 ? 'Tab' : 'ArrowRight');
    const hidden = await a.page.evaluate(() => {
      const zone = document.getElementById('start-zone');
      const focusedChip = document.activeElement.closest('label');
      if (!focusedChip || !zone.classList.contains('is-sticky')) return { stuck: false };
      const chip = focusedChip.getBoundingClientRect();
      return { stuck: true, name: chip.bottom > zone.getBoundingClientRect().top + 0.5 || chip.top < 0 ? focusedChip.textContent : null };
    });
    if (hidden.stuck) stuckSteps++;
    if (hidden.name) covered.push(hidden.name);
  }
  check('moving through every chip with the keyboard, the stuck band never covers the focused chip',
    covered.length === 0 && stuckSteps >= chips.shown.length / 2, `${covered.join(', ')} (band stuck for ${stuckSteps} of ${chips.shown.length} chips)`);
  await a.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await a.page.waitForFunction(() => !document.getElementById('start-zone').classList.contains('is-sticky'));
  const apart = await a.page.evaluate(() => {
    const band = document.getElementById('start-zone').getBoundingClientRect();
    const footer = document.querySelector('.landing-footer').getBoundingClientRect();
    return band.bottom <= footer.top;
  });
  check('with the grid off screen the band is back in place and never overlaps the footer', apart);
  await a.page.locator('.length-card:has(input[value="general"])').click();
  check('switching to General hides the chips and the band stops sticking',
    await a.page.locator('#genre-choice').isHidden() && !(await a.page.locator('#start-zone').evaluate(node => node.classList.contains('is-sticky'))));

  // ---- Pick a genre, Comedy, Taster
  await a.page.locator('.length-card:has(input[value="genre"])').click();
  await a.page.locator('.genre-chip:has(input[value="comedy"])').click();
  check('with Comedy chosen the status asks for a length', (await status(a.page)) === 'Choose a length to begin' && await a.page.locator('#start-button').isDisabled());
  await a.page.locator('.length-card:has(input[value="5"])').click();
  await a.page.waitForSelector('#start-button:not([disabled])');
  await a.page.screenshot({ path: path.join(shots, 'genre-landing-375.png'), fullPage: true });
  await a.page.click('#start-button');
  await a.page.waitForSelector('#rating-screen .rating-widget');
  check('the first step reads "Comedy · 1 / 5"', (await label(a.page)) === 'Comedy · 1 / 5', await label(a.page));
  const state = await saved(a.page);
  check('the session is saved as genre mode, comedy, Taster', state.mode === 'genre' && state.genre === 'comedy' && state.length === 5);

  await a.page.getByRole('button', { name: "Haven't seen it" }).click();
  check('"Haven\'t seen it" moves to the next film without counting it', (await label(a.page)) === 'Comedy · 1 / 5');
  await rate(a.page, 9);
  await rate(a.page, 3);
  const before = { label: await label(a.page), title: await title(a.page) };
  await a.page.reload();
  await a.page.waitForSelector('#rating-screen .rating-widget');
  check('a refresh mid-session resumes on the same film and count', (await label(a.page)) === before.label && (await title(a.page)) === before.title && before.label === 'Comedy · 3 / 5', before.label);
  const ratedSecond = (await saved(a.page)).trail.at(-2);
  await a.page.click('.back-button');
  check('Back returns to the film just rated, with its score selected and its place in the count',
    (await label(a.page)) === 'Comedy · 2 / 5' && (await a.page.locator('.rating-widget button.selected').innerText()) === '3' && (await saved(a.page)).trail.at(-1) === ratedSecond);
  await a.page.click('.confirm-score');
  check('confirming it again carries on from the next film not yet answered', (await label(a.page)) === 'Comedy · 3 / 5' && (await title(a.page)) === before.title);

  // Home and Continue describe the session.
  await a.page.locator('.home-button').click();
  await a.page.getByRole('button', { name: 'Go home' }).click();
  await a.page.waitForSelector('#landing-screen', { state: 'visible' });
  check('Continue describes the session as "Continue comedy, 3 of 5"', (await a.page.locator('#continue-button').innerText()) === 'Continue comedy, 3 of 5', await a.page.locator('#continue-button').innerText());
  check('the landing choice is empty again after going home', (await a.page.locator('#landing-screen input:checked').count()) === 0);
  await a.page.click('#continue-button');
  for (const score of [8, 2, 10]) await rate(a.page, score);
  await a.page.waitForSelector('.top-pick');

  // ---- Comedy results
  const savedState = await saved(a.page);
  check('five comedies were rated and one skipped', savedState.ratings.length === 5 && savedState.skipped.length === 1);
  check('every rated film is a comedy', await allComedy(a.page, savedState.ratings.map(([id]) => id)));
  const ids = await resultIds(a.page);
  check('every result carries the comedy genre', ids.length >= 10 && await allComedy(a.page, ids), `${ids.length} films`);
  check('no rated film is in the results', ids.every(id => !savedState.ratings.some(([rated]) => rated === id)));
  check('the heading and the "based on" line name the genre',
    (await a.page.locator('.top-picks h2').innerText()) === 'Your comedy picks'
      && (await a.page.locator('.results-basis').innerText()) === 'These comedy picks are based on the 5 films you rated.');
  check('there is no co-watch banner, invite or sample friend in genre mode',
    (await a.page.locator('#cowatch-share, .cowatch-toggle, .cowatch-sample, .cowatch-to-combined').count()) === 0);
  check('top picks still carry their "why" lines', (await a.page.locator('.top-pick-why').count()) === 5);
  await a.page.screenshot({ path: path.join(shots, 'genre-results-375.png'), fullPage: true });

  // ---- Rate 5 more stays in comedy
  await a.page.getByRole('button', { name: 'Rate 5 more', exact: true }).click();
  const extraIds = [];
  for (const score of [7, 2, 9, 4, 8]) {
    await a.page.waitForSelector('#rating-screen .rating-widget');
    extraIds.push((await saved(a.page)).extra.shown.at(-1));
    await rate(a.page, score);
  }
  await a.page.waitForSelector('.top-pick');
  check('"Rate 5 more" only suggests comedies', extraIds.length === 5 && await allComedy(a.page, extraIds));
  const after = await resultIds(a.page);
  check('the results after rating more are still all comedies', await allComedy(a.page, after) && (await a.page.locator('.results-basis').innerText()).includes('10 films'));
  await a.context.close();

  // ---- A friend's link hides the General / Pick a genre question
  const b = await person();
  const link = await b.page.evaluate(async () => {
    const { encodeTaste, shareLink } = await import('./cowatch.js');
    const catalog = await (await fetch('../data/catalog.json')).json();
    const ratings = catalog.slice(0, 6).map((movie, i) => ({ id: movie.id, score: [9, 2, 8, 3, 10, 4][i] }));
    return shareLink(location.href, encodeTaste(ratings));
  });
  await b.page.goto(link);
  await b.page.waitForSelector('.friend-banner');
  check('on a friend\'s link the General / Pick a genre question is hidden and the lengths are offered',
    await b.page.locator('#mode-choice').isHidden() && await b.page.locator('#genre-choice').isHidden() && await b.page.locator('#length-choice').isVisible()
      && (await status(b.page)) === 'Choose a length to begin');
  await b.page.locator('.length-card:has(input[value="5"])').click();
  await b.page.click('#start-button');
  await b.page.waitForSelector('#rating-screen .rating-widget');
  const friendState = await saved(b.page);
  check('a session started from a friend\'s link is General, with the friend kept', friendState.mode === 'general' && friendState.friend !== null);
  await b.context.close();
} catch (error) {
  check('genre run finished without an exception', false, String(error.message).slice(0, 300));
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
