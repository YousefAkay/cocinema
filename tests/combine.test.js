import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { combineTastes } from '../src/combine.js';
import { recommend } from '../src/recommend.js';
import { percentileRank, topPercent } from '../src/percentile.js';

const movie = (id, embedding, title = id) => ({ id: `http://www.wikidata.org/entity/Q${id}`, title, embedding });
const idOf = number => `http://www.wikidata.org/entity/Q${number}`;

/*
 * Toy catalog, 3-dimensional embeddings. Axes: x = action, y = romance, z = horror.
 *
 * Person A rates action films high and horror low, and likes romance a little.
 * Person B rates romance films high and horror low, and likes action a little.
 * Rated films (6 to 9) are shared anchors; the candidates are the films 20 and up.
 *
 *   20 "Both mild"  [1, 1, 0]    some action, some romance
 *   21 "A only"     [1, 0, 0]    pure action
 *   22 "B only"     [0, 1, 0]    pure romance
 *   23 "Scary"      [0, 0, 1]    pure horror
 *
 * "A only" is loved by A and merely tolerated by B, so it should rank below "Both mild".
 */
const catalog = [
  movie(6, [1, 0, 0], 'Anchor action'),
  movie(7, [0, 1, 0], 'Anchor romance'),
  movie(8, [0, 0, 1], 'Anchor horror'),
  movie(9, [0.5, 0.5, 0], 'Anchor mix'),
  movie(20, [1, 1, 0], 'Both mild'),
  movie(21, [1, 0, 0], 'A only'),
  movie(22, [0, 1, 0], 'B only'),
  movie(23, [0, 0, 1], 'Scary'),
];
const personA = [{ id: idOf(6), score: 10 }, { id: idOf(7), score: 6 }, { id: idOf(8), score: 1 }];
const personB = [{ id: idOf(6), score: 6 }, { id: idOf(7), score: 10 }, { id: idOf(8), score: 1 }];

test('a film one person loves and the other merely tolerates ranks below a film both like', () => {
  // Candidates exclude every film either person rated (6, 7 and 8), leaving 9, 20, 21, 22, 23.
  const { problem, results } = combineTastes(catalog, personA, personB);
  assert.equal(problem, null);
  const order = results.map(result => result.movie.title);
  assert.ok(order.indexOf('Both mild') < order.indexOf('A only'), order.join(', '));
  assert.ok(order.indexOf('Both mild') < order.indexOf('B only'), order.join(', '));
  assert.equal(order[order.length - 1], 'Scary');
});

test('swapping the two people gives the same list', () => {
  const forward = combineTastes(catalog, personA, personB).results.map(result => result.movie.id);
  const backward = combineTastes(catalog, personB, personA).results.map(result => result.movie.id);
  assert.deepEqual(forward, backward);
});

test('swapping the two people swaps the two percentages', () => {
  const forward = combineTastes(catalog, personA, personB).results;
  const backward = combineTastes(catalog, personB, personA).results;
  forward.forEach((result, index) => {
    assert.equal(result.percentA, backward[index].percentB);
    assert.equal(result.percentB, backward[index].percentA);
  });
});

test('films either person rated never appear', () => {
  const rated = new Set([...personA, ...personB].map(rating => rating.id));
  const results = combineTastes(catalog, personA, personB, 50).results;
  assert.ok(results.length > 0);
  assert.ok(results.every(result => !rated.has(result.movie.id)));
  // A film only the friend rated is also left out.
  const withFriendFilm = combineTastes(catalog, personA, [...personB, { id: idOf(9), score: 8 }], 50).results;
  assert.ok(!withFriendFilm.some(result => result.movie.id === idOf(9)));
});

test('n limits the list', () => {
  assert.equal(combineTastes(catalog, personA, personB, 2).results.length, 2);
  assert.equal(combineTastes(catalog, personA, personB, 0).results.length, 0);
});

test('each result carries both people\'s "Top N%" figures', () => {
  for (const result of combineTastes(catalog, personA, personB).results) {
    assert.ok(Number.isInteger(result.percentA) && result.percentA >= 1 && result.percentA <= 100);
    assert.ok(Number.isInteger(result.percentB) && result.percentB >= 1 && result.percentB <= 100);
  }
});

test('a person who cannot make a profile is reported, with no results', () => {
  assert.deepEqual(combineTastes(catalog, personA.slice(0, 2), personB), { problem: 'a', results: [] });
  assert.deepEqual(combineTastes(catalog, personA, personB.slice(0, 2)), { problem: 'b', results: [] });
  assert.deepEqual(combineTastes(catalog, personA, personB.map(rating => ({ ...rating, score: 7 }))), { problem: 'b', results: [] });
  assert.equal(combineTastes(catalog, [], []).problem, 'a');
});

test('the order does not depend on the order of the catalog', () => {
  const shuffled = [...catalog].reverse();
  const first = combineTastes(catalog, personA, personB).results.map(result => result.movie.id);
  const second = combineTastes(shuffled, personA, personB).results.map(result => result.movie.id);
  assert.deepEqual(first, second);
});

test('identical profiles reproduce the solo ranking on the real catalog', () => {
  const real = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const ratings = [3, 40, 77, 120, 200, 260, 333, 410].map((index, i) => ({ id: real[index].id, score: [9, 10, 2, 8, 3, 6, 9, 1][i] }));
  const solo = recommend(ratings, real, 10).map(result => result.movie.id);
  const together = combineTastes(real, ratings, ratings, 10).results.map(result => result.movie.id);
  assert.deepEqual(together, solo);
  // and both people see the same figures
  for (const result of combineTastes(real, ratings, ratings, 10).results) {
    assert.equal(result.percentA, result.percentB);
  }
});

test('on the real catalog two different tastes give a list neither person rated, in a stable order', () => {
  const real = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const byTitle = title => real.find(film => film.title === title).id;
  const a = [['Alien', 10], ['The Matrix', 9], ['Interstellar', 9], ['Titanic', 2], ['The Notebook', 2], ['Superbad', 5]].map(([title, score]) => ({ id: byTitle(title), score }));
  const b = [['Titanic', 10], ['The Notebook', 10], ['La La Land', 9], ['Alien', 2], ['The Matrix', 3], ['Superbad', 6]].map(([title, score]) => ({ id: byTitle(title), score }));
  const first = combineTastes(real, a, b, 10);
  assert.equal(first.results.length, 10);
  const rated = new Set([...a, ...b].map(rating => rating.id));
  assert.ok(first.results.every(result => !rated.has(result.movie.id)));
  assert.deepEqual(first.results.map(result => result.movie.id), combineTastes(real, a, b, 10).results.map(result => result.movie.id));
  assert.deepEqual(first.results.map(result => result.movie.id), combineTastes([...real].reverse(), a, b, 10).results.map(result => result.movie.id));
});

test('percentileRank is the unrounded share, and topPercent is unchanged', () => {
  assert.equal(percentileRank(0.9, [0.9, 0.5, 0.1]), 1 / 3);
  assert.equal(percentileRank(0.1, [0.9, 0.5, 0.1]), 1);
  assert.equal(percentileRank(0.5, [0.5, 0.5, 0.1]), 1 / 3);
  assert.equal(percentileRank(0.3, []), null);
  assert.equal(topPercent(0.995, Array.from({ length: 200 }, (_, i) => i / 200)), 1);
  assert.equal(topPercent(0.5, Array.from({ length: 100 }, (_, i) => i / 100)), 50);
});
