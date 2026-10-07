import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, seededRandom, buildSession, newSeed } from '../src/shuffle.js';

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
