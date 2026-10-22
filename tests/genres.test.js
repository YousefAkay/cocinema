import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MIN_GENRE_FILMS, SHUFFLE_WINDOW, availableGenres, buildGenreQueue, genreStepAt, nextGenreStep, filterGenreResults,
} from '../src/genres.js';
import { genreName, genreNameInText } from '../src/format.js';

const film = (id, genres, sitelinks) => ({ id, genres, sitelinks });
const many = (prefix, count, genres, start = 1000) => Array.from({ length: count }, (_, i) => film(`${prefix}${i}`, genres, start - i));

test('a genre is offered from MIN_GENRE_FILMS films up, and not one film below', () => {
  assert.equal(MIN_GENRE_FILMS, 35);
  const catalog = [...many('c', 35, ['comedy']), ...many('w', 34, ['western']), ...many('d', 40, ['drama', 'comedy'])];
  assert.deepEqual(availableGenres(catalog), [{ label: 'comedy', count: 75 }, { label: 'drama', count: 40 }]);
  assert.deepEqual(availableGenres(catalog, 34).map(entry => entry.label), ['comedy', 'drama', 'western']);
});

test('genres are ordered by film count, largest first, ties alphabetical, and a repeated label counts once', () => {
  const catalog = [...many('a', 36, ['horror']), ...many('b', 36, ['crime', 'crime']), ...many('c', 50, ['action'])];
  assert.deepEqual(availableGenres(catalog), [{ label: 'action', count: 50 }, { label: 'crime', count: 36 }, { label: 'horror', count: 36 }]);
});

test('the real catalog offers every genre that clears the threshold, with friendly names', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const offered = availableGenres(catalog);
  assert.ok(offered.length >= 10);
  assert.ok(offered.every(entry => entry.count >= MIN_GENRE_FILMS));
  assert.equal(offered[0].label, 'drama');
  assert.equal(genreName('science fiction'), 'Sci-fi');
  assert.equal(genreName("children's"), 'Family');
  assert.equal(genreName('animated'), 'Animation');
  assert.equal(genreName('comedy'), 'Comedy');
  assert.equal(genreNameInText('science fiction'), 'sci-fi');
});

const catalog = [
  ...many('x', 60, ['comedy'], 500),
  film('p1', ['comedy'], 1), film('p2', ['comedy', 'drama'], 2),
  film('d1', ['drama'], 9999),
];
const onboarding = [{ genre: 'Comedy', movies: [{ id: 'p1' }, { id: 'p2' }, { id: 'gone' }] }, { genre: 'Drama', movies: [{ id: 'd1' }] }];

test('the queue holds only films of the genre, each once, with its onboarding pool first', () => {
  const queue = buildGenreQueue(catalog, onboarding, 'comedy', 7);
  assert.equal(queue.length, 62);
  assert.equal(new Set(queue).size, 62);
  assert.ok(!queue.includes('d1') && !queue.includes('gone'));
  assert.deepEqual(queue.slice(0, 2).sort(), ['p1', 'p2']);
});

test('the queue is deterministic per seed, shuffles only the best-known films, and keeps the rest in order', () => {
  const a = buildGenreQueue(catalog, onboarding, 'comedy', 7);
  assert.deepEqual(buildGenreQueue(catalog, onboarding, 'comedy', 7), a);
  const others = [1, 2, 3, 4, 5].map(seed => buildGenreQueue(catalog, onboarding, 'comedy', seed).join());
  assert.ok(new Set(others).size > 1, 'different seeds give a different mix');
  const window = new Set(many('x', SHUFFLE_WINDOW, ['comedy'], 500).map(movie => movie.id));
  assert.ok(a.slice(2, 2 + SHUFFLE_WINDOW).every(id => window.has(id)), 'the shuffled part is the best-known films');
  assert.deepEqual(a.slice(2 + SHUFFLE_WINDOW), many('x', 60, ['comedy'], 500).slice(SHUFFLE_WINDOW).map(movie => movie.id));
});

test('a genre without an onboarding pool starts with its best-known films', () => {
  const queue = buildGenreQueue(catalog, [], 'comedy', 3);
  const top = new Set(many('x', SHUFFLE_WINDOW, ['comedy'], 500).map(movie => movie.id));
  assert.ok(queue.slice(0, SHUFFLE_WINDOW).every(id => top.has(id)));
});

const answers = (rated = [], skipped = []) => ({ rated: new Set(rated), skipped: new Set(skipped) });
const q = ['a', 'b', 'c', 'd', 'e', 'f'];

test('genre steps count rated films, pass over skipped ones and finish at the target', () => {
  assert.deepEqual(nextGenreStep(q, 'comedy', answers(), 3), { done: false, genreIndex: 0, movieIndex: 0, movieId: 'a', genre: 'comedy', n: 1, of: 3 });
  const afterSkip = nextGenreStep(q, 'comedy', answers([], ['a']), 3);
  assert.deepEqual([afterSkip.movieId, afterSkip.n], ['b', 1]);
  const third = nextGenreStep(q, 'comedy', answers(['b', 'c'], ['a']), 3);
  assert.deepEqual([third.movieId, third.n], ['d', 3]);
  const done = nextGenreStep(q, 'comedy', answers(['b', 'c', 'd'], ['a']), 3);
  assert.deepEqual([done.done, done.genreIndex], [true, 3]);
});

test('running out of films finishes with what the visitor has', () => {
  assert.equal(nextGenreStep(q, 'comedy', answers(['a'], ['b', 'c', 'd', 'e', 'f']), 5).done, true);
});

test('a film reached with Back keeps its place in the count, and a finished save stays finished', () => {
  const step = genreStepAt(q, 'comedy', 0, 1, answers(['a', 'b']), 5);
  assert.deepEqual([step.movieId, step.n], ['b', 2]);
  assert.equal(genreStepAt(q, 'comedy', 0, 2, answers(['a', 'b']), 5).n, 3);
  assert.equal(genreStepAt(q, 'comedy', 5, 0, answers(), 5).done, true);
  assert.equal(genreStepAt(q, 'comedy', 0, 99, answers(), 5).done, true);
});

test('results keep only films of the genre, never a rated film, in the ranking order', () => {
  const ranked = [
    { movie: film('r1', ['drama'], 1), score: 0.9 },
    { movie: film('r2', ['comedy', 'drama'], 1), score: 0.8 },
    { movie: film('r3', ['comedy'], 1), score: 0.7 },
    { movie: film('r4', [], 1), score: 0.6 },
    { movie: film('r5', ['comedy'], 1), score: 0.5 },
  ];
  assert.deepEqual(filterGenreResults(ranked, 'comedy', new Set(['r3'])).map(result => result.movie.id), ['r2', 'r5']);
  assert.deepEqual(filterGenreResults(ranked, 'western', new Set()), []);
});
