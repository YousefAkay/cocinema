import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, seededRandom, buildSession, newSeed, isValidLength, LENGTHS } from '../src/shuffle.js';

const range = n => Array.from({ length: n }, (_, i) => i);

test('shuffle returns a permutation: same elements, same length, no duplicates', () => {
  for (const seed of [1, 2, 3, 42, 99999, 4294967295]) {
    const input = range(20);
    const out = shuffle(input, seededRandom(seed));
    assert.equal(out.length, input.length);
    assert.equal(new Set(out).size, input.length);
    assert.deepEqual([...out].sort((a, b) => a - b), input);
  }
});

test('shuffle does not change its input', () => {
  const input = range(10);
  const copy = [...input];
  shuffle(input, seededRandom(5));
  assert.deepEqual(input, copy);
});

test('shuffle copes with empty and single-element lists', () => {
  assert.deepEqual(shuffle([], seededRandom(1)), []);
  assert.deepEqual(shuffle(['only'], seededRandom(1)), ['only']);
});

test('the same seed gives the same order', () => {
  for (const seed of [0, 7, 123456, 4294967295]) {
    assert.deepEqual(shuffle(range(30), seededRandom(seed)), shuffle(range(30), seededRandom(seed)));
  }
});

test('different seeds give different orders', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const orders = seeds.map(seed => shuffle(range(30), seededRandom(seed)).join(','));
  assert.equal(new Set(orders).size, seeds.length);
});

test('seededRandom stays in [0, 1) and repeats for one seed', () => {
  const a = seededRandom(11);
  const b = seededRandom(11);
  for (let i = 0; i < 1000; i++) {
    const value = a();
    assert.ok(value >= 0 && value < 1);
    assert.equal(value, b());
  }
});

test('shuffle is not biased towards leaving elements in place', () => {
  // Over many seeds each element should land in each of 4 positions about a quarter of the time.
  const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const runs = 8000;
  for (let seed = 1; seed <= runs; seed++) {
    shuffle([0, 1, 2, 3], seededRandom(seed)).forEach((element, position) => counts[element][position]++);
  }
  for (const row of counts) {
    for (const count of row) {
      assert.ok(Math.abs(count - runs / 4) < runs * 0.04, `count ${count} is far from ${runs / 4}`);
    }
  }
});

const pools = [
  { genre: 'A', movies: range(5).map(i => ({ id: `a${i}` })) },
  { genre: 'B', movies: range(5).map(i => ({ id: `b${i}` })) },
  { genre: 'C', movies: range(5).map(i => ({ id: `c${i}` })) },
  { genre: 'D', movies: range(5).map(i => ({ id: `d${i}` })) },
];

test('buildSession keeps every genre and every film, and is repeatable', () => {
  const session = buildSession(pools, 77);
  assert.deepEqual(session.map(g => g.genre).sort(), ['A', 'B', 'C', 'D']);
  for (const entry of session) {
    const original = pools.find(p => p.genre === entry.genre);
    assert.deepEqual(entry.movies.map(m => m.id).sort(), original.movies.map(m => m.id).sort());
  }
  assert.deepEqual(buildSession(pools, 77), session);
});

test('buildSession does not change the pools and differs between seeds', () => {
  const before = JSON.stringify(pools);
  const orders = [1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(buildSession(pools, seed)));
  assert.equal(JSON.stringify(pools), before);
  assert.ok(new Set(orders).size > 1);
});

test('newSeed gives whole numbers the saved-state check accepts', () => {
  for (let i = 0; i < 200; i++) {
    const seed = newSeed();
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295);
  }
});

const fifteen = Array.from({ length: 15 }, (_, i) => ({ genre: `G${i}`, movies: [{ id: `m${i}a` }, { id: `m${i}b` }] }));

test('only 10 and 15 are valid session lengths', () => {
  assert.deepEqual(LENGTHS, [10, 15]);
  assert.equal(isValidLength(10), true);
  assert.equal(isValidLength(15), true);
  for (const bad of [0, 5, 9, 11, 14, 16, 20, '10', '15', null, undefined, NaN, 10.5]) {
    assert.equal(isValidLength(bad), false, String(bad));
  }
});

test('a Quick session has exactly 10 distinct genres, all from the 15', () => {
  const all = new Set(fifteen.map(entry => entry.genre));
  for (const seed of [1, 2, 3, 99, 4242, 4294967295]) {
    const genres = buildSession(fifteen, seed, 10).map(entry => entry.genre);
    assert.equal(genres.length, 10);
    assert.equal(new Set(genres).size, 10);
    assert.ok(genres.every(genre => all.has(genre)));
  }
});

test('a Full session keeps all 15 genres', () => {
  const genres = buildSession(fifteen, 7, 15).map(entry => entry.genre);
  assert.equal(genres.length, 15);
  assert.equal(new Set(genres).size, 15);
});

test('the Quick genres are deterministic for a seed and differ across seeds', () => {
  const pick = seed => buildSession(fifteen, seed, 10).map(entry => entry.genre).join();
  assert.equal(pick(31), pick(31));
  const sets = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => buildSession(fifteen, seed, 10).map(entry => entry.genre).sort().join()));
  assert.ok(sets.size > 1, 'different seeds should choose different 10-genre sets');
});

test('a Quick session is the first 10 genres of the same seed Full order', () => {
  const full = buildSession(fifteen, 55, 15).map(entry => entry.genre);
  const quick = buildSession(fifteen, 55, 10).map(entry => entry.genre);
  assert.deepEqual(quick, full.slice(0, 10));
});

test('buildSession rejects an unsupported length', () => {
  assert.throws(() => buildSession(fifteen, 1, 12));
});
