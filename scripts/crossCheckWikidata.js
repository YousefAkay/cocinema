import fs from 'fs';
import { fetchWithRetry, sleep } from './wikidata.js';

// Compares each catalog entry's director and runtime with what Wikidata says about the same film
// id. A plot can look right while the director, runtime, score and poster came from another film
// with the same title, and OMDb's plots for a film and its remake are sometimes near-identical,
// so this is the independent check. Read-only: it prints entries that disagree.
//
// Usage: node scripts/crossCheckWikidata.js [--json path]   (writes the flagged list as JSON)

const CATALOG_PATH = 'data/catalog.json';
const BATCH_SIZE = 40;
const MAX_RUNTIME_GAP = 20;

function words(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&apos;|&#39;/g, "'").replace(/[^a-z' ]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

// True when the stored director names and Wikidata's directors share a family name.
export function directorsAgree(stored, wikidata) {
  if (!stored || !wikidata) return true; // nothing to compare
  const lastWords = list => String(list).split(/,|\/| and /).map(name => words(name).pop()).filter(Boolean);
  const mine = new Set(lastWords(stored));
  return lastWords(wikidata).some(name => mine.has(name));
}

export function runtimesAgree(storedText, wikidataMinutes, maxGap = MAX_RUNTIME_GAP) {
  const stored = parseInt(storedText, 10);
  if (!Number.isFinite(stored) || !Number.isFinite(wikidataMinutes)) return true;
  return Math.abs(stored - wikidataMinutes) <= maxGap;
}

async function fetchFacts(ids) {
  const values = ids.map(id => `wd:${id.slice(id.lastIndexOf('/') + 1)}`).join(' ');
  const query = `SELECT ?item (GROUP_CONCAT(DISTINCT ?directorLabel; separator=" / ") AS ?directors) (MAX(?runtime) AS ?minutes) WHERE {
    VALUES ?item { ${values} }
    OPTIONAL { ?item wdt:P57 ?d . ?d rdfs:label ?directorLabel . FILTER(LANG(?directorLabel)="en") }
    OPTIONAL { ?item wdt:P2047 ?runtime }
  } GROUP BY ?item`;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchWithRetry(url);
  return new Map(data.results.bindings.map(row => [row.item.value, {
    directors: row.directors.value,
    minutes: row.minutes ? Number(row.minutes.value) : null,
  }]));
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const flagged = [];
  let compared = 0;

  for (let start = 0; start < catalog.length; start += BATCH_SIZE) {
    const batch = catalog.slice(start, start + BATCH_SIZE);
    const facts = await fetchFacts(batch.map(movie => movie.id));
    for (const movie of batch) {
      const fact = facts.get(movie.id);
      if (!fact) continue;
      compared++;
      const reasons = [];
      if (!directorsAgree(movie.director, fact.directors)) reasons.push(`director "${movie.director}" vs Wikidata "${fact.directors}"`);
      if (!runtimesAgree(movie.runtime, fact.minutes)) reasons.push(`runtime ${movie.runtime} vs Wikidata ${fact.minutes} min`);
      if (reasons.length) flagged.push({ id: movie.id, title: movie.title, year: movie.year, reasons });
    }
    await sleep(1500);
  }

  console.log(`Compared ${compared} of ${catalog.length} entries; ${flagged.length} disagree with Wikidata.`);
  for (const entry of flagged) {
    console.log(`  ${entry.id.slice(entry.id.lastIndexOf('/') + 1).padEnd(11)} ${entry.title} (${entry.year}): ${entry.reasons.join('; ')}`);
  }
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt !== -1) {
    fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(flagged, null, 1));
  }
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Something went wrong:', error.message);
    process.exit(1);
  });
}
