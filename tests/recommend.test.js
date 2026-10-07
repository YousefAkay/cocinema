import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/recommend.js';

/*
 * Toy catalog with 3-dimensional embeddings.
 *
 *   r1 [1, 0, 0]   rated 9
 *   r2 [0, 1, 0]   rated 9
 *   r3 [0, 0, 1]   rated 2
 *   c1 [1, 1, 0]   unrated
 *   c2 [1, 1, -1]  unrated
 *   c3 [0, 0, 1]   unrated
 *
 * Mean-centring: average = (9 + 9 + 2) / 3 = 6.667, so the weights are
 *   r1: +2.333, r2: +2.333, r3: -4.667
 * Profile = 2.333*[1,0,0] + 2.333*[0,1,0] - 4.667*[0,0,1] = [2.333, 2.333, -4.667].
 * Cosine similarity ignores scale, so use the proportional vector [1, 1, -2]
 * (the profile divided by 2.333). Its length is sqrt(1 + 1 + 4) = sqrt(6) = 2.449.
 *
 *   c1: dot = 1 + 1 + 0 = 2,   |c1| = sqrt(2) = 1.414  ->  2 / (2.449 * 1.414) =  0.577
 *   c2: dot = 1 + 1 + 2 = 4,   |c2| = sqrt(3) = 1.732  ->  4 / (2.449 * 1.732) =  0.943
 *   c3: dot = 0 + 0 - 2 = -2,  |c3| = 1                ->  -2 / 2.449          = -0.816
 *
 * Expected ranking: c2 (0.943), c1 (0.577), c3 (-0.816).
 */
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

test('the toy catalog ranks c2, c1, c3 with the hand-calculated scores', () => {
  const ranked = recommend(toyRatings, toy, 10);
  assert.deepEqual(ranked.map(r => r.movie.id), ['c2', 'c1', 'c3']);
  const expected = [0.9428, 0.5774, -0.8165];
  ranked.forEach((r, i) => assert.ok(Math.abs(r.score - expected[i]) < 1e-3, `${r.movie.id}: ${r.score}`));
});

test('fewer than 3 usable ratings gives []', () => {
  assert.deepEqual(recommend(toyRatings.slice(0, 2), toy, 10), []);
  assert.deepEqual(recommend([], toy, 10), []);
});

test('ratings for movies missing from the catalog do not count as usable', () => {
  const ratings = [...toyRatings.slice(0, 2), { id: 'not-in-catalog', score: 5 }];
  assert.deepEqual(recommend(ratings, toy, 10), []);
});

test('all ratings equal (zero profile after mean-centring) gives []', () => {
  const same = toyRatings.map(r => ({ ...r, score: 7 }));
  assert.deepEqual(recommend(same, toy, 10), []);
});

test('already-rated movies never appear in the output', () => {
  const ranked = recommend(toyRatings, toy, 10);
  const rated = new Set(toyRatings.map(r => r.id));
  assert.ok(ranked.every(r => !rated.has(r.movie.id)));
});

test('results are sorted by descending score', () => {
  const scores = recommend(toyRatings, toy, 10).map(r => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('n limits the number of results', () => {
  assert.equal(recommend(toyRatings, toy, 2).length, 2);
  assert.equal(recommend(toyRatings, toy, 1)[0].movie.id, 'c2');
  assert.equal(recommend(toyRatings, toy, 0).length, 0);
});

test('a lower score pushes the profile away from that movie', () => {
  // Rating r3 high instead of low flips the z direction, so c3 should now rank first.
  const flipped = [{ id: 'r1', score: 2 }, { id: 'r2', score: 2 }, { id: 'r3', score: 9 }];
  assert.equal(recommend(flipped, toy, 10)[0].movie.id, 'c3');
});
