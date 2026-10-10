import test from 'node:test';
import assert from 'node:assert/strict';
import { topPercent } from '../src/percentile.js';
import { titleWithYear, genreOrder, topGenres, capitalize, roundedCount, formatRuntime, formatRottenTomatoes, metaParts } from '../src/format.js';
import { trailerSearchUrl, whereToWatchLinks } from '../src/links.js';
import { movieHash, parseHash, shortId } from '../src/route.js';

test('topPercent: the best of 200 films is Top 1%, never Top 0%', () => {
  const scores = Array.from({ length: 200 }, (_, i) => i / 200);
  assert.equal(topPercent(0.995, scores), 1);
});

test('topPercent: the middle and the bottom', () => {
  const scores = Array.from({ length: 100 }, (_, i) => i / 100);
  assert.equal(topPercent(0.5, scores), 50); // 49 films are better, so rank 50 of 100
  assert.equal(topPercent(0, scores), 100);
});

test('topPercent: tied scores share the best rank', () => {
  assert.equal(topPercent(0.5, [0.9, 0.5, 0.5, 0.5]), 50); // one film is better, rank 2 of 4
  assert.equal(topPercent(0.9, [0.9, 0.9, 0.5, 0.5]), 25); // rank 1 of 4
});

test('topPercent: a single candidate is its own whole catalog', () => {
  assert.equal(topPercent(0.3, [0.3]), 100);
});

test('topPercent: an empty list gives null', () => {
  assert.equal(topPercent(0.3, []), null);
});

test('titleWithYear adds the year when there is one', () => {
  assert.equal(titleWithYear({ title: 'The Lion King', year: 2019 }), 'The Lion King (2019)');
  assert.equal(titleWithYear({ title: 'The Lion King', year: 1994 }), 'The Lion King (1994)');
  assert.equal(titleWithYear({ title: 'Untitled' }), 'Untitled');
  assert.equal(titleWithYear({ title: 'Untitled', year: null }), 'Untitled');
});

const onboarding = [{ genre: 'Comedy' }, { genre: 'Sci-fi' }, { genre: 'Animation' }, { genre: 'Drama' }];
const catalog = [
  { genres: ['drama', 'historical', 'comedy'] },
  { genres: ['drama', 'historical'] },
  { genres: ['drama', 'science fiction'] },
  { genres: ['historical', 'animated'] },
  { genres: ['historical'] },
  { genres: ['teen', 'comedy'] },
  { genres: [] },
  {},
];

test('genreOrder puts onboarding genres first, then the rest, each most common first', () => {
  // counts: historical 4, drama 3, comedy 2, science fiction 1, animated 1, teen 1
  assert.deepEqual(genreOrder(catalog, onboarding), [
    'drama', 'comedy', 'animated', 'science fiction', // onboarding genres by count, ties alphabetical
    'historical', 'teen', // every other genre by count
  ]);
});

test('genreOrder is deterministic and handles an empty catalog', () => {
  assert.deepEqual(genreOrder(catalog, onboarding), genreOrder([...catalog].reverse(), onboarding));
  assert.deepEqual(genreOrder([], onboarding), []);
});

test('topGenres keeps at most 3, preferring the onboarding genres', () => {
  const order = genreOrder(catalog, onboarding);
  const movie = { genres: ['historical', 'teen', 'comedy', 'drama'] };
  assert.deepEqual(topGenres(movie, order), ['drama', 'comedy', 'historical']);
  assert.deepEqual(topGenres({ genres: ['teen'] }, order), ['teen']);
  assert.deepEqual(topGenres({ genres: [] }, order), []);
  assert.deepEqual(topGenres({}, order), []);
  assert.deepEqual(topGenres(movie, order, 2), ['drama', 'comedy']);
});

test('topGenres does not change the film own genre list', () => {
  const movie = { genres: ['teen', 'drama'] };
  topGenres(movie, genreOrder(catalog, onboarding));
  assert.deepEqual(movie.genres, ['teen', 'drama']);
});

test('capitalize', () => {
  assert.equal(capitalize('science fiction'), 'Science fiction');
  assert.equal(capitalize(''), '');
});

test('trailerSearchUrl searches YouTube for "title year trailer"', () => {
  const url = new URL(trailerSearchUrl({ title: 'The Lion King', year: 2019 }));
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/results');
  assert.equal(url.searchParams.get('search_query'), 'The Lion King 2019 trailer');
});

test('trailerSearchUrl encodes &, accents and apostrophes, and skips a missing year', () => {
  const tricky = { title: "Amélie & Bob's #1 ?film", year: 2001 };
  const url = new URL(trailerSearchUrl(tricky));
  assert.equal(url.searchParams.get('search_query'), "Amélie & Bob's #1 ?film 2001 trailer");
  assert.ok(!trailerSearchUrl(tricky).includes(' '));
  assert.equal(new URL(trailerSearchUrl({ title: 'Metropolis' })).searchParams.get('search_query'), 'Metropolis trailer');
});

