import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStep, progressLabel, nextStep, locateFilm, shownBefore } from '../src/progress.js';

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

// ---- The next step after any answer, including answers given after going Back ----
const abc = [
  { genre: 'Comedy', movies: [film('a'), film('b'), film('c')] },
  { genre: 'Horror', movies: [film('h1'), film('h2')] },
  { genre: 'Drama', movies: [film('d1')] },
];
const answered = (rated = [], skipped = []) => ({ rated: new Set(rated), skipped: new Set(skipped) });

test('with nothing answered the next step is the first film of the first genre', () => {
  const step = nextStep(abc, answered());
  assert.deepEqual([step.genreIndex, step.movieIndex, step.movieId, step.done], [0, 0, 'a', false]);
});

test('a genre with a rated film is done, wherever the rated film sits in it', () => {
  assert.equal(nextStep(abc, answered(['a'])).movieId, 'h1');
  assert.equal(nextStep(abc, answered(['c'], ['a', 'b'])).movieId, 'h1');
});

test('skipped films are passed over inside a genre', () => {
  assert.equal(nextStep(abc, answered([], ['a'])).movieId, 'b');
  assert.equal(nextStep(abc, answered([], ['a', 'b'])).movieId, 'c');
});

test('the example: skip A and B, go back to A, rate it, and B and C are never shown', () => {
  // Back un-skips B and A, so neither is skipped; rating A finishes the genre.
  const step = nextStep(abc, answered(['a'], []));
  assert.deepEqual([step.genre, step.movieId], ['Horror', 'h1']);
});

test('a genre skipped all the way through is passed over', () => {
  const step = nextStep(abc, answered([], ['a', 'b', 'c']));
  assert.deepEqual([step.genre, step.n, step.movieId], ['Horror', 2, 'h1']);
});

test('a genre skipped through and then partly un-skipped comes back at its first un-skipped film', () => {
  // A, B and C were skipped and Horror's first film rated; Back un-skipped C and B, then the
  // visitor answered something else. The first film not answered is B, before anything later.
  assert.equal(nextStep(abc, answered(['h1'], ['a'])).movieId, 'b');
  // Only C un-skipped: C is next, even though Horror and later genres came after it.
  assert.equal(nextStep(abc, answered(['h1'], ['a', 'b'])).movieId, 'c');
  // Skipping C again passes over the genre once more and moves past the finished Horror.
  assert.equal(nextStep(abc, answered(['h1'], ['a', 'b', 'c'])).movieId, 'd1');
});

test('taking a rating back by skipping reopens that genre at its next film not skipped', () => {
  // h1 was rated, the visitor went back to it and chose "Haven't seen it".
  assert.equal(nextStep(abc, answered(['a', 'd1'], ['h1'])).movieId, 'h2');
});

test('films answered later in the session are never walked again', () => {
  // Everything after Comedy is answered; once Comedy is done, onboarding is finished.
  assert.equal(nextStep(abc, answered(['h2', 'd1'], ['a'])).movieId, 'b');
  assert.equal(nextStep(abc, answered(['b', 'h2', 'd1'], ['a'])).done, true);
});

test('unknown films are passed over and everything answered finishes onboarding', () => {
  assert.equal(nextStep(abc, answered(), id => id !== 'a').movieId, 'b');
  assert.equal(nextStep(abc, answered(['a', 'h1', 'd1'])).done, true);
  assert.equal(nextStep(abc, answered(['a', 'h1', 'd1'])).genreIndex, 3);
  assert.equal(nextStep([], answered()).done, true);
});

test('nextStep does not change its inputs', () => {
  const answers = answered(['a'], ['h1']);
  const before = JSON.stringify(abc);
  nextStep(abc, answers);
  assert.equal(JSON.stringify(abc), before);
  assert.deepEqual([[...answers.rated], [...answers.skipped]], [['a'], ['h1']]);
});

test('locateFilm finds where a film sits in the session', () => {
  assert.deepEqual(locateFilm(abc, 'c'), { genreIndex: 0, movieIndex: 2 });
  assert.deepEqual(locateFilm(abc, 'h2'), { genreIndex: 1, movieIndex: 1 });
  assert.equal(locateFilm(abc, 'zzz'), null);
});

test('shownBefore rebuilds the films shown in a forward-only session', () => {
  const done = new Set(['a', 'b', 'h1']);
  assert.deepEqual(shownBefore(abc, 2, 0, id => done.has(id)), ['a', 'b', 'h1']);
  assert.deepEqual(shownBefore(abc, 0, 2, id => done.has(id)), ['a', 'b']);
  assert.deepEqual(shownBefore(abc, 0, 0, id => done.has(id)), []);
  assert.deepEqual(shownBefore(abc, 3, 0, id => done.has(id)), ['a', 'b', 'h1']);
});
