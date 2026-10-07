import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhyLine, NEUTRAL_LINE } from '../src/why.js';

const part = (title, score, contribution) => ({ id: title, title, score, weight: 0, contribution });

test('one dominant positive title', () => {
  const line = buildWhyLine([part('Alien', 9, 0.4), part('Heat', 5, 0.01)]);
  assert.equal(line, 'Because you rated "Alien" 9.');
});

test('two titles are joined with "and"', () => {
  const line = buildWhyLine([part('A', 9, 0.3), part('B', 10, 0.3), part('C', 8, 0.05)]);
  assert.equal(line, 'Because you rated "A" 9 and "B" 10.');
});

test('three titles use commas and "and", and never more than three', () => {
  const line = buildWhyLine([part('A', 9, 0.1), part('B', 10, 0.1), part('C', 8, 0.1), part('D', 8, 0.1)]);
  assert.equal(line, 'Because you rated "A" 9, "B" 10 and "C" 8.');
});

test('stops once the chosen titles cover most of the positive total', () => {
  // 0.6 of 0.8 is 75%, which is enough, so the small ones are left out.
  const line = buildWhyLine([part('Big', 10, 0.6), part('Small', 7, 0.1), part('Tiny', 7, 0.1)]);
  assert.equal(line, 'Because you rated "Big" 10.');
});

test('adds a held-back note when the biggest negative is meaningful', () => {
  const line = buildWhyLine([part('A', 9, 0.4), part('B', 2, -0.1), part('D', 1, -0.2)]);
  assert.equal(line, 'Because you rated "A" 9; held back by your 1 for "D".');
});

test('no held-back note when the negatives are tiny', () => {
  const line = buildWhyLine([part('A', 9, 0.4), part('D', 2, -0.02)]);
  assert.equal(line, 'Because you rated "A" 9.');
  assert.ok(!line.includes('held back'));
});

test('no positive contributions gives a neutral line, not an empty one', () => {
  assert.equal(buildWhyLine([part('A', 2, -0.3), part('B', 3, 0)]), NEUTRAL_LINE);
  assert.equal(buildWhyLine([]), NEUTRAL_LINE);
  assert.ok(NEUTRAL_LINE.length > 0);
});

test('titles with quotes and markup come through as plain text, unchanged', () => {
  const title = 'Say "Hi" <b>& <script>alert(1)</script>';
  const line = buildWhyLine([part(title, 9, 0.5)]);
  assert.equal(line, `Because you rated "${title}" 9.`);
  assert.equal(typeof line, 'string');
});

test('years are shown next to titles, so two films with one title can be told apart', () => {
  const line = buildWhyLine([
    { id: 'a', title: 'The Lion King', year: 1994, score: 10, contribution: 0.3 },
    { id: 'b', title: 'The Lion King', year: 2019, score: 9, contribution: 0.3 },
    { id: 'c', title: 'Heat', year: 1995, score: 2, contribution: -0.2 },
  ]);
  assert.equal(line, 'Because you rated "The Lion King (1994)" 10 and "The Lion King (2019)" 9; held back by your 2 for "Heat (1995)".');
});
