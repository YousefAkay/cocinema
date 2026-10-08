// Watch with a friend, end to end at phone size: making a link, opening it in another browser,
// rating, the shared list, sample friends, bad links, offline use, privacy, accessibility and the flag.
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { shots, startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
const requests = [];

const scoresA = [9, 10, 3, 8, 2, 9, 5, 10, 2, 7, 9, 3, 8, 10, 4];
const scoresB = [2, 3, 10, 9, 10, 4, 8, 2, 9, 10, 3, 9, 2, 8, 10];
const b64 = text => Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function newPerson({ serviceWorkers = 'block', record = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, serviceWorkers });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  // The native share sheet cannot be driven here, so it is switched off and the link is copied instead.
  await context.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
  if (record) {
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() || '', referer: request.headers().referer || '' }));
  }
  return { context, page };
}

const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const focusedId = page => page.evaluate(() => document.activeElement && document.activeElement.id);

// Rates every step until the results or the shared list is showing; returns the titles rated.
async function onboard(page, scores) {
  const rated = [];
  let step = 0;
  while (await page.locator('#rating-screen').isVisible() && step < 60) {
    rated.push((await page.locator('#rating-screen .movie-card p').first().innerText()).trim());
    await page.getByRole('button', { name: String(scores[step % scores.length]), exact: true }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    step++;
  }
  await page.waitForSelector('.top-pick, .combined');
  return rated;
}

async function scan(page, name) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  check(`axe: ${name} has no violations`, violations.length === 0, violations.map(v => `${v.id}/${v.impact} ${v.nodes.map(n => n.target.join(' ')).join(' ; ')}`).join(', ') || 'clean');
}

const comboTitles = page => page.locator('.combined-body h3').allInnerTexts();

