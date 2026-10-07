import fs from 'fs';
import { GENRES, fetchWithRetry, entityId, sleep } from './wikidata.js';

const CATALOG_PATH = 'data/catalog.json';
const META_PATH = 'data/wikidata-meta.json';
const BATCH_SIZE = 40;
const BATCH_DELAY_MS = 1500;

function buildQuery(ids) {
  const items = ids.map(id => `wd:${entityId(id)}`).join(' ');
  const genres = Object.keys(GENRES).map(id => `wd:${id}`).join(' ');
  return `
    SELECT ?item ?links ?date ?genre WHERE {
      VALUES ?item { ${items} }
      OPTIONAL { ?item wikibase:sitelinks ?links. }
      OPTIONAL { ?item wdt:P577 ?date. }
      OPTIONAL {
        ?item wdt:P136 ?genre.
        VALUES ?genre { ${genres} }
      }
    }`;
}

function foldRows(ids, bindings) {
  const found = new Map();
  for (const id of ids) {
    found.set(id, { year: null, sitelinks: null, genreIds: new Set() });
  }

  for (const row of bindings) {
    const meta = found.get(row.item.value);
    if (!meta) continue;
    if (row.links) {
      meta.sitelinks = Number(row.links.value);
    }
    if (row.date) {
      const year = new Date(row.date.value).getUTCFullYear();
      if (Number.isInteger(year) && (meta.year === null || year < meta.year)) {
        meta.year = year;
      }
    }
    if (row.genre) {
      meta.genreIds.add(entityId(row.genre.value));
    }
  }

  return found;
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const ids = catalog.map(movie => movie.id);
  const meta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf8')) : {};

  const todo = ids.filter(id => !(id in meta));
  console.log(`${ids.length} ids, ${ids.length - todo.length} already fetched, ${todo.length} to fetch`);

  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    const query = buildQuery(batch);
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const data = await fetchWithRetry(url);

    for (const [id, found] of foldRows(batch, data.results.bindings)) {
      const genreIds = Array.from(found.genreIds);
      meta[id] = {
        year: found.year,
        sitelinks: found.sitelinks,
        genreIds,
        genres: genreIds.map(genreId => GENRES[genreId]),
      };
    }

    fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 1));
    console.log(`  fetched ${Math.min(start + BATCH_SIZE, todo.length)}/${todo.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  const entries = ids.map(id => [id, meta[id]]);
  const empty = entries.filter(([, m]) => !m || (m.year === null && m.sitelinks === null && m.genreIds.length === 0));
  console.log(`Ids requested: ${ids.length}`);
  console.log(`With a year: ${entries.filter(([, m]) => m && m.year !== null).length}`);
  console.log(`With at least one genre: ${entries.filter(([, m]) => m && m.genreIds.length > 0).length}`);
  console.log(`With a sitelink count: ${entries.filter(([, m]) => m && m.sitelinks !== null).length}`);
  console.log(`Came back empty: ${empty.length}${empty.length ? ' -> ' + empty.map(([id]) => id).join(', ') : ''}`);
}

main().catch(err => console.error('Something went wrong:', err.message));
