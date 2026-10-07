import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPools, primaryGenre, isUnambiguous, TARGET_SIZE } from '../scripts/buildOnboarding.js';

const film = (id, title, genres, extra = {}) => ({
  id, title, genres, year: 2000, plot: 'a plot', poster: 'http://x/p.jpg', embedding: [1, 2], sitelinks: 10, ...extra,
});

// Two onboarding genres: "Drama" (common) and "Western" (rare), one hand-picked film each.
const existing = [
  { genre: 'Drama', movies: [{ id: 'h1', title: 'Hand Drama', year: 1950, handPicked: true }] },
  { genre: 'Western', movies: [{ id: 'h2', title: 'Hand Western', year: 1960, handPicked: true }] },
];

const catalog = [
  film('h1', 'Hand Drama', ['drama']),
  film('h2', 'Hand Western', ['western']),
  film('d1', 'Famous Drama', ['drama'], { sitelinks: 90 }),
  film('d2', 'Less Famous Drama', ['drama'], { sitelinks: 50 }),
  film('w1', 'Drama Western', ['drama', 'western'], { sitelinks: 80 }),
  film('u1', 'Unverified Drama', ['drama'], { sitelinks: 99 }),
  film('np', 'No Poster Drama', ['drama'], { sitelinks: 70, poster: null }),
  film('t1', 'Twin Title', ['drama'], { sitelinks: 60 }),
  film('t2', 'Twin Title', ['drama'], { sitelinks: 61 }),
  film('r1', 'Repaired Drama', ['drama'], { sitelinks: 40, plot: 'new plot' }),
  film('m1', 'Mismatch Not Repaired', ['drama'], { sitelinks: 95, plot: 'old plot' }),
  film('x1', 'Other Genre Only', ['comedy'], { sitelinks: 100 }),
];
const progress = Object.fromEntries([
  ...['h1', 'h2', 'd1', 'd2', 'w1', 'np', 't1', 't2', 'x1'].map(id => [id, { status: 'VERIFIED' }]),
  ['r1', { status: 'MISMATCH', correct: { plot: 'new plot' } }],
  ['m1', { status: 'MISMATCH', correct: { plot: 'something else' } }],
  ['u1', { status: 'REVIEW' }],
]);

test('hand-picked films always stay, with their own year', () => {
  const { pools } = buildPools(catalog, progress, existing);
  assert.deepEqual(pools[0].movies[0], { id: 'h1', title: 'Hand Drama', year: 1950, handPicked: true });
  assert.deepEqual(pools[1].movies[0], { id: 'h2', title: 'Hand Western', year: 1960, handPicked: true });
});

test('only verified or repaired films with a poster, plot, year, embedding and a unique title are added', () => {
  const { pools } = buildPools(catalog, progress, existing);
  const added = pools.flatMap(pool => pool.movies.filter(movie => !movie.handPicked).map(movie => movie.id));
  assert.deepEqual([...added].sort(), ['d1', 'd2', 'r1', 'w1']);
  for (const bad of ['u1', 'np', 't1', 't2', 'm1', 'x1']) {
    assert.ok(!added.includes(bad), `${bad} should have been left out`);
  }
});

test('a film joins the pool of its rarest onboarding genre, so drama does not take everything', () => {
  const { pools } = buildPools(catalog, progress, existing);
  assert.ok(pools[1].movies.some(movie => movie.id === 'w1'));
  assert.ok(!pools[0].movies.some(movie => movie.id === 'w1'));
  const labels = new Set(['drama', 'western']);
  const counts = new Map([['drama', 10], ['western', 2]]);
  assert.equal(primaryGenre({ genres: ['drama', 'western'] }, labels, counts), 'western');
  assert.equal(primaryGenre({ genres: ['comedy'] }, labels, counts), null);
});

