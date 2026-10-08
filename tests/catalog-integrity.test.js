import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeEntities } from '../scripts/matching.js';
import { directorsAgree, runtimesAgree } from '../scripts/crossCheckWikidata.js';

const readJson = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalog = readJson('../data/catalog.json');
const progress = readJson('../data/verify-progress.json');
const overrides = readJson('../data/overrides.json');
const idFixes = readJson('../data/id-fixes.json');
const availability = readJson('../data/availability.json');
const byId = new Map(catalog.map(movie => [movie.id, movie]));
const short = id => id.slice(id.lastIndexOf('/') + 1);

test('decodeEntities turns HTML entities into the characters they stand for', () => {
  assert.equal(decodeEntities("d&apos;Abbadie"), "d'Abbadie");
  assert.equal(decodeEntities('Pacific Gas &amp; Electric'), 'Pacific Gas & Electric');
  assert.equal(decodeEntities('&quot;Hi&quot; &lt;b&gt; &#39;x&#x27; &#233;'), '"Hi" <b> \'x\' é');
  assert.equal(decodeEntities('nothing to change & fine'), 'nothing to change & fine');
  assert.equal(decodeEntities(null), null);
  assert.equal(decodeEntities(undefined), undefined);
});

test('directorsAgree compares family names, ignores accents and spelling of first names', () => {
  assert.equal(directorsAgree('Alejandro G. Iñárritu', 'Alejandro González Iñárritu'), true);
  assert.equal(directorsAgree('Kátia Lund, Fernando Meirelles', 'Fernando Meirelles / Kátia Lund'), true);
  assert.equal(directorsAgree('Peter Jackson', 'Merian C. Cooper / Ernest B. Schoedsack'), false);
  assert.equal(directorsAgree('Walter Lang', 'Richard Rich'), false);
  assert.equal(directorsAgree(null, 'Anyone'), true);
  assert.equal(directorsAgree('Anyone', ''), true);
  assert.equal(directorsAgree("William A. Wellman, Harry d&apos;Abbadie d&apos;Arrast", "William A. Wellman / Harry d'Abbadie d'Arrast"), true);
});

test('runtimesAgree allows cuts of a different length up to 20 minutes, and skips missing data', () => {
  assert.equal(runtimesAgree('156 min', 157), true);
  assert.equal(runtimesAgree('187 min', 100), false);
  assert.equal(runtimesAgree('180 min', 190), true);
  assert.equal(runtimesAgree(null, 100), true);
  assert.equal(runtimesAgree('100 min', null), true);
  assert.equal(runtimesAgree('N/A', 100), true);
});

test('every override is for a film in the catalog, uses known options, and explains itself', () => {
  const known = new Set(['omdbTitle', 'omdbYear', 'refreshMeta', 'allowMissingScore', 'acceptStored', 'note']);
  for (const [id, override] of Object.entries(overrides)) {
    assert.ok(byId.has(id), `${short(id)} is not in the catalog`);
    assert.ok(Object.keys(override).every(key => known.has(key)), `${short(id)} uses an unknown option`);
    assert.ok(typeof override.note === 'string' && override.note.length > 20, `${short(id)} needs a note saying why`);
    if (override.acceptStored) {
      assert.ok(/Wikidata|plot/.test(override.note), `${short(id)} is accepted by hand, so its note must give the evidence`);
    }
  }
});

test('the ids that were wrong are gone and their replacements are in', () => {
  for (const [from, { to, note }] of Object.entries(idFixes)) {
    assert.ok(!byId.has(from), `${short(from)} should have been replaced`);
    assert.ok(byId.has(to), `${short(to)} should be in the catalog`);
    assert.ok(note.length > 20);
    assert.ok(!(from in progress) && !(from in availability.films), `${short(from)} still appears in the progress or availability file`);
  }
  assert.equal(byId.get('http://www.wikidata.org/entity/Q49498').year, 1998);
  assert.equal(byId.get('http://www.wikidata.org/entity/Q49498').title, 'Deep Impact');
  assert.equal(byId.get('http://www.wikidata.org/entity/Q20856802').title, 'La La Land');
  assert.ok(byId.get('http://www.wikidata.org/entity/Q20856802').genres.includes('musical'));
});

test('films with the same title are different films: own id, year, director and plot', () => {
  const byTitle = new Map();
  catalog.forEach(movie => byTitle.set(movie.title, (byTitle.get(movie.title) || []).concat(movie)));
  const groups = [...byTitle.values()].filter(group => group.length > 1);
  assert.ok(groups.length >= 4, 'the known remakes should still be there');
  for (const group of groups) {
    assert.equal(new Set(group.map(movie => movie.id)).size, group.length);
    assert.equal(new Set(group.map(movie => movie.year)).size, group.length, `${group[0].title}: years`);
    assert.equal(new Set(group.map(movie => movie.plot)).size, group.length, `${group[0].title}: plots`);
    assert.equal(new Set(group.map(movie => movie.director)).size, group.length, `${group[0].title}: directors`);
  }
  const kong = byTitle.get('King Kong').find(movie => movie.year === 1933);
  assert.match(kong.director, /Cooper/);
  assert.equal(kong.runtime, '100 min');
});

test('no two films share a plot, and every film has a poster, a plot, a year and a 512 number embedding', () => {
  assert.equal(new Set(catalog.map(movie => movie.plot.trim())).size, catalog.length);
  assert.equal(new Set(catalog.map(movie => movie.id)).size, catalog.length);
  for (const movie of catalog) {
    assert.ok(movie.poster && movie.plot && movie.plot !== 'N/A' && Number.isInteger(movie.year), movie.title);
    assert.equal(movie.embedding.length, 512, movie.title);
  }
});

test('the catalog holds feature films only, and no text still has HTML entities in it', () => {
  for (const movie of catalog) {
    const minutes = parseInt(movie.runtime, 10);
    if (Number.isFinite(minutes)) assert.ok(minutes >= 40, `${movie.title} is ${minutes} minutes`);
    assert.ok(!/&(apos|amp|quot|lt|gt|#\d+|#x[0-9a-f]+);/i.test([movie.title, movie.plot, movie.director].join(' ')), movie.title);
  }
});

test('every film in the catalog was checked: verified, or a mismatch that has been repaired', () => {
  for (const movie of catalog) {
    const entry = progress[movie.id];
    assert.ok(entry, `${movie.title} was never checked`);
    if (entry.status === 'VERIFIED') continue;
    assert.equal(entry.status, 'MISMATCH', `${movie.title} is ${entry.status}`);
    for (const field of ['plot', 'poster', 'runtime', 'director', 'rated', 'rottenTomatoes']) {
      assert.equal(movie[field], entry.correct[field], `${movie.title}: ${field} was not repaired`);
    }
  }
  assert.equal(Object.keys(progress).length, catalog.length, 'the progress file holds films that are no longer in the catalog');
});

test('the streaming snapshot holds exactly the films in the catalog', () => {
  assert.deepEqual(Object.keys(availability.films).sort(), catalog.map(movie => movie.id).sort());
});
