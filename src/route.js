import { COWATCH_ENABLED } from './flags.js';

// Hash routes: "#/movie/Q123" is a film's page, anything else is the home flow.
// Only the short Wikidata id (Q123) goes in the URL.
export function shortId(id) {
  return id.slice(id.lastIndexOf('/') + 1);
}

export function movieHash(id) {
  return `#/movie/${shortId(id)}`;
}

// "#/with/<payload>" is a friend's shared taste, only recognised when the co-watch flag is on;
// with it off the link is just the home page. The payload is checked later, not here.
export function parseHash(hash, cowatchEnabled = COWATCH_ENABLED) {
  const movie = /^#\/movie\/(Q\d+)$/.exec(hash || '');
  if (movie) {
    return { type: 'movie', qid: movie[1] };
  }
  const friend = cowatchEnabled ? /^#\/with\/(.*)$/.exec(hash || '') : null;
  return friend ? { type: 'with', payload: friend[1] } : { type: 'home' };
}
