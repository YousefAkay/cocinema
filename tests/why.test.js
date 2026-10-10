import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhyLine, buildWhyLines, hashId, endingOf, NEUTRAL_LINE, HELD_BACK_SHARE, MAX_HELD_BACK_CARDS, TEMPLATES } from '../src/why.js';

const part = (title, score, contribution, year) => ({ id: `id-${title}`, title, year, score, weight: 0, contribution });
const count = (text, needle) => text.split(needle).length - 1;

test('one dominant positive title is named with the score given', () => {
  const line = buildWhyLine([part('Alien', 9, 0.4), part('Heat', 5, 0.01)], 'film-1');
  assert.ok(line.includes('Alien') && /\b9\b/.test(line));
  assert.ok(!line.includes('Heat'));
});

test('two titles are named once the first does not cover most of the positive total', () => {
  const line = buildWhyLine([part('A', 9, 0.3), part('B', 10, 0.3), part('C', 8, 0.05)], 'film-2');
  assert.ok(line.includes('A') && line.includes('B') && !/\bC\b/.test(line));
  assert.ok(/\b9\b/.test(line) && /\b10\b/.test(line) && !/\b8\b/.test(line));
});

test('never more than three titles, and none beyond the point where most of the positive total is covered', () => {
  const line = buildWhyLine([part('A', 9, 0.1), part('B', 10, 0.1), part('C', 8, 0.1), part('D', 8, 0.1)], 'film-3');
  assert.ok(line.includes('A') && line.includes('B') && line.includes('C'));
  assert.ok(!/\bD\b/.test(line));
  const stops = buildWhyLine([part('Big', 10, 0.6), part('Small', 7, 0.1), part('Tiny', 7, 0.1)], 'film-4');
  assert.ok(stops.includes('Big') && !stops.includes('Small') && !stops.includes('Tiny'));
});

test('the same film always gets the same wording, whatever else happens', () => {
  const input = [part('A', 9, 0.4), part('B', 8, 0.3), part('C', 7, 0.2), part('D', 2, -0.05)];
  const first = buildWhyLine(input, 'http://www.wikidata.org/entity/Q42');
  for (let i = 0; i < 5; i++) {
    assert.equal(buildWhyLine(input, 'http://www.wikidata.org/entity/Q42'), first);
    assert.equal(buildWhyLine(input.map(item => ({ ...item })), 'http://www.wikidata.org/entity/Q42', new Set()), first);
  }
  assert.equal(hashId('Q42'), hashId('Q42'));
  assert.notEqual(hashId('Q42'), hashId('Q43'));
});

test('different films are worded differently: the wording follows the film id', () => {
  const input = [part('A', 9, 0.4), part('B', 8, 0.3), part('C', 7, 0.2)];
  const lines = new Set();
  for (let i = 0; i < 40; i++) lines.add(buildWhyLine(input, `film-${i}`));
  assert.ok(lines.size >= 5, `only ${lines.size} wordings in 40 films`);
});

// The opening of the template that produced this line for a given set of contributions.
function openingOfLine(line, shape) {
  const positives = shape.filter(item => item.contribution > 0);
  const total = positives.reduce((sum, item) => sum + item.contribution, 0);
  const chosen = [];
  let running = 0;
  for (const item of positives) {
    chosen.push(item);
    running += item.contribution;
    if (chosen.length === 3 || running >= 0.7 * total) break;
  }
  const names = chosen.map(item => ({ name: item.title, score: item.score }));
  return TEMPLATES[names.length].find(template => template.build(names) === line).opening;
}

test('a list of five lines never repeats an opening, for one, two and three titles', () => {
  const shapes = [
    [part('A', 9, 0.9), part('B', 5, 0.01)],
    [part('A', 9, 0.4), part('B', 10, 0.4), part('C', 5, 0.01)],
    [part('A', 9, 0.2), part('B', 10, 0.2), part('C', 8, 0.2), part('D', 7, 0.2)],
  ];
  for (const shape of shapes) {
    const items = Array.from({ length: 5 }, (_, index) => ({ id: `card-${index}`, contributions: shape }));
    const lines = buildWhyLines(items);
    assert.equal(lines.length, 5);
    assert.equal(new Set(lines).size, 5, 'all five lines are different');
    const openings = lines.map(line => openingOfLine(line, shape));
    assert.equal(new Set(openings).size, 5, `openings used: ${openings}`);
  }
});