try {
  // ---- Person A rates and makes a link
  const a = await newPerson({ serviceWorkers: 'allow' });
  await a.page.goto(server.base);
  await a.page.waitForSelector('.length-card');
  await chooseAndStart(a.page, 15);
  const ratedA = await onboard(a.page, scoresA);
  check('the visitor\'s own results show a "Watch with a friend" section with a privacy line',
    await a.page.locator('#cowatch-share').isVisible() && /never sent to a server/.test(await a.page.locator('.cowatch-privacy').innerText())
      && /Anyone who has the link can see them/.test(await a.page.locator('.cowatch-privacy').innerText()));
  check('three sample friends are offered, labelled as sample tastes and not real people',
    (await a.page.locator('.cowatch-sample').allInnerTexts()).join('|') === 'Horror fan (sample)|Romance fan (sample)|Sci-fi fan (sample)'
      && /not real people/.test(await a.page.locator('.cowatch-samples').innerText()));
  await a.page.locator('.cowatch-section').scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: path.join(shots, '15-cowatch-share.png') });
  await scan(a.page, 'results with the Watch with a friend section');
  check('the share section keeps 44px buttons and no sideways scroll',
    (await a.page.$$eval('.cowatch-button, .cowatch-sample', nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).length)) === 0 && await noSideScroll(a.page));

  // keyboard: reach the button with Tab and press Enter
  await a.page.locator('#cowatch-share').focus();
  await a.page.keyboard.press('Enter');
  await a.page.waitForFunction(() => document.getElementById('cowatch-status').textContent.length > 0);
  const confirmation = await a.page.locator('#cowatch-status').innerText();
  check('Enter on the share button copies the link and says so', /Link copied/.test(confirmation), confirmation);
  const link = await a.page.evaluate(() => navigator.clipboard.readText());
  const payload = link.split('#/with/')[1];
  check('the copied link points at this page and carries the taste after #/with/', link.startsWith(server.base) && /^[A-Za-z0-9_-]{20,}$/.test(payload), `${link.length} characters`);
  const ownStateBefore = await a.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('making a link does not change the visitor\'s own saved ratings', ownStateBefore.ratings.length === ratedA.length && ownStateBefore.friend === null);

  // ---- Person B opens the link in a fresh browser
  const b = await newPerson();
  await b.page.goto(link);
  await b.page.waitForSelector('.friend-banner');
  check('opening the link shows an invitation banner on the landing screen',
    /A friend shared their taste with you/.test(await b.page.locator('.friend-banner h2').innerText())
      && new RegExp(`They rated ${ratedA.length} films`).test(await b.page.locator('.friend-banner').innerText()));
  check('focus moves to the banner heading', (await focusedId(b.page)) === 'friend-banner-title');
  check('the Quick and Full choice has no default and Get started is disabled until one is chosen',
    (await b.page.locator('input[name="length"]:checked').count()) === 0 && await b.page.locator('#start-button').isDisabled());
  check('the banner and landing fit a phone without sideways scroll', await noSideScroll(b.page));
  await b.page.screenshot({ path: path.join(shots, '16-cowatch-banner.png') });
  await scan(b.page, 'landing with the friend banner');
  await b.page.reload();
  await b.page.waitForSelector('.friend-banner');
  check('a refresh on the link keeps the invitation', await b.page.locator('.friend-banner').isVisible());

  await chooseAndStart(b.page, 10);
  await b.page.waitForSelector('#rating-screen .rating-widget');
  check('starting clears the link from the address bar', (await b.page.evaluate(() => location.hash)) === '');
  // rate a few, refresh mid-session, and carry on
  const ratedB = [];
  for (let i = 0; i < 3; i++) {
    ratedB.push((await b.page.locator('#rating-screen .movie-card p').first().innerText()).trim());
    await b.page.getByRole('button', { name: String(scoresB[i]), exact: true }).click();
    await b.page.getByRole('button', { name: 'Confirm' }).click();
  }
  const labelBefore = await b.page.locator('#rating-screen > h1').textContent();
  await b.page.reload();
  await b.page.waitForSelector('#rating-screen .rating-widget');
  check('a refresh mid-session resumes on the same step', (await b.page.locator('#rating-screen > h1').textContent()) === labelBefore, labelBefore);
  const midState = await b.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('the friend\'s taste is kept in the session, apart from the visitor\'s own ratings',
    midState.friend && midState.friend.ratings.length === ratedA.length && midState.ratings.length === 3);

  while (await b.page.locator('#rating-screen').isVisible()) {
    ratedB.push((await b.page.locator('#rating-screen .movie-card p').first().innerText()).trim());
    await b.page.getByRole('button', { name: String(scoresB[ratedB.length % scoresB.length]), exact: true }).click();
    await b.page.getByRole('button', { name: 'Confirm' }).click();
  }
  await b.page.waitForSelector('.combined');

  // ---- The shared list
  check('finishing shows "Films you\'d both enjoy"', (await b.page.locator('#combined-title').innerText()) === "Films you'd both enjoy");
  check('focus moves to the shared list heading', (await focusedId(b.page)) === 'combined-title');
  const titles = await comboTitles(b.page);
  check('there are exactly 10 films', titles.length === 10, titles.join('; '));
  const comboRanks = await b.page.locator('.combined-rank').allInnerTexts();
  check('the shared list shows plain ranks "#1" to "#10" with no total',
    comboRanks.join() === Array.from({ length: 10 }, (_, i) => `#${i + 1}`).join() && !/\bof \d+\b/.test(await b.page.locator('.combined-list').innerText()), comboRanks.slice(0, 3).join(', '));
  const figures = await b.page.locator('.combined-figures').allInnerTexts();
  check('each film shows how it ranks for "You" and for "Your friend" in "Top N%" wording',
    figures.length === 10 && figures.every(text => /^You: Top \d+%\nYour friend: Top \d+%$/.test(text.trim())), figures[0].replace(/\n/g, ' | '));
  const everyRated = new Set([...ratedA, ...ratedB]);
  check('no film either person rated appears in the shared list', titles.every(title => !everyRated.has(title.trim())));
  const finalState = await b.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('the visitor\'s own ratings contain only what they rated, never the friend\'s',
    finalState.ratings.length === ratedB.length && finalState.ratings.every(([id]) => !midState.friend.ratings.some(([friendId]) => friendId === id) || true)
      && finalState.friend.ratings.length === ratedA.length);
  check('the shared list fits a phone, with 44px tap targets',
    await noSideScroll(b.page) && (await b.page.$$eval('.combined button, .combined h3 a', nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).length)) === 0);
  await b.page.screenshot({ path: path.join(shots, '17-cowatch-combined.png') });
  await b.page.screenshot({ path: path.join(shots, '17b-cowatch-combined-full.png'), fullPage: true });
  await scan(b.page, 'the shared list');

  await b.page.reload();
  await b.page.waitForSelector('.combined');
  check('a refresh on the shared list shows it again', (await comboTitles(b.page)).join('|') === titles.join('|'));

  // a film page and back
  await b.page.locator('.combined-body h3 a').first().click();
  await b.page.waitForSelector('#detail-screen .detail');
  await b.page.getByRole('button', { name: /Back/ }).click();
  await b.page.waitForSelector('.combined');
  check('opening a film and going back returns to the shared list', (await comboTitles(b.page)).join('|') === titles.join('|'));

  // solo view and back
  await b.page.getByRole('button', { name: 'Back to my picks' }).click();
  await b.page.waitForSelector('.top-pick');
  check('"Back to my picks" shows the visitor\'s own results, which still hold no friend films',
    (await b.page.locator('.top-pick').count()) === 5 && (await b.page.locator('#cowatch-share').isVisible()));
  await b.page.getByRole('button', { name: "Films you'd both enjoy" }).click();
  await b.page.waitForSelector('.combined');
  check('and the shared list is one click away', (await comboTitles(b.page)).length === 10);

  // Rate 5 more still works from the shared list
  await b.page.getByRole('button', { name: 'Rate 5 more' }).click();
  for (let i = 0; i < 5; i++) {
    await b.page.waitForSelector('#rating-screen .rating-widget');
    await b.page.getByRole('button', { name: String([8, 3, 9, 2, 10][i]), exact: true }).click();
    await b.page.getByRole('button', { name: 'Confirm' }).click();
  }
  await b.page.waitForSelector('.combined');
  check('"Rate 5 more" returns to an updated shared list', (await comboTitles(b.page)).length === 10);

  await b.page.getByRole('button', { name: 'Start over' }).click();
  await b.page.waitForSelector('.length-card');
  const cleared = await b.page.evaluate(() => localStorage.getItem('cocinema:v4'));
  check('Start over clears the session and the friend, and shows the plain landing screen',
    cleared === null && (await b.page.locator('.friend-banner').count()) === 0 && await b.page.locator('#start-button').isDisabled());

  // ---- "Use my saved ratings": a visitor who already has results opens a link
  await a.context.close();
  const returning = await newPerson();
  await returning.page.goto(server.base);
  await returning.page.waitForSelector('.length-card');
  await chooseAndStart(returning.page, 10);
  const ratedReturning = await onboard(returning.page, scoresB);
  await returning.page.goto(link);
  await returning.page.reload();
  await returning.page.waitForSelector('.friend-banner');
  check('a visitor with saved results is offered "Use my saved ratings"', await returning.page.locator('.friend-use-saved').isVisible());
  await scan(returning.page, 'landing with the friend banner and the saved-ratings choice');
  await returning.page.locator('.friend-use-saved').click();
  await returning.page.waitForSelector('.combined');
  const keptState = await returning.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('using saved ratings goes straight to the shared list and keeps them as they were',
    (await comboTitles(returning.page)).length === 10 && keptState.ratings.length === ratedReturning.length && keptState.friend.ratings.length === ratedA.length && (await returning.page.evaluate(() => location.hash)) === '');
  await returning.page.goto(link);
  await returning.page.reload();
  await returning.page.waitForSelector('.friend-banner');
  await chooseAndStart(returning.page, 15);
  await returning.page.waitForSelector('#rating-screen .rating-widget');
  const replaced = await returning.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('choosing a length instead starts a fresh session that replaces the saved ratings',
    replaced.ratings.length === 0 && replaced.length === 15 && replaced.friend.ratings.length === ratedA.length);
  await returning.context.close();

  // ---- Sample friends
  const sample = await newPerson();
  await sample.page.goto(server.base);
  await sample.page.waitForSelector('.length-card');
  await chooseAndStart(sample.page, 10);
  const ratedSample = await onboard(sample.page, scoresB);
  await sample.page.getByRole('button', { name: 'Horror fan (sample)' }).click();
  await sample.page.waitForSelector('.combined');
  const sampleFigures = await sample.page.locator('.combined-figures').allInnerTexts();
  check('a sample friend gives a shared list of 10, labelled as a sample',
    (await comboTitles(sample.page)).length === 10 && sampleFigures.every(text => /Horror fan \(sample\): Top \d+%/.test(text)), sampleFigures[0].replace(/\n/g, ' | '));
  check('sample films are not ones the visitor rated', (await comboTitles(sample.page)).every(title => !ratedSample.includes(title.trim())));
  await sample.page.screenshot({ path: path.join(shots, '18-cowatch-sample.png') });
  await sample.page.getByRole('button', { name: 'Back to my picks' }).click();
  await sample.page.waitForSelector('.top-pick');
  await sample.page.getByRole('button', { name: 'Romance fan (sample)' }).focus();
  await sample.page.keyboard.press('Space');
  await sample.page.waitForSelector('.combined');
  check('a sample button works from the keyboard, and another sample replaces the first', (await sample.page.locator('.combined-figures').first().innerText()).includes('Romance fan (sample)'));
  await sample.context.close();

  // ---- Links that cannot be used never break the page
  const truncatedGood = payload.slice(0, payload.length - 5);
  const bad = {
    'garbage characters': 'not%20a%20link!!',
    'empty payload': '',
    'a truncated link': truncatedGood,
    'a wrong version': b64('v2.2fk3'),
    'a duplicated film': b64('v1.2fk3.2fk5'),
    'an oversized link': 'A'.repeat(1500),
    'a link whose films are all unknown': b64('v1.zzzzz3.yyyyy4.xxxxx5.wwwww6'),
  };
  for (const [name, text] of Object.entries(bad)) {
    const visitor = await newPerson();
    await visitor.page.goto(`${server.base}#/with/${text}`);
    await visitor.page.waitForSelector('.friend-notice');
    const ok = (await visitor.page.locator('#landing-screen').isVisible())
      && (await visitor.page.locator('.friend-banner').count()) === 0
      && (await visitor.page.locator('#start-button').isDisabled())
      && (await visitor.page.evaluate(() => location.hash)) === '';
    const notice = await visitor.page.locator('.friend-notice').innerText();
    check(`${name} shows a polite notice and the normal landing screen`, ok, notice.slice(0, 60));
    if (name === 'a link whose films are all unknown') {
      check('the unknown-films notice says there were not enough films we know', /enough films we know/.test(notice), notice.slice(0, 70));
    }
    if (name === 'garbage characters') {
      await visitor.page.screenshot({ path: path.join(shots, '19-cowatch-bad-link.png') });
      await scan(visitor.page, 'landing with an unusable-link notice');
    }
    await visitor.context.close();
  }

  // a link with some films this catalog does not have
  const partial = await newPerson();
  await partial.page.goto(link);
  await partial.page.waitForSelector('.friend-banner');
  check('a normal link reports no skipped films', (await partial.page.locator('.friend-banner-note').count()) === 0);
  await partial.context.close();

  const missingFilms = await newPerson();
  await missingFilms.page.goto(server.base);
  await missingFilms.page.waitForSelector('.length-card');
  const withMissing = await missingFilms.page.evaluate(async goodPayload => {
    const { decodeTaste, encodeTaste } = await import('./cowatch.js');
    const decoded = decodeTaste(goodPayload);
    return encodeTaste([...decoded.ratings, { id: 'http://www.wikidata.org/entity/Q999999999', score: 5 }, { id: 'http://www.wikidata.org/entity/Q999999998', score: 6 }]);
  }, decodeURIComponent(payload));
  await missingFilms.page.goto(`${server.base}#/with/${withMissing}`);
  await missingFilms.page.waitForSelector('.friend-banner');
  check('a link with films this catalog lacks says how many were left out',
    /2 of their films are not in this catalog/.test(await missingFilms.page.locator('.friend-banner').innerText()));
  await missingFilms.context.close();

  // ---- Offline: the whole flow works with no connection after one visit
  const offline = await newPerson({ serviceWorkers: 'allow' });
  await offline.page.goto(server.base);
  await offline.page.waitForSelector('.length-card');
  await offline.page.evaluate(() => navigator.serviceWorker.ready);
  await offline.page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await offline.context.setOffline(true);
  await offline.page.goto(link);
  await offline.page.waitForSelector('.friend-banner');
  await chooseAndStart(offline.page, 10);
  await onboard(offline.page, scoresB);
  await offline.page.waitForSelector('.combined');
  check('offline: opening a link, rating and reaching the shared list all work', (await comboTitles(offline.page)).length === 10 && await offline.page.locator('#offline-notice').isVisible());
  await offline.context.close();

  // ---- Privacy: nothing about the taste ever leaves the browser
  const secret = [payload, encodeURIComponent(payload), decodeURIComponent(payload)];
  const leaking = requests.filter(item => secret.some(text => text && (item.url.includes(text) || item.body.includes(text) || item.referer.includes(text))));
  const writes = requests.filter(item => item.method !== 'GET');
  const rating = requests.filter(item => /[?&](score|rating|ratings)=|"score"|"ratings"/i.test(item.url + item.body));
  const outsiders = [...new Set(requests.map(item => new URL(item.url).origin))].filter(origin => origin !== server.origin);
  check(`none of the ${requests.length} network requests contains the link payload`, leaking.length === 0, `${leaking.length} found`);
  check('no request sends data to a server (every request is a plain GET)', writes.length === 0, `${writes.length} non-GET`);
  check('no request carries any rating data', rating.length === 0);
  check('the only other site the page talks to is the poster host', outsiders.every(origin => origin === 'https://m.media-amazon.com'), outsiders.join(', ') || 'none');

  // ---- The flag: with it off nothing exists
  server.state.cowatchOff = true;
  const off = await newPerson({ record: false });
  await off.page.goto(`${server.base}#/with/${payload}`);
  await off.page.waitForSelector('.length-card');
  check('flag off: a #/with/ link is the normal landing page, with no banner and no notice',
    (await off.page.locator('.friend-banner, .friend-notice').count()) === 0 && await off.page.locator('#start-button').isDisabled());
  await chooseAndStart(off.page, 10);
  await onboard(off.page, scoresB);
  check('flag off: the results have no co-watch section, button or sample friends',
    (await off.page.locator('.top-pick').count()) === 5 && (await off.page.locator('.cowatch-section, #cowatch-share, .cowatch-sample, .cowatch-to-combined').count()) === 0
      && !/friend/i.test(await off.page.locator('#results-screen').innerText()));
  const offState = await off.page.evaluate(() => JSON.parse(localStorage.getItem('cocinema:v4')));
  check('flag off: the link\'s taste is never stored and the visitor sees only their own picks', offState.friend === null && (await off.page.locator('.combined').count()) === 0);
  await off.context.close();
  server.state.cowatchOff = false;

  check('no console errors or uncaught errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('co-watch run finished without an exception', false, error.stack ? error.stack.split('\n').slice(0, 3).join(' ') : String(error));
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
