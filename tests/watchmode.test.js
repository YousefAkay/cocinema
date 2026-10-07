import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMatch, summariseSources, emptyAvailability } from '../scripts/watchmode.js';

const movie = { title: 'The Lion King', year: 2019 };
const result = (name, year, extra = {}) => ({ id: 1, name, year, type: 'movie', imdb_id: 'tt1', tmdb_id: 2, ...extra });

test('pickMatch accepts an exact name with the year within 1', () => {
  assert.equal(pickMatch([result('The Lion King', 2019)], movie).year, 2019);
  assert.equal(pickMatch([result('The Lion King', 2020)], movie).year, 2020);
  assert.equal(pickMatch([result('The Lion King', 2018)], movie).year, 2018);
});

test('pickMatch rejects the wrong year, so the 1994 film is not taken for the 2019 one', () => {
  assert.equal(pickMatch([result('The Lion King', 1994)], movie), null);
  assert.equal(pickMatch([result('The Lion King', 2022)], movie), null);
});

test('pickMatch takes the closest year when several results fit', () => {
  const picked = pickMatch([result('The Lion King', 2018), result('The Lion King', 2019), result('The Lion King', 1994)], movie);
  assert.equal(picked.year, 2019);
});

test('pickMatch ignores case and punctuation but not different titles', () => {
  assert.ok(pickMatch([result('the lion king!', 2019)], movie));
  assert.equal(pickMatch([result('The Lion King 2', 2019)], movie), null);
  assert.equal(pickMatch([result('Lion King', 2019)], movie), null);
});

test('pickMatch copes with missing or odd results', () => {
  assert.equal(pickMatch([], movie), null);
  assert.equal(pickMatch(undefined, movie), null);
  assert.equal(pickMatch([null, {}, { name: 5, year: 2019 }, { name: 'The Lion King' }], movie), null);
});

const rows = [
  { source_id: 1, name: 'Netflix', type: 'sub', region: 'US', price: null, web_url: 'http://x' },
  { source_id: 2, name: 'Netflix', type: 'sub', region: 'US' },
  { source_id: 3, name: 'Apple TV', type: 'rent', region: 'US', price: 3.99 },
  { source_id: 3, name: 'Apple TV', type: 'buy', region: 'US', price: 9.99 },
  { source_id: 4, name: 'Crave', type: 'sub', region: 'CA' },
  { source_id: 5, name: 'Pluto TV', type: 'free', region: 'US' },
  { source_id: 6, name: 'Hulu Live', type: 'tve', region: 'US' },
  { source_id: 7, name: '', type: 'sub', region: 'GB' },
  { source_id: 8, type: 'rent', region: 'GB' },
  { source_id: 9, name: '  BFI Player ', type: 'rent', region: 'GB' },
  { source_id: 10, name: 'Elsewhere', type: 'sub', region: 'DE' },
];

test('summariseSources keeps subscription and rent-or-buy names per country, de-duplicated and sorted', () => {
  assert.deepEqual(summariseSources(rows), {
    CA: { subscription: ['Crave'], rentOrBuy: [] },
    US: { subscription: ['Netflix'], rentOrBuy: ['Apple TV'] },
    GB: { subscription: [], rentOrBuy: ['BFI Player'] },
  });
});

test('summariseSources skips unnamed rows, other types and other countries', () => {
  const text = JSON.stringify(summariseSources(rows));
  for (const left of ['Pluto TV', 'Hulu Live', 'Elsewhere']) assert.ok(!text.includes(left), left);
});

test('summariseSources stores names only: no ids, prices, links or external ids', () => {
  const text = JSON.stringify(summariseSources(rows));
  assert.ok(!/source_id|price|url|imdb|tmdb|3\.99|9\.99/.test(text));
  assert.deepEqual(Object.keys(summariseSources(rows).US).sort(), ['rentOrBuy', 'subscription']);
});

test('summariseSources handles empty or invalid input as empty lists', () => {
  const empty = { CA: { subscription: [], rentOrBuy: [] }, US: { subscription: [], rentOrBuy: [] }, GB: { subscription: [], rentOrBuy: [] } };
  assert.deepEqual(summariseSources([]), empty);
  assert.deepEqual(summariseSources(undefined), empty);
  assert.deepEqual(summariseSources({ error: 'nope' }), empty);
});

test('emptyAvailability marks a film as stored but without sources', () => {
  assert.deepEqual(emptyAvailability(false), {
    matched: false,
    CA: { subscription: [], rentOrBuy: [] },
    US: { subscription: [], rentOrBuy: [] },
    GB: { subscription: [], rentOrBuy: [] },
  });
});