test('the held-back film is named only when its negative pull is a large share of the positive pull', () => {
  assert.equal(HELD_BACK_SHARE, 0.25);
  const base = [part('A', 9, 0.4)];
  const atThreshold = buildWhyLine([...base, part('Dull', 2, -0.1)], 'film-5'); // 0.1 / 0.4 = 0.25
  assert.ok(atThreshold.includes('Dull') && /\b2\b/.test(atThreshold) && atThreshold.includes('your 2 for Dull') || atThreshold.includes('Your 2 for Dull'));
  const justBelow = buildWhyLine([...base, part('Dull', 2, -0.0999)], 'film-5');
  assert.ok(!justBelow.includes('Dull'));
  const tiny = buildWhyLine([...base, part('Dull', 2, -0.02)], 'film-5');
  assert.ok(!tiny.includes('Dull'));
});

test('when several rated films pull a pick down, only the strongest one is named', () => {
  const line = buildWhyLine([part('A', 9, 0.4), part('B', 2, -0.1), part('C', 1, -0.2)], 'film-6');
  assert.ok(line.includes('for C') && !line.includes('B'));
  assert.ok(/\b1\b/.test(line));
});

test('with no positive contribution the line is the neutral one', () => {
  assert.equal(buildWhyLine([part('A', 2, -0.3), part('B', 3, 0)], 'film-7'), NEUTRAL_LINE);
  assert.equal(buildWhyLine([], 'film-7'), NEUTRAL_LINE);
});

test('every film and number in a line comes from the real contribution data', () => {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 300; run++) {
    const size = 1 + Math.floor(random() * 6);
    const contributions = [];
    for (let i = 0; i < size; i++) {
      const sign = random() < 0.7 ? 1 : -1;
      contributions.push(part(`Film ${run}-${i}`, 1 + Math.floor(random() * 10), sign * (0.01 + random() * 0.5)));
    }
    contributions.sort((a, b) => b.contribution - a.contribution);
    const line = buildWhyLine(contributions, `film-${run}`);
    if (!contributions.some(item => item.contribution > 0)) {
      assert.equal(line, NEUTRAL_LINE);
      continue;
    }
    const mentioned = [...line.matchAll(/Film \d+-\d+/g)].map(match => match[0]);
    const named = contributions.filter(item => mentioned.includes(item.title));
    // every title in the line is one that was rated
    assert.ok(mentioned.every(title => contributions.some(item => item.title === title)), line);
    // every number in the line is the score of a film named in it
    const numbers = [...line.replace(/Film \d+-\d+/g, '').matchAll(/\b\d+\b/g)].map(match => Number(match[0]));
    const scoresNamed = new Set(contributions.filter(item => mentioned.includes(item.title)).map(item => item.score));
    assert.ok(numbers.every(number => scoresNamed.has(number)), line);
    // the strongest contributor is always the first film named
    assert.equal(mentioned[0], contributions[0].title, line);
    // a named film that pulled the pick down is only ever the held-back film, and only past the threshold
    const positiveTotal = contributions.filter(item => item.contribution > 0).reduce((sum, item) => sum + item.contribution, 0);
    for (const item of named.filter(entry => entry.contribution < 0)) {
      assert.ok(-item.contribution >= HELD_BACK_SHARE * positiveTotal, line);
    }
    assert.ok(named.length >= 1);
  }
});

test('titles with quotes and markup come through as plain text, unchanged', () => {
  const title = '"><img src=x onerror=alert(1)> & <b>Bold</b>';
  const line = buildWhyLine([part(title, 9, 0.5)], 'film-8');
  assert.ok(line.includes(title));
});

test('a year is added only when two rated films in play share a title', () => {
  const alone = buildWhyLine([part('Heat', 9, 0.5, 1995)], 'film-9');
  assert.ok(!alone.includes('1995'));
  const twins = buildWhyLine([part('Heat', 9, 0.4, 1995), part('Heat', 8, 0.35, 1986)], 'film-9');
  assert.ok(twins.includes('Heat (1995)') && twins.includes('Heat (1986)'));
});

test('lines stay short enough for a card: at most one sentence plus the held-back note', () => {
  for (const key of Object.keys(TEMPLATES)) {
    const names = Array.from({ length: Number(key) }, (_, i) => ({ name: `Name ${i}`, score: 10 }));
    for (const template of TEMPLATES[key]) {
      const text = template.build(names);
      assert.equal(count(text, '. '), 0, text);
      assert.ok(text.length <= 130, `${text.length}: ${text}`);
    }
  }
});

test('every count of titles has several templates with different openings', () => {
  for (const key of Object.keys(TEMPLATES)) {
    const openings = TEMPLATES[key].map(template => template.opening);
    assert.ok(new Set(openings).size >= 5 && new Set(openings).size === openings.length, `${key}: ${openings}`);
  }
});

// ---- One low rating that drags down every pick: the clause goes on at most two cards

