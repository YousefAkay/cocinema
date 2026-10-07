import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStep, progressLabel } from '../src/progress.js';

const film = id => ({ id });
const session = [
  { genre: 'Comedy', movies: [film('c1'), film('c2')] },
  { genre: 'Horror', movies: [film('h1')] },
  { genre: 'Drama', movies: [film('d1'), film('d2')] },
];

test('progress counts genres: the n-th genre of the session is on screen', () => {
  const step = resolveStep(session, 0, 0);
  assert.deepEqual([step.genre, step.n, step.of, step.movieId], ['Comedy', 1, 3, 'c1']);
  assert.equal(progressLabel(step), 'Comedy · 1 / 3');
  assert.equal(resolveStep(session, 2, 1).n, 3);
});

test('skipping a film moves through the films of one genre without changing the genre count', () => {
  const step = resolveStep(session, 0, 1);
  assert.deepEqual([step.genre, step.n, step.movieId], ['Comedy', 1, 'c2']);
});

test('a genre with all its films used up is passed over and counts as done', () => {
  const step = resolveStep(session, 0, 2); // both Comedy films handled
  assert.deepEqual([step.genre, step.n, step.of], ['Horror', 2, 3]);
  const skipTwo = resolveStep(session, 1, 1); // Horror exhausted too
  assert.deepEqual([skipTwo.genre, skipTwo.n], ['Drama', 3]);
});

test('films missing from the catalog are skipped, and a genre of only such films is skipped', () => {
  const known = id => id !== 'c1' && id !== 'c2' && id !== 'h1';
  const step = resolveStep(session, 0, 0, known);
  assert.deepEqual([step.genre, step.n, step.movieId], ['Drama', 3, 'd1']);
  assert.equal(step.genreIndex, 2);
  assert.equal(step.movieIndex, 0);
});

test('running out of genres finishes onboarding', () => {
  const done = resolveStep(session, 2, 2);
  assert.equal(done.done, true);
  assert.equal(done.genreIndex, 3);
  assert.equal(resolveStep(session, 3, 0).done, true);
  assert.equal(resolveStep([], 0, 0).done, true);
  assert.equal(resolveStep(session, 0, 0, () => false).done, true);
});

test('a Quick session of 10 reports "n / 10"', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ genre: `G${i}`, movies: [film(`m${i}`)] }));
  assert.equal(progressLabel(resolveStep(ten, 9, 0)), 'G9 · 10 / 10');
});
