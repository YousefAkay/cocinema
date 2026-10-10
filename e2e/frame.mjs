// The rating screen is one fixed frame: it fits the visible window with no page scroll, and every
// block stays in exactly the same place from one film to the next. Measured with bounding boxes
// over six consecutive films at six window sizes.
import path from 'node:path';
import { chromium } from 'playwright';
import { shots, startServer, createRecorder, chooseAndStart } from './helpers.mjs';

const server = await startServer();
const { check, summary } = createRecorder();
const browser = await chromium.launch({ channel: 'chrome' });

const SIZES = [[1440, 900], [1366, 768], [1280, 720], [1024, 768], [375, 667], [360, 640]];
const BLOCKS = ['.home-button', '.rating-step', '.poster-box', '.rating-title', '.rating-meta', '.pill-row', '.rating-widget', '.rating-hint', '.confirm-score', '.skip-button'];
const FILMS = 6;

const problems = [];

async function measure(page) {
  return page.evaluate(blocks => {
    const boxes = {};
    for (const selector of blocks) {
      const box = document.querySelector(selector).getBoundingClientRect();
      boxes[selector] = [box.left, box.top, box.width, box.height].map(value => Math.round(value * 10) / 10);
    }
    const scroller = document.scrollingElement;
    return {
      boxes,
      pageFits: scroller.scrollHeight <= innerHeight && scroller.scrollWidth <= innerWidth,
      scrollY: scrollY,
      lowest: Math.max(...Object.values(boxes).map(box => box[1] + box[3])),
      title: document.querySelector('.rating-title').textContent,
      focusedIsTitle: document.activeElement === document.querySelector('.rating-title'),
      inner: document.querySelector('#rating-screen').scrollHeight <= document.querySelector('#rating-screen').clientHeight,
      smallTargets: [...document.querySelectorAll('#rating-screen button')].filter(button => {
        const box = button.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      }).map(button => button.textContent),
    };
  }, BLOCKS);
}

for (const [width, height] of SIZES) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) problems.push(message.text());
  });
  await page.goto(server.base);
  await page.waitForSelector('.length-card');
  await chooseAndStart(page, 10);
  await page.waitForSelector('.rating-frame');

  const label = `${width}x${height}`;
  const runs = [];
  for (let film = 0; film < FILMS; film++) {
    await page.waitForSelector('.rating-title');
    runs.push(await measure(page));
    if (film === 2) {
      // The hint appearing, a score selected, and a very long title must not move anything either.
      await page.click('.confirm-score');
      const withHint = await measure(page);
      await page.getByRole('button', { name: '7', exact: true }).click();
      const withScore = await measure(page);
      await page.evaluate(() => { document.querySelector('.rating-title').textContent = 'A very long film title that goes on and on and on and on and on and on and on and on and on'; });
      const longTitle = await measure(page);
      const same = other => JSON.stringify(other.boxes) === JSON.stringify(runs[film].boxes);
      check(`${label}: showing the hint, picking a score and a very long title move nothing`, same(withHint) && same(withScore) && same(longTitle));
      await page.reload();
      await page.waitForSelector('.rating-title');
      runs[film] = await measure(page);
    }
    await page.getByRole('button', { name: String(5 + (film % 5)), exact: true }).click();
    await page.click('.confirm-score');
  }

  const first = runs[0];
  const titles = new Set(runs.map(run => run.title));
  check(`${label}: ${FILMS} different films were measured`, titles.size === FILMS, [...titles].join(' | '));
  check(`${label}: every block is in exactly the same place for all ${FILMS} films`, runs.every(run => JSON.stringify(run.boxes) === JSON.stringify(first.boxes)),
    JSON.stringify(runs.find(run => JSON.stringify(run.boxes) !== JSON.stringify(first.boxes)) || ''));
  check(`${label}: the page does not scroll (no vertical or horizontal overflow, scroll position 0)`, runs.every(run => run.pageFits && run.scrollY === 0));
  check(`${label}: nothing scrolls inside the frame and everything sits inside the window`, runs.every(run => run.inner && run.lowest <= height + 0.5), `lowest ${first.lowest}`);
  check(`${label}: focus is on the film title after each step`, runs.every(run => run.focusedIsTitle));
  check(`${label}: every button is at least 44px by 44px`, runs.every(run => run.smallTargets.length === 0), runs.flatMap(run => run.smallTargets).join(','));

  if (width === 1440 || width === 375) {
    // three consecutive rating screens for the README
    await page.reload();
    await page.waitForSelector('.rating-title');
    for (let shot = 1; shot <= 3; shot++) {
      await page.screenshot({ path: path.join(shots, `rating-${width}-${shot}.png`) });
      await page.getByRole('button', { name: '8', exact: true }).click();
      await page.click('.confirm-score');
      await page.waitForSelector('.rating-title');
    }
  }
  await context.close();
}

check('no console or page errors', problems.length === 0, problems[0]);
const failed = summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