// Five picks that all like the same films and are all pulled down by the same low rating, each by
// a different amount: share is the pull of "Low" as a fraction of the positive total (0.4 + 0.2).
function dragged(shares) {
  return shares.map((share, index) => ({
    id: `pick-${index}`,
    contributions: [part('Heat', 9, 0.4), part('Alien', 8, 0.2), part('Low', 2, -share * 0.6)],
  }));
}
const carries = line => line.includes('Low');

test('when one low rating drags down all five picks, the clause is on at most two cards', () => {
  const lines = buildWhyLines(dragged([0.9, 0.5, 0.6, 0.3, 0.4]));
  assert.ok(lines.filter(carries).length <= MAX_HELD_BACK_CARDS);
  assert.equal(MAX_HELD_BACK_CARDS, 2);
  assert.equal(lines.filter(carries).length, 2);
});

test('the cards that carry the clause are the ones with the largest negative share', () => {
  const lines = buildWhyLines(dragged([0.3, 0.9, 0.4, 0.6, 0.3]));
  assert.deepEqual(lines.map(carries), [false, true, false, true, false]);
});

test('equal shares go to the higher ranks', () => {
  const lines = buildWhyLines(dragged([0.5, 0.5, 0.5, 0.5, 0.5]));
  assert.deepEqual(lines.map(carries), [true, true, false, false, false]);
});

test('a card under the threshold never carries the clause, even when it is among the largest', () => {
  const lines = buildWhyLines(dragged([0.1, 0.2, 0.05, 0.249, 0.1]));
  assert.ok(lines.every(line => !carries(line)));
  const one = buildWhyLines(dragged([0.1, 0.2, 0.3, 0.1, 0.1]));
  assert.deepEqual(one.map(carries), [false, false, true, false, false]);
});

test('with no large negative, no card carries a clause', () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: `pick-${index}`, contributions: [part('Heat', 9, 0.4), part('Low', 2, -0.01)] }));
  assert.ok(buildWhyLines(items).every(line => !carries(line)));
});

test('no two cards open or end alike, including the held-back wording', () => {
  for (const shares of [[0.9, 0.5, 0.6, 0.3, 0.4], [0.5, 0.5, 0.5, 0.5, 0.5], [0.9, 0.9, 0.1, 0.1, 0.1]]) {
    const lines = buildWhyLines(dragged(shares));
    assert.equal(new Set(lines.map(endingOf)).size, 5, lines.join(' / '));
    assert.equal(new Set(lines).size, 5);
  }
});

test('the two clauses in one list are worded differently', () => {
  const lines = buildWhyLines(dragged([0.9, 0.8, 0.1, 0.1, 0.1])).filter(carries);
  assert.equal(lines.length, 2);
  const clause = line => line.slice(line.search(/(Your|Only|The one|Low)[^.]*Low|The one drag/));
  assert.notEqual(endingOf(lines[0]), endingOf(lines[1]));
  assert.notEqual(clause(lines[0]), clause(lines[1]));
});

test('the same input gives the same five lines every time', () => {
  const first = buildWhyLines(dragged([0.9, 0.5, 0.6, 0.3, 0.4]));
  for (let i = 0; i < 5; i++) assert.deepEqual(buildWhyLines(dragged([0.9, 0.5, 0.6, 0.3, 0.4])), first);
});

test('every film and number in a list of lines comes from each card\'s own contribution data', () => {
  let seed = 11;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 60; run++) {
    const items = Array.from({ length: 5 }, (_, card) => {
      const size = 2 + Math.floor(random() * 5);
      const contributions = Array.from({ length: size }, (_, i) => part(`Film ${run}-${i}`, 1 + Math.floor(random() * 10), (random() < 0.65 ? 1 : -1) * (0.02 + random() * 0.5)));
      contributions.sort((a, b) => b.contribution - a.contribution);
      return { id: `run-${run}-card-${card}`, contributions };
    });
    const lines = buildWhyLines(items);
    assert.ok(lines.filter((line, i) => items[i].contributions.some(item => item.contribution < 0) && /held|drag|other way|Only your/.test(line)).length <= MAX_HELD_BACK_CARDS);
    lines.forEach((line, i) => {
      if (line === NEUTRAL_LINE) return;
      const mentioned = [...line.matchAll(/Film \d+-\d+/g)].map(match => match[0]);
      const data = items[i].contributions;
      assert.ok(mentioned.every(title => data.some(item => item.title === title)), line);
      const numbers = [...line.replace(/Film \d+-\d+/g, '').matchAll(/\b\d+\b/g)].map(match => Number(match[0]));
      const scores = new Set(data.filter(item => mentioned.includes(item.title)).map(item => item.score));
      assert.ok(numbers.every(number => scores.has(number)), line);
    });
  }
});