test('whereToWatchLinks gives Canada, United States and United Kingdom JustWatch searches', () => {
  const links = whereToWatchLinks({ title: 'Heat' });
  assert.deepEqual(links.map(l => [l.country, l.code]), [['Canada', 'ca'], ['United States', 'us'], ['United Kingdom', 'uk']]);
  assert.deepEqual(links.map(l => l.url), [
    'https://www.justwatch.com/ca/search?q=Heat',
    'https://www.justwatch.com/us/search?q=Heat',
    'https://www.justwatch.com/uk/search?q=Heat',
  ]);
});

test('whereToWatchLinks encodes special characters in the title', () => {
  const [ca] = whereToWatchLinks({ title: "Amélie & Bob's" });
  assert.equal(new URL(ca.url).searchParams.get('q'), "Amélie & Bob's");
  assert.ok(!ca.url.includes('&Bob') && !ca.url.includes(' '));
});

test('route helpers round-trip a Wikidata id through the hash', () => {
  const id = 'http://www.wikidata.org/entity/Q104123';
  assert.equal(shortId(id), 'Q104123');
  assert.equal(movieHash(id), '#/movie/Q104123');
  assert.deepEqual(parseHash(movieHash(id)), { type: 'movie', qid: 'Q104123' });
});

test('parseHash treats anything else as home', () => {
  for (const hash of ['', '#', '#/', '#/movie/', '#/movie/abc', '#/movie/Q12/extra', '#/other/Q1', undefined]) {
    assert.deepEqual(parseHash(hash), { type: 'home' }, String(hash));
  }
});

test('roundedCount rounds down to the nearest 50 and adds a plus sign', () => {
  assert.equal(roundedCount(576), '550+');
  assert.equal(roundedCount(575), '550+');
  assert.equal(roundedCount(550), '550+');
  assert.equal(roundedCount(549), '500+');
  assert.equal(roundedCount(539), '500+');
  assert.equal(roundedCount(500), '500+');
  assert.equal(roundedCount(499), '450+');
  assert.equal(roundedCount(100), '100+');
  assert.equal(roundedCount(50), '50+');
  assert.equal(roundedCount(1234), '1200+');
});

test('roundedCount never claims more films than there are', () => {
  for (let count = 50; count <= 1500; count++) {
    const label = roundedCount(count);
    const shown = parseInt(label, 10);
    assert.ok(shown <= count && shown > count - 50, `${count} -> ${label}`);
    assert.equal(shown % 50, 0);
  }
});

test('roundedCount gives null when there is no usable count, so copy can fall back to words', () => {
  assert.equal(roundedCount(0), null);
  assert.equal(roundedCount(49), null);
  assert.equal(roundedCount(-100), null);
  assert.equal(roundedCount('576'), null);
  assert.equal(roundedCount(NaN), null);
  assert.equal(roundedCount(Infinity), null);
  assert.equal(roundedCount(null), null);
  assert.equal(roundedCount(undefined), null);
  assert.equal(roundedCount({}), null);
});

test('runtimes are written as hours and minutes', () => {
  assert.equal(formatRuntime('142 min'), '2h 22m');
  assert.equal(formatRuntime('120 min'), '2h');
  assert.equal(formatRuntime('60 min'), '1h');
  assert.equal(formatRuntime('45 min'), '45m');
  assert.equal(formatRuntime('123 min'), '2h 3m');
});

test('missing or odd runtimes give nothing instead of a wrong figure', () => {
  for (const value of [null, undefined, '', 'N/A', '0 min', 'about two hours', 142]) {
    assert.equal(formatRuntime(value), null, String(value));
  }
});

test('Rotten Tomatoes is a percentage with its name, or nothing', () => {
  assert.equal(formatRottenTomatoes('87%'), 'Rotten Tomatoes 87%');
  assert.equal(formatRottenTomatoes('100%'), 'Rotten Tomatoes 100%');
  for (const value of [null, undefined, '', 'N/A', '87', '8.7/10']) {
    assert.equal(formatRottenTomatoes(value), null, String(value));
  }
});

test('the facts line leaves out whatever is missing, with no stray separators', () => {
  assert.deepEqual(metaParts({ year: 1994, runtime: '142 min', rottenTomatoes: '91%' }), ['1994', '2h 22m', 'Rotten Tomatoes 91%']);
  assert.deepEqual(metaParts({ year: 1994, runtime: null, rottenTomatoes: '91%' }), ['1994', 'Rotten Tomatoes 91%']);
  assert.deepEqual(metaParts({ year: 1994, runtime: '142 min', rottenTomatoes: null }), ['1994', '2h 22m']);
  assert.deepEqual(metaParts({ year: 1994 }), ['1994']);
  assert.deepEqual(metaParts({}), []);
});

test('every catalog film gives a clean facts line', async () => {
  const fs = await import('node:fs');
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  for (const movie of catalog) {
    const text = metaParts(movie).join(' · ');
    assert.ok(text.length > 0 && !/\bmin\b|null|undefined|N\/A/.test(text), movie.title + ': ' + text);
  }
});
