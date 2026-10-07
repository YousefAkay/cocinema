import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recommend, explainMatch } from '../src/recommend.js';

// Same toy catalog as recommend.test.js (see the hand calculation there).
const toy = [
  { id: 'r1', title: 'R1', embedding: [1, 0, 0] },
  { id: 'r2', title: 'R2', embedding: [0, 1, 0] },
  { id: 'r3', title: 'R3', embedding: [0, 0, 1] },
  { id: 'c1', title: 'C1', embedding: [1, 1, 0] },
  { id: 'c2', title: 'C2', embedding: [1, 1, -1] },
  { id: 'c3', title: 'C3', embedding: [0, 0, 1] },
];
const toyRatings = [
  { id: 'r1', score: 9 },
  { id: 'r2', score: 9 },
  { id: 'r3', score: 2 },
];

const sum = values => values.reduce((total, value) => total + value, 0);

/*
 * Hand calculation for c2 = [1, 1, -1]. Weights are +7/3, +7/3, -14/3 and the profile is
 * [7/3, 7/3, -14/3], length (7/3) * sqrt(6). |c2| = sqrt(3). So the denominator is
 * (7/3) * sqrt(18) = (7/3) * 4.243 = 9.899.
 *   r1: (7/3) * dot([1,0,0], c2) = (7/3) * 1  =  2.333  ->  0.2357
 *   r2: (7/3) * dot([0,1,0], c2) = (7/3) * 1  =  2.333  ->  0.2357
 *   r3: (-14/3) * dot([0,0,1], c2) = (-14/3) * -1 = 4.667 ->  0.4714
 * Total 0.9428, the same as the match score of c2.
 */
test('contributions for c2 match the hand calculation and add up to its score', () => {
  const parts = explainMatch('c2', toyRatings, toy);
  assert.equal(parts[0].id, 'r3'); // the biggest contribution comes first
  assert.deepEqual(parts.map(p => p.id).sort(), ['r1', 'r2', 'r3']);
  const byId = Object.fromEntries(parts.map(p => [p.id, p.contribution]));
  assert.ok(Math.abs(byId.r1 - 0.2357) < 1e-3);
  assert.ok(Math.abs(byId.r2 - 0.2357) < 1e-3);
  assert.ok(Math.abs(byId.r3 - 0.4714) < 1e-3);
  assert.ok(Math.abs(sum(parts.map(p => p.contribution)) - 0.9428) < 1e-3);
});

test('on the toy catalog, contributions add up to every recommended movie\'s score', () => {
  for (const { movie, score } of recommend(toyRatings, toy, 10)) {
    const total = sum(explainMatch(movie.id, toyRatings, toy).map(p => p.contribution));
    assert.ok(Math.abs(total - score) < 1e-9, `${movie.id}: ${total} vs ${score}`);
  }
});

test('contributions are sorted from largest positive to most negative', () => {
  for (const movieId of ['c1', 'c2', 'c3']) {
    const values = explainMatch(movieId, toyRatings, toy).map(p => p.contribution);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
  }
  // c3 points the opposite way to the dislike, so its biggest part is negative-heavy.
  const c3 = explainMatch('c3', toyRatings, toy);
  assert.equal(c3[c3.length - 1].id, 'r3');
  assert.ok(c3[c3.length - 1].contribution < 0);
});

test('each part carries the title, the rating and the weight', () => {
  const part = explainMatch('c1', toyRatings, toy).find(p => p.id === 'r3');
  assert.equal(part.title, 'R3');
  assert.equal(part.score, 2);
  assert.ok(Math.abs(part.weight - (2 - 20 / 3)) < 1e-9);
});

test('on 20 real catalog movies, contributions add up to the match score', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const ratings = [3, 40, 77, 120, 200, 260, 333, 410]
    .map((index, i) => ({ id: catalog[index].id, score: [9, 10, 2, 8, 3, 6, 9, 1][i] }));
  const rated = new Set(ratings.map(r => r.id));

  const sample = catalog.filter((movie, index) => index % 29 === 5 && !rated.has(movie.id)).slice(0, 20);
  assert.equal(sample.length, 20);

  const scores = new Map(recommend(ratings, catalog, catalog.length).map(r => [r.movie.id, r.score]));
  for (const movie of sample) {
    const parts = explainMatch(movie.id, ratings, catalog);
    assert.equal(parts.length, ratings.length);
    const values = parts.map(p => p.contribution);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
    assert.ok(Math.abs(sum(values) - scores.get(movie.id)) < 1e-9, movie.title);
  }
});

test('an already-rated movie returns []', () => {
  assert.deepEqual(explainMatch('r1', toyRatings, toy), []);
});

test('an unknown movie returns []', () => {
  assert.deepEqual(explainMatch('nope', toyRatings, toy), []);
});

test('fewer than 3 usable ratings returns []', () => {
  assert.deepEqual(explainMatch('c2', toyRatings.slice(0, 2), toy), []);
  assert.deepEqual(explainMatch('c2', [], toy), []);
});

test('a zero profile (all ratings equal) returns []', () => {
  const same = toyRatings.map(r => ({ ...r, score: 7 }));
  assert.deepEqual(explainMatch('c2', same, toy), []);
});
