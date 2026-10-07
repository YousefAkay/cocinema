// The landing page: layout on first screen, fonts without any request to Google, the poster strip,
// numbers read from the data, reduced motion, the error state, and screenshots.
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { shots, startServer, createRecorder } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function open({ width, height, reducedMotion = 'no-preference', blockPosters = false, isMobile = false }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion, isMobile, hasTouch: isMobile, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(message.text());
  });
  if (blockPosters) await page.route('**/m.media-amazon.com/**', route => route.abort());
  await page.goto(server.base);
  await page.waitForSelector('#start-button');
  await page.waitForFunction(() => document.querySelector('[data-fill="films"]').textContent !== '–' && document.querySelector('[data-fill="films"]').textContent !== 'many');
  return { context, page, requests };
}

const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const box = (page, selector) => page.locator(selector).first().boundingBox();

try {
  // ---- Phone: 375x667
  const phone = await open({ width: 375, height: 667, isMobile: true });
  const p = phone.page;
  const h1 = await box(p, '.hero h1');
  const subline = await box(p, '.subline');
  const firstCard = await box(p, '.length-card');
  check('375x667: the headline, subline and first choice card are on the first screen',
    h1.y + h1.height < 667 && subline.y + subline.height < 667 && firstCard.y + firstCard.height <= 667,
    `h1 ends ${Math.round(h1.y + h1.height)}, subline ${Math.round(subline.y + subline.height)}, card ${Math.round(firstCard.y + firstCard.height)}`);
  check('375px: no horizontal scroll', await noSideScroll(p));
  await p.screenshot({ path: path.join(shots, '10-landing-375x667.png') });
  await p.screenshot({ path: path.join(shots, '10b-landing-375-full.png'), fullPage: true });

  // fonts: self-hosted, loaded, no request to Google
  const fontsLoaded = await p.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(face => face.status === 'loaded').map(face => `${face.family} ${face.style}`);
  });
  check('the self-hosted fonts load (Manrope, Instrument Serif regular and italic)',
    fontsLoaded.some(f => f.startsWith('Manrope')) && fontsLoaded.includes('"Instrument Serif" normal') || fontsLoaded.some(f => f.includes('Instrument Serif') && f.endsWith('normal')) && fontsLoaded.some(f => f.includes('Instrument Serif') && f.endsWith('italic')), fontsLoaded.join('; '));
  check('the headline really renders in Instrument Serif and the body in Manrope', await p.evaluate(() => {
    const family = selector => getComputedStyle(document.querySelector(selector)).fontFamily;
    return family('.hero h1').startsWith('"Instrument Serif"') && family('body').startsWith('Manrope');
  }));
  const fontRequests = phone.requests.filter(url => /\.woff2?(\?|$)/.test(url));
  check('fonts come from this site only', fontRequests.length >= 3 && fontRequests.every(url => url.startsWith(server.origin)), fontRequests.map(url => url.split('/').pop()).join(', '));
  check('no request goes to fonts.googleapis.com or fonts.gstatic.com', !phone.requests.some(url => /fonts\.(googleapis|gstatic)\.com/.test(url)));

  // numbers come from the data
  const dataNumbers = await p.evaluate(async () => {
    const catalog = await (await fetch('../data/catalog.json')).json();
    const stats = await import('./evaluation-stats.js');
    const text = name => [...document.querySelectorAll(`[data-fill="${name}"]`)].map(node => node.textContent);
    return {
      films: text('films'), dims: text('dimensions'), lift: text('lift'),
      catalogLength: catalog.length, dimensions: catalog[0].embedding.length, expectedLift: `${stats.EVALUATION.lift.toFixed(1)}x`,
    };
  });
  check('the film count and dimension count are read from the loaded data, everywhere they appear',
    dataNumbers.films.length === 2 && dataNumbers.films.every(text => text === String(dataNumbers.catalogLength))
      && dataNumbers.dims.length === 2 && dataNumbers.dims.every(text => text === String(dataNumbers.dimensions)), JSON.stringify([dataNumbers.films, dataNumbers.dims]));
  check('the "better than chance" figure is the evaluation lift to one decimal', dataNumbers.lift.join() === dataNumbers.expectedLift, `${dataNumbers.lift} vs ${dataNumbers.expectedLift}`);
  const bodyText = await p.locator('#landing-screen').innerText();
  check('the page makes no claim about trackers or analytics', !/tracker|tracking|analytics/i.test(bodyText));
  check('the stats footnote says the figure comes from simulated profiles', bodyText.includes('Measured with simulated taste profiles, not a study of real viewers.'));

  // poster strip
  const strip = await p.evaluate(() => {
    const element = document.querySelector('.poster-strip');
    const images = [...element.querySelectorAll('img')];
    const track = getComputedStyle(document.querySelector('.poster-track'));
    return {
      hidden: element.getAttribute('aria-hidden'), tiles: element.querySelectorAll('.strip-tile').length,
      emptyAlt: images.every(image => image.getAttribute('alt') === ''), lazy: images.every(image => image.loading === 'lazy'),
      animation: track.animationName, duration: track.animationDuration, size: images.length,
    };
  });
  check('the poster strip is decorative: aria-hidden, empty alt text, lazy images, 12 films shown twice',
    strip.hidden === 'true' && strip.tiles === 24 && strip.emptyAlt && strip.lazy, JSON.stringify(strip));
  check('the strip drifts with a CSS animation of about 70 seconds', strip.animation === 'drift' && strip.duration === '70s');
  const tileSize = await p.evaluate(() => { const tile = document.querySelector('.strip-tile').getBoundingClientRect(); return [Math.round(tile.width), Math.round(tile.height)]; });
  check('posters are 150x225', tileSize.join('x') === '150x225', tileSize.join('x'));

  // links and sections
  const links = await p.locator('a[href^="https://github.com/YousefAkay/cocinema"]').evaluateAll(nodes => nodes.map(node => [node.target, node.rel]));
  check('both GitHub links open in a new tab, safely', links.length === 2 && links.every(([target, rel]) => target === '_blank' && rel === 'noopener noreferrer'));
  await p.locator('#how-link').click();
  await p.waitForFunction(() => document.getElementById('how').getBoundingClientRect().top < 120);
  check('"How it works" scrolls to the section without changing the address', (await p.evaluate(() => location.hash)) === '' && (await box(p, '#how')).y < 120);
  const cards = await p.locator('.how-card').count();
  check('three "how it works" cards', cards === 3 && (await p.locator('.how-card h3').allInnerTexts()).join('|') === 'Rate a few films|Your taste becomes a map|Get picks with reasons');
  const small = await p.$$eval('#landing-screen a, #landing-screen button, .length-card', nodes => nodes.filter(node => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44).length);
  check('every link, button and choice card on the landing page is at least 44px tall', small === 0, `${small} too small`);
  await phone.context.close();

  // ---- Desktop: 1280x800
  const desktop = await open({ width: 1280, height: 800 });
  const d = desktop.page;
  const heroH1 = await box(d, '.hero h1');
  const cardBoxes = await d.locator('.length-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  const startBox = await box(d, '#start-button');
  check('1280x800: the headline, both choice cards and Get started fit on the first screen',
    heroH1.y + heroH1.height < 800 && cardBoxes.every(card => card.bottom <= 800) && startBox.y + startBox.height <= 800,
    `button ends ${Math.round(startBox.y + startBox.height)}`);
  check('1280px: the choice cards sit side by side', Math.abs(cardBoxes[0].top - cardBoxes[1].top) < 2 && cardBoxes[1].left > cardBoxes[0].right - 1);
  check('1280px: no horizontal scroll', await noSideScroll(d));
  await d.screenshot({ path: path.join(shots, '11-landing-1280x800.png') });
  await d.screenshot({ path: path.join(shots, '11b-landing-1280-full.png'), fullPage: true });
  const axe = await new AxeBuilder({ page: d }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  check('axe at 1280px: the landing page has no violations', axe.violations.length === 0, axe.violations.map(v => `${v.id}/${v.impact}`).join(', ') || 'clean');
  await desktop.context.close();

  // ---- Reduced motion
  const calm = await open({ width: 375, height: 667, reducedMotion: 'reduce', isMobile: true });
  const calmAnimation = await calm.page.evaluate(() => getComputedStyle(document.querySelector('.poster-track')).animationName);
  check('with reduced motion the strip does not animate', calmAnimation === 'none', calmAnimation);
  await calm.page.locator('.poster-strip').scrollIntoViewIfNeeded();
  await calm.page.screenshot({ path: path.join(shots, '12-landing-reduced-motion.png') });
  await calm.context.close();

  // ---- Posters that cannot load
  const noPosters = await open({ width: 375, height: 667, blockPosters: true, isMobile: true });
  await noPosters.page.waitForTimeout(800);
  const fallback = await noPosters.page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.strip-tile')];
    return { broken: [...document.querySelectorAll('.strip-tile img')].filter(image => image.complete && image.naturalWidth === 0).length, titles: tiles.map(tile => tile.querySelector('span').textContent), visible: tiles.slice(0, 3).every(tile => tile.querySelector('span').getBoundingClientRect().width > 0) };
  });
  check('if posters fail to load the strip shows plain tiles with title and year, no broken images',
    fallback.broken === 0 && fallback.titles.length === 24 && /\(\d{4}\)$/.test(fallback.titles[0]) && fallback.visible, fallback.titles[0]);
  await noPosters.page.locator('.poster-strip').scrollIntoViewIfNeeded();
  await noPosters.page.screenshot({ path: path.join(shots, '12b-landing-posters-blocked.png') });
  await noPosters.context.close();

  // ---- Load failure keeps the error state
  const brokenContext = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  const broken = await brokenContext.newPage();
  broken.on('pageerror', error => problems.push(error.message));
  await broken.route('**/catalog.json', route => route.abort());
  await broken.goto(server.base);
  await broken.waitForSelector('#load-error:not([hidden])');
  await broken.locator('.length-card:has(input[value="10"])').click();
  check('the error state still shows Retry and keeps Get started disabled even after choosing a length',
    await broken.locator('#retry-button').isVisible() && await broken.locator('#start-button').isDisabled());
  await broken.unroute('**/catalog.json');
  await broken.getByRole('button', { name: 'Retry' }).click();
  await broken.waitForSelector('#start-button:not([disabled])');
  check('Retry loads the data and enables Get started because a length was chosen', !(await broken.locator('#load-error').isVisible()));
  await brokenContext.close();

  check('no console errors or uncaught errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('landing run finished without an exception', false, error.message);
} finally {
  await browser.close();
  server.close();
}

process.exit(summary() === 0 ? 0 : 1);
