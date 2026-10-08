import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  encodeTaste, decodeTaste, shareLink, ID_PREFIX, MAX_FILMS, MAX_PAYLOAD_CHARS,
} from '../src/cowatch.js';

const idOf = number => `${ID_PREFIX}${number}`;
// Deterministic sample ratings with ids of realistic size.
const sample = count => Array.from({ length: count }, (_, i) => ({ id: idOf(104123 + i * 7919 + (i % 3) * 100000000), score: (i * 3) % 10 + 1 }));
const everyId = ratings => new Set(ratings.map(rating => rating.id));
const b64 = text => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('encode then decode returns identical ratings for 1, 10, 15 and 60 films', () => {
  for (const count of [1, 10, 15, 60]) {
    const ratings = sample(count);
    const decoded = decodeTaste(encodeTaste(ratings), everyId(ratings));
    assert.equal(decoded.ok, true, `${count} films`);
    assert.deepEqual(decoded.ratings, ratings, `${count} films`);
    assert.equal(decoded.skipped, 0);
  }
});

test('every rating from 1 to 10 survives, including the ends', () => {
  const ratings = Array.from({ length: 10 }, (_, i) => ({ id: idOf(i + 1), score: i + 1 }));
  assert.deepEqual(decodeTaste(encodeTaste(ratings), everyId(ratings)).ratings, ratings);
});

test('the payload is URL-safe: letters, digits, dash and underscore only, no padding', () => {
  for (const count of [1, 2, 3, 15, 60, 120]) {
    assert.match(encodeTaste(sample(count)), /^[A-Za-z0-9_-]+$/, `${count} films`);
  }
});

test('the largest ids and the order of films are kept', () => {
  const ratings = [{ id: idOf(2147483647), score: 10 }, { id: idOf(1), score: 1 }, { id: idOf(36), score: 5 }];
  assert.deepEqual(decodeTaste(encodeTaste(ratings), everyId(ratings)).ratings, ratings);
});

test('films that are not in the current catalog are skipped and counted', () => {
  const ratings = sample(10);
  const known = everyId(ratings.slice(0, 7));
  const decoded = decodeTaste(encodeTaste(ratings), known);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.skipped, 3);
  assert.deepEqual(decoded.ratings, ratings.slice(0, 7));
});

test('a link whose films are all unknown still decodes, with everything skipped', () => {
  const decoded = decodeTaste(encodeTaste(sample(5)), new Set());
  assert.deepEqual([decoded.ok, decoded.ratings.length, decoded.skipped], [true, 0, 5]);
});

test('without a catalog every film is kept', () => {
  const ratings = sample(4);
  assert.deepEqual(decodeTaste(encodeTaste(ratings)).ratings, ratings);
});

test('malformed input is rejected with a code and never throws', () => {
  const ratings = sample(5);
  const good = encodeTaste(ratings);
  const known = everyId(ratings);
  const cases = {
    empty: ['', 'empty'],
    undefined: [undefined, 'empty'],
    null: [null, 'empty'],
    number: [12345, 'empty'],
    'plain garbage': ['not a payload!!', 'bad-characters'],
    'right characters, not base64 of ours': ['AAAAAAAAAAAA', 'bad-format'],
    truncated: [good.slice(0, good.length - 3), null],
    'one character left over': [good + 'A', null],
    'padding added': [good + '=', 'bad-characters'],
    'standard base64 characters': [good.replace(/-/g, '+') + '/', 'bad-characters'],
    'wrong version': [b64('v2.2fk3'), 'unsupported-version'],
    'no version': [b64('.2fk3'), 'bad-format'],
    'version only': [b64('v1'), 'empty'],
    'no separator': [b64('v12fk3'), 'bad-format'],
    'empty token': [b64('v1..2fk3'), 'bad-format'],
    'upper case id': [b64('v1.2FK3'), 'bad-format'],
    'punctuation in a token': [b64('v1.2f-3'), 'bad-format'],
    'too short token': [b64('v1.5'), 'bad-format'],
    'leading zero id': [b64('v1.02fk3'), 'bad-format'],
    'zero id': [b64('v1.00'), 'bad-format'],
    'id too large': [b64('v1.zzzzzzzz3'), 'bad-format'],
    'duplicate film': [b64('v1.2fk3.2fk5'), 'duplicate'],
    'rating is a letter': [b64('v1.2fka'), 'bad-rating'],
    'oversized text': ['A'.repeat(MAX_PAYLOAD_CHARS + 1), 'too-long'],
  };
  for (const [name, [input, code]] of Object.entries(cases)) {
    let result;
    assert.doesNotThrow(() => { result = decodeTaste(input, known); }, name);
    if (code === null) {
      assert.ok(result.ok === false || result.ratings.length !== ratings.length, `${name} must not decode to the original`);
    } else {
      assert.deepEqual([result.ok, result.error], [false, code], name);
    }
  }
});

test('more films than the limit are rejected both ways', () => {
  const many = Array.from({ length: MAX_FILMS + 1 }, (_, i) => ({ id: idOf(i + 1), score: 5 }));
  assert.throws(() => encodeTaste(many));
  const tokens = many.map(({ id }, i) => `.${(i + 1).toString(36)}4`).join('');
  assert.equal(decodeTaste(b64(`v1${tokens}`)).error, 'too-many');
  assert.equal(decodeTaste(encodeTaste(many.slice(0, MAX_FILMS))).ok, true);
});

test('encoding refuses bad ratings, ids and duplicates', () => {
  assert.throws(() => encodeTaste([]));
  assert.throws(() => encodeTaste(undefined));
  assert.throws(() => encodeTaste([{ id: idOf(1), score: 0 }]));
  assert.throws(() => encodeTaste([{ id: idOf(1), score: 11 }]));
  assert.throws(() => encodeTaste([{ id: idOf(1), score: 5.5 }]));
  assert.throws(() => encodeTaste([{ id: 'Q1', score: 5 }]));
  assert.throws(() => encodeTaste([{ id: `${ID_PREFIX}abc`, score: 5 }]));
  assert.throws(() => encodeTaste([{ id: idOf(1), score: 5 }, { id: idOf(1), score: 6 }]));
});

test('the same ratings always give the same link', () => {
  const ratings = sample(15);
  assert.equal(encodeTaste(ratings), encodeTaste(ratings));
});

test('shareLink puts the payload after #/with/ and drops any old hash', () => {
  assert.equal(shareLink('https://cocinema-pi.vercel.app/src/', 'abc'), 'https://cocinema-pi.vercel.app/src/#/with/abc');
  assert.equal(shareLink('https://cocinema-pi.vercel.app/src/#/movie/Q1', 'abc'), 'https://cocinema-pi.vercel.app/src/#/with/abc');
});

test('real catalog ratings round-trip, and the link length is fine for a messaging app', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const known = new Set(catalog.map(movie => movie.id));
  for (const count of [15, 60]) {
    const ratings = catalog.slice(0, count).map((movie, i) => ({ id: movie.id, score: (i * 7) % 10 + 1 }));
    const payload = encodeTaste(ratings);
    assert.deepEqual(decodeTaste(payload, known).ratings, ratings);
    const link = shareLink('https://cocinema-pi.vercel.app/src/', payload);
    console.log(`  ${count} films: payload ${payload.length} characters, full link ${link.length} characters`);
    assert.ok(link.length < 1000, `${count} films give a ${link.length} character link`);
  }
});
