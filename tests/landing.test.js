import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANDING_POSTERS } from '../src/landing-posters.js';
import { EVALUATION } from '../src/evaluation-stats.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const readJson = path => JSON.parse(read(path));

test('the README and the landing page quote the same "better than chance" number', () => {
  const readme = read('../README.md');
  const quoted = /a lift of (\d+\.\d)x/.exec(readme);
  assert.ok(quoted, 'the README should state the lift as "a lift of N.Nx"');
  assert.equal(quoted[1], EVALUATION.lift.toFixed(1), 'README and src/evaluation-stats.js disagree: rerun npm run evaluate or update the README');
  const main = read('../src/main.js');
  assert.ok(main.includes('EVALUATION.lift.toFixed(1)'), 'the landing page must read the figure from the evaluation stats');
  assert.ok(!/4\.5x/.test(read('../src/index.html')), 'the figure must not be typed into the page');
});

test('the evaluation stats file is complete and plausible', () => {
  assert.equal(EVALUATION.seed, 20261007);
  assert.ok(EVALUATION.lift > 1 && EVALUATION.lift < 20);
  assert.ok(EVALUATION.personas >= 100);
  assert.equal(EVALUATION.ratingsPerPersona, 12);
});

test('the landing poster strip uses 12 verified, well-known films with a poster and a unique title', () => {
  const catalog = readJson('../data/catalog.json');
  const progress = readJson('../data/verify-progress.json');
  const byTitle = new Map(catalog.map(movie => [movie.title, movie]));
  const titleCounts = new Map();
  catalog.forEach(movie => titleCounts.set(movie.title, (titleCounts.get(movie.title) || 0) + 1));

  assert.equal(LANDING_POSTERS.length, 12);
  assert.equal(new Set(LANDING_POSTERS.map(film => film.title)).size, 12);
  for (const film of LANDING_POSTERS) {
    const movie = byTitle.get(film.title);
    assert.ok(movie, `${film.title} is not in the catalog`);
    assert.equal(titleCounts.get(film.title), 1, `${film.title} shares its title`);
    assert.equal(film.year, movie.year);
    assert.ok(film.poster && film.poster === movie.poster);
    const entry = progress[movie.id];
    const repaired = entry && entry.status === 'MISMATCH' && entry.correct.plot === movie.plot;
    assert.ok((entry && entry.status === 'VERIFIED') || repaired, `${film.title} is not verified`);
  }
  // the best known first: sitelinks never increase down the list
  const sitelinks = LANDING_POSTERS.map(film => byTitle.get(film.title).sitelinks);
  assert.deepEqual(sitelinks, [...sitelinks].sort((a, b) => b - a));
});

test('the app asks for no font from another site', () => {
  for (const file of ['../src/style.css', '../src/index.html', '../src/main.js', '../src/sw.js']) {
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|Inter/.test(read(file)), `${file} still refers to Google Fonts or Inter`);
  }
  const css = read('../src/style.css');
  for (const file of ['manrope-variable-latin.woff2', 'instrument-serif-regular-latin.woff2', 'instrument-serif-italic-latin.woff2']) {
    assert.ok(css.includes(`fonts/${file}`), `${file} is not declared`);
    assert.ok(fs.existsSync(new URL(`../src/fonts/${file}`, import.meta.url)), `${file} is missing`);
    assert.ok(read('../src/sw.js').includes(`./fonts/${file}`), `${file} is not in the offline cache list`);
  }
  assert.equal((css.match(/font-display: swap/g) || []).length, 3);
  assert.ok(/<link rel="preload" href="fonts\/manrope-variable-latin\.woff2" as="font" type="font\/woff2" crossorigin>/.test(read('../src/index.html')));
  assert.ok(/<link rel="preload" href="fonts\/instrument-serif-regular-latin\.woff2" as="font" type="font\/woff2" crossorigin>/.test(read('../src/index.html')));
});

test('both font licences are in the repository', () => {
  for (const file of ['OFL-instrument-serif.txt', 'OFL-manrope.txt']) {
    const text = read(`../src/fonts/${file}`);
    assert.ok(text.includes('SIL Open Font License'), file);
    assert.ok(/Copyright \d{4}/.test(text), file);
  }
});

// WCAG contrast ratio between two #rrggbb colours.
function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

test('the palette is the one in the design brief', () => {
  const css = read('../src/style.css');
  const variable = name => new RegExp(`--${name}: (#[0-9a-f]{6});`, 'i').exec(css)[1].toLowerCase();
  assert.equal(variable('bg'), '#0b0a12');
  assert.equal(variable('surface'), '#15131f');
  assert.equal(variable('band'), '#100e19');
  assert.equal(variable('text'), '#f2effa');
  assert.equal(variable('text-secondary'), '#c9c3e0');
  assert.equal(variable('text-muted'), '#a9a4c0');
  assert.equal(variable('accent'), '#7c3aed');
  assert.equal(variable('accent-hover'), '#b79cff');
  assert.equal(variable('focus-ring'), '#e4d9ff');
});

test('every text and background pair meets WCAG AA (4.5:1, and 3:1 for focus rings and graphics)', () => {
  const css = read('../src/style.css');
  const color = name => new RegExp(`--${name}: (#[0-9a-f]{6});`, 'i').exec(css)[1];
  const backgrounds = ['bg', 'surface', 'band', 'surface-hover'].map(color);
  for (const text of ['text', 'text-secondary', 'text-muted', 'accent-hover'].map(color)) {
    for (const background of backgrounds) {
      assert.ok(contrast(text, background) >= 4.5, `${text} on ${background}: ${contrast(text, background).toFixed(2)}`);
    }
  }
  assert.ok(contrast('#ffffff', color('accent-fill')) >= 4.5, 'white on the accent fill');
  assert.ok(contrast('#ffffff', color('accent-fill-hover')) >= 4.5, 'white on the hovered accent fill');
  for (const background of [...backgrounds, color('accent-fill')]) {
    assert.ok(contrast(color('focus-ring'), background) >= 3, `focus ring on ${background}`);
  }
  for (const background of backgrounds.slice(0, 3)) {
    assert.ok(contrast(color('accent'), background) >= 3, `accent bars on ${background}`);
  }
});