test('best-known films come first, and no film is in two pools', () => {
  const { pools } = buildPools(catalog, progress, existing);
  assert.deepEqual(pools[0].movies.slice(1).map(movie => movie.id), ['d1', 'd2', 'r1']);
  const ids = pools.flatMap(pool => pool.movies.map(movie => movie.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('pools stop at the target size and report short pools', () => {
  const many = Array.from({ length: 12 }, (_, i) => film(`z${i}`, `Zed ${i}`, ['drama'], { sitelinks: 100 - i }));
  const ids = Object.fromEntries(many.map(movie => [movie.id, { status: 'VERIFIED' }]));
  const { pools, report } = buildPools([...catalog, ...many], { ...progress, ...ids }, existing);
  assert.equal(pools[0].movies.length, TARGET_SIZE);
  assert.equal(report[1].size, 2); // western: hand-picked plus Drama Western only
});

test('the output is deterministic', () => {
  assert.deepEqual(buildPools(catalog, progress, existing), buildPools([...catalog].reverse(), progress, existing));
});

test('a film with more than 2 onboarding genres is never auto-added, but a hand-picked one stays', () => {
  const three = [
    ...existing,
    { genre: 'Comedy', movies: [{ id: 'h3', title: 'Hand Comedy', year: 1970, handPicked: true }] },
  ];
  const withAmbiguous = [
    ...catalog,
    film('h3', 'Hand Comedy', ['comedy']),
    film('a1', 'Ambiguous', ['drama', 'western', 'comedy'], { sitelinks: 100 }),
    film('a2', 'Two Genres', ['drama', 'comedy'], { sitelinks: 5 }),
  ];
  const ok = { ...progress, a1: { status: 'VERIFIED' }, a2: { status: 'VERIFIED' }, h3: { status: 'VERIFIED' } };
  const ids = buildPools(withAmbiguous, ok, three).pools.flatMap(pool => pool.movies.map(movie => movie.id));
  assert.ok(!ids.includes('a1'), 'three onboarding genres is too ambiguous');
  assert.ok(ids.includes('a2'), 'two onboarding genres is fine');
});

test('isUnambiguous allows 1 or 2 onboarding genres and ignores other genres', () => {
  const labels = new Set(['drama', 'western', 'comedy']);
  assert.equal(isUnambiguous({ genres: ['drama'] }, labels), true);
  assert.equal(isUnambiguous({ genres: ['drama', 'teen', 'historical'] }, labels), true);
  assert.equal(isUnambiguous({ genres: ['drama', 'western'] }, labels), true);
  assert.equal(isUnambiguous({ genres: ['drama', 'western', 'comedy'] }, labels), false);
  assert.equal(isUnambiguous({ genres: ['teen'] }, labels), false);
  assert.equal(isUnambiguous({ genres: [] }, labels), false);
  assert.equal(isUnambiguous({}, labels), false);
});

// The committed file.
const readJson = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));

test('the committed onboarding pools follow every rule', () => {
  const onboarding = readJson('../data/onboarding.json');
  const realCatalog = readJson('../data/catalog.json');
  const realProgress = readJson('../data/verify-progress.json');
  const byId = new Map(realCatalog.map(movie => [movie.id, movie]));
  const titleCounts = new Map();
  realCatalog.forEach(movie => titleCounts.set(movie.title, (titleCounts.get(movie.title) || 0) + 1));

  assert.equal(onboarding.length, 15);
  const all = onboarding.flatMap(pool => pool.movies);
  assert.equal(new Set(all.map(movie => movie.id)).size, all.length, 'a film is in two pools');
  assert.equal(all.filter(movie => movie.handPicked).length, 46, 'the 46 hand-picked films must all be kept');

  for (const pool of onboarding) {
    assert.ok(pool.movies.length >= 3 && pool.movies.length <= TARGET_SIZE, `${pool.genre}: ${pool.movies.length} films`);
    for (const movie of pool.movies) {
      const entry = byId.get(movie.id);
      assert.ok(entry, `${movie.title} is not in the catalog`);
      if (movie.handPicked) continue;
      const progressEntry = realProgress[movie.id];
      const repaired = progressEntry?.status === 'MISMATCH' && progressEntry.correct.plot === entry.plot;
      assert.ok(progressEntry?.status === 'VERIFIED' || repaired, `${movie.title} is not verified`);
      assert.equal(titleCounts.get(entry.title), 1, `${movie.title} shares its title`);
      assert.ok(entry.poster && entry.plot && entry.year && entry.embedding.length > 0, `${movie.title} is incomplete`);
    }
  }
});
