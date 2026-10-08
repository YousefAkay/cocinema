import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAMPLE_FRIENDS, SAMPLE_KEYS, buildSampleFriend } from '../src/samples.js';
import { encodeTaste, decodeTaste } from '../src/cowatch.js';
import { combineTastes } from '../src/combine.js';
import { recommend } from '../src/recommend.js';
import { parseHash } from '../src/route.js';
import { COWATCH_ENABLED } from '../src/flags.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const known = new Set(catalog.map(movie => movie.id));
const byId = new Map(catalog.map(movie => [movie.id, movie]));

test('there are three clearly labelled sample friends', () => {
  assert.deepEqual(SAMPLE_KEYS, ['horror', 'romance', 'scifi']);
  assert.deepEqual(SAMPLE_FRIENDS.map(sample => sample.label), ['Horror fan', 'Romance fan', 'Sci-fi fan']);
});

test('each sample is 6 liked, 4 disliked and 2 neutral films, all in the catalog and all different', () => {
  for (const key of SAMPLE_KEYS) {
    const ratings = buildSampleFriend(catalog, key);
    assert.equal(ratings.length, 12, key);
    assert.equal(new Set(ratings.map(rating => rating.id)).size, 12, key);
    assert.ok(ratings.every(rating => known.has(rating.id)), key);
    assert.equal(ratings.filter(rating => rating.score >= 9).length, 6, key);
    assert.equal(ratings.filter(rating => rating.score <= 3).length, 4, key);
    assert.equal(ratings.filter(rating => rating.score >= 5 && rating.score <= 6).length, 2, key);
  }
});

test('the liked films belong to the sample\'s genre and the disliked ones do not', () => {
  for (const sample of SAMPLE_FRIENDS) {
    for (const { id, score } of buildSampleFriend(catalog, sample.key)) {
      const genres = byId.get(id).genres || [];
      if (score >= 9) assert.ok(genres.includes(sample.genre), `${sample.key}: ${byId.get(id).title}`);
      if (score <= 3) assert.ok(!genres.includes(sample.genre), `${sample.key}: ${byId.get(id).title}`);
    }
  }
});

test('a sample is the same every time, and does not depend on the order of the catalog', () => {
  for (const key of SAMPLE_KEYS) {
    const first = buildSampleFriend(catalog, key);
    assert.deepEqual(buildSampleFriend(catalog, key), first);
    assert.deepEqual(buildSampleFriend([...catalog].reverse(), key), first);
  }
});

test('the three samples are different people', () => {
  const [a, b, c] = SAMPLE_KEYS.map(key => buildSampleFriend(catalog, key).map(rating => rating.id).join());
  assert.ok(a !== b && b !== c && a !== c);
});

test('an unknown key or a catalog that is too small gives null', () => {
  assert.equal(buildSampleFriend(catalog, 'nobody'), null);
  assert.equal(buildSampleFriend(catalog.slice(0, 5), 'horror'), null);
  assert.equal(buildSampleFriend([], 'horror'), null);
});

test('a sample goes through the same path as a real link and can make a profile', () => {
  for (const key of SAMPLE_KEYS) {
    const ratings = buildSampleFriend(catalog, key);
    const decoded = decodeTaste(encodeTaste(ratings), known);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.ratings, ratings);
    assert.ok(recommend(decoded.ratings, catalog, 1).length > 0, key);
  }
});

test('a sample friend combines with a visitor into ten films neither has rated', () => {
  const byTitle = title => catalog.find(movie => movie.title === title).id;
  const visitor = [['Titanic', 10], ['The Notebook', 9], ['La La Land', 9], ['Alien', 2], ['Saw', 3], ['Superbad', 5]]
    .map(([title, score]) => ({ id: byTitle(title), score }));
  for (const key of SAMPLE_KEYS) {
    const friend = buildSampleFriend(catalog, key);
    const { problem, results } = combineTastes(catalog, visitor, friend, 10);
    assert.equal(problem, null, key);
    assert.equal(results.length, 10, key);
    const rated = new Set([...visitor, ...friend].map(rating => rating.id));
    assert.ok(results.every(result => !rated.has(result.movie.id)), key);
  }
});

// ---- The feature flag ----

test('the flag is on, and with it off a #/with/ link is just the home page', () => {
  assert.equal(COWATCH_ENABLED, true);
  assert.deepEqual(parseHash('#/with/abc', true), { type: 'with', payload: 'abc' });
  assert.deepEqual(parseHash('#/with/abc', false), { type: 'home' });
  assert.deepEqual(parseHash('#/with/', true), { type: 'with', payload: '' });
  assert.deepEqual(parseHash('#/with/', false), { type: 'home' });
});

test('with the flag off, film pages and the home page route exactly as before', () => {
  assert.deepEqual(parseHash('#/movie/Q104123', false), { type: 'movie', qid: 'Q104123' });
  assert.deepEqual(parseHash('', false), { type: 'home' });
  assert.deepEqual(parseHash('#/other', false), { type: 'home' });
});

test('every co-watch entry point in the app is behind the flag', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // the button and samples are only added inside a flag check
  assert.match(main, /if \(COWATCH_ENABLED\) \{\s*resultsScreen\.append\(renderShareSection/);
  assert.match(main, /if \(COWATCH_ENABLED && getFriend\(\)\)/);
  assert.match(main, /if \(COWATCH_ENABLED && pendingFriend\)/);
  // the route that opens a link comes only from parseHash, which the flag controls
  const route = fs.readFileSync(new URL('../src/route.js', import.meta.url), 'utf8');
  assert.ok(route.includes('cowatchEnabled'));
  // the page itself has no co-watch markup: everything is built by script, and only when enabled
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.ok(!/friend|cowatch|watch with/i.test(html.replace(/<meta[^>]*>/g, '')));
});

test('the co-watch code never writes a friend into the visitor\'s own ratings', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(!/saveRating\([^)]*friend/i.test(main));
  const screens = fs.readFileSync(new URL('../src/cowatchScreens.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|saveRating/.test(screens));
  const cowatch = fs.readFileSync(new URL('../src/cowatch.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|document\./.test(cowatch));
});
