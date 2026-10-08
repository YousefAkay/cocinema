import { seededRandom, shuffle } from './shuffle.js';

// Made-up tastes for trying "Watch with a friend" without a second person. They are built the way
// the genre personas in scripts/evaluate.js are: 6 well-known films of the genre rated 9 or 10,
// 4 well-known films outside it rated 2 or 3, and 2 more rated 5 or 6. They are not real people.
// Films are chosen by how well known they are (sitelinks) and by Wikidata id, never by catalog
// order, so the same sample comes out whatever order the catalog is in.

export const SAMPLE_FRIENDS = [
  { key: 'horror', label: 'Horror fan', genre: 'horror', seed: 1301 },
  { key: 'romance', label: 'Romance fan', genre: 'romance', seed: 1302 },
  { key: 'scifi', label: 'Sci-fi fan', genre: 'science fiction', seed: 1303 },
];
export const SAMPLE_KEYS = SAMPLE_FRIENDS.map(sample => sample.key);

const LIKED = 6;
const DISLIKED = 4;
const NEUTRAL = 2;
const FAMOUS_POOL = 60;

const between = (random, low, high) => low + Math.floor(random() * (high - low + 1));

function byFame(a, b) {
  return (b.sitelinks || 0) - (a.sitelinks || 0) || a.id.localeCompare(b.id);
}

// Returns [{ id, score }] for one sample, or null for an unknown key or a catalog too small to use.
export function buildSampleFriend(catalog, key) {
  const sample = SAMPLE_FRIENDS.find(candidate => candidate.key === key);
  if (!sample) return null;

  const random = seededRandom(sample.seed);
  const famous = catalog.filter(film => Array.isArray(film.embedding) && film.embedding.length > 0).sort(byFame);

  const liked = famous.filter(film => (film.genres || []).includes(sample.genre)).slice(0, LIKED);
  const likedIds = new Set(liked.map(film => film.id));
  const outside = famous.filter(film => !(film.genres || []).includes(sample.genre)).slice(0, FAMOUS_POOL);
  const disliked = shuffle(outside, random).slice(0, DISLIKED);
  const usedIds = new Set([...likedIds, ...disliked.map(film => film.id)]);
  const neutral = shuffle(famous.filter(film => !usedIds.has(film.id)).slice(0, FAMOUS_POOL), random).slice(0, NEUTRAL);

  if (liked.length < LIKED || disliked.length < DISLIKED || neutral.length < NEUTRAL) return null;

  return [
    ...liked.map(film => ({ id: film.id, score: between(random, 9, 10) })),
    ...disliked.map(film => ({ id: film.id, score: between(random, 2, 3) })),
    ...neutral.map(film => ({ id: film.id, score: between(random, 5, 6) })),
  ];
}
