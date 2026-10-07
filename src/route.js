// Hash routes: "#/movie/Q123" is a film's page, anything else is the home flow.
// Only the short Wikidata id (Q123) goes in the URL.
export function shortId(id) {
  return id.slice(id.lastIndexOf('/') + 1);
}

export function movieHash(id) {
  return `#/movie/${shortId(id)}`;
}

export function parseHash(hash) {
  const match = /^#\/movie\/(Q\d+)$/.exec(hash || '');
  return match ? { type: 'movie', qid: match[1] } : { type: 'home' };
}
