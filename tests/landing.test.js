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
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|\bInter\b/.test(read(file)), `${file} still refers to Google Fonts or Inter`);
  }
  const css = read('../src/style.css');
  const files = ['figtree-latin-wght-normal.woff2', 'big-shoulders-display-latin-wght-normal.woff2'];
  for (const file of files) {
    assert.ok(css.includes(`fonts/${file}`), `${file} is not declared`);
    assert.ok(fs.existsSync(new URL(`../src/fonts/${file}`, import.meta.url)), `${file} is missing`);
    assert.ok(read('../src/sw.js').includes(`./fonts/${file}`), `${file} is not in the offline cache list`);
  }
  assert.equal((css.match(/font-display: swap/g) || []).length, 2);
  const html = read('../src/index.html');
  for (const file of files) {
    assert.ok(html.includes(`<link rel="preload" href="fonts/${file}" as="font" type="font/woff2" crossorigin>`), `${file} is not preloaded`);
  }
  // Only these two font files ship, and together they stay small.
  const shipped = fs.readdirSync(new URL('../src/fonts/', import.meta.url)).filter(name => name.endsWith('.woff2'));
  assert.deepEqual(shipped.sort(), [...files].sort());
  const bytes = shipped.reduce((sum, name) => sum + fs.statSync(new URL(`../src/fonts/${name}`, import.meta.url)).size, 0);
  assert.ok(bytes < 150 * 1024, `fonts weigh ${bytes} bytes`);
});

test('the old fonts are gone and the new ones have metric-matched local fallbacks', () => {
  const css = read('../src/style.css');
  assert.ok(!/Manrope|Instrument Serif/.test(css + read('../src/index.html') + read('../src/sw.js') + read('../scripts/generateAssets.mjs')));
  assert.match(css, /--font-body: 'Figtree', 'Figtree Fallback',/);
  assert.match(css, /--font-display: 'Big Shoulders Display', 'Big Shoulders Display Fallback',/);
  for (const family of ['Figtree Fallback', 'Big Shoulders Display Fallback']) {
    const block = new RegExp(`font-family: '${family}';[^}]*size-adjust: [0-9.]+%;[^}]*ascent-override`).exec(css);
    assert.ok(block, `${family} needs size-adjust and metric overrides`);
  }
});

test('the headline is one weight and one colour, with no accented italic word', () => {
  const css = read('../src/style.css');
  const em = /\.hero h1 em \{([^}]*)\}/.exec(css)[1];
  assert.match(em, /color: inherit;/);
  assert.match(em, /font-style: normal;/);
});

test('both font licences are in the repository, and only those', () => {
  const licences = fs.readdirSync(new URL('../src/fonts/', import.meta.url)).filter(name => name.endsWith('.txt'));
  assert.deepEqual(licences.sort(), ['OFL-big-shoulders-display.txt', 'OFL-figtree.txt']);
  for (const file of licences) {
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

test('rankings show a plain "#N", never a total', () => {
  for (const file of ['../src/ui.js', '../src/cowatchScreens.js', '../src/main.js']) {
    const code = read(file);
    assert.ok(!/#\$\{[^}]*\}\s+of\s/.test(code), `${file} builds a "#N of M" ranking`);
  }
  assert.match(read('../src/ui.js'), /match\.textContent = `#\$\{rank\}`;/);
  assert.match(read('../src/cowatchScreens.js'), /`#\$\{index \+ 1\}`/);
});

test('marketing copy takes the film count from roundedCount, never from the exact length or typed by hand', () => {
  const main = read('../src/main.js');
  assert.match(main, /fillLandingNumber\('films', roundedCount\(catalog\.length\)/);
  assert.ok(!/fillLandingNumber\('films', String\(catalog\.length\)\)/.test(main));
  const html = read('../src/index.html');
  assert.ok(!/\b5\d0\+?\s+(films|movies)/.test(html), 'a film count is typed into the page');
  assert.ok(!/\b57\d\b|\b576\b/.test(html), 'an exact catalog count is typed into the page');
});

test('the length choice offers Taster, Quick and Full in that order, as radios with nothing checked', () => {
  const html = read('../src/index.html');
  const fieldset = /<fieldset class="length-choice"[\s\S]*?<\/fieldset>/.exec(html)[0];
  assert.match(fieldset, /<legend>/);
  const radios = [...fieldset.matchAll(/<input type="radio" name="length" value="(\d+)"[^>]*>/g)];
  assert.deepEqual(radios.map(match => match[1]), ['5', '10', '15']);
  assert.ok(radios.every(match => !/checked/.test(match[0])), 'no option may be pre-selected');
  const titles = [...fieldset.matchAll(/class="length-title">([^<]+)</g)].map(match => match[1]);
  assert.deepEqual(titles, ['Taster', 'Quick', 'Full']);
  assert.ok(!/minute|second|hour/i.test(fieldset), 'no duration claims');
});

test('How it works step 1 is short and leaves the counts to the length cards', () => {
  const html = read('../src/index.html');
  const how = /<section class="how[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(how, /Score films you've seen from 1 to 10, from every genre or just one\. Skip any you haven't seen\./);
  assert.ok(!/Taster asks|Quick 10|Full 15/.test(how), 'the counts are on the length cards');
});

test('the landing asks General or Pick a genre first, with nothing chosen, and the sticky band clears the safe area', () => {
  const html = read('../src/index.html');
  const mode = /<fieldset class="length-choice mode-choice" id="mode-choice">[\s\S]*?<\/fieldset>/.exec(html)[0];
  assert.deepEqual([...mode.matchAll(/name="mode" value="(\w+)"/g)].map(match => match[1]), ['general', 'genre']);
  assert.ok(!/checked/.test(mode));
  assert.match(html, /<fieldset class="genre-choice" id="genre-choice" hidden>/);
  assert.match(html, /<fieldset class="length-choice" id="length-choice" hidden>/);
  const css = read('../src/style.css');
  assert.match(css, /\.start-zone\.is-sticky \{[^}]*bottom: 0;[^}]*max\(12px, env\(safe-area-inset-bottom\)\)/);
});

test('the landing has no pill label and one plain stats line filled from data, with its footnote', () => {
  const html = read('../src/index.html');
  assert.ok(!/class="pill"/.test(html), 'the pill label is gone');
  const stats = /<section class="stats"[\s\S]*?<\/section>/.exec(html)[0];
  assert.equal((stats.match(/class="stats-line"/g) || []).length, 1);
  assert.match(stats, /<span data-fill="films">[^<]*<\/span> films &middot; <span data-fill="lift">[^<]*<\/span> better than chance at finding your genre/);
  assert.ok(!/stat-number|data-fill="dimensions"|accounts/.test(stats), 'the four stat tiles are gone');
  assert.match(stats, /Measured with simulated taste profiles, not a study of real viewers\./);
});
