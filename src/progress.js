// Where the visitor is in onboarding. Progress is counted in genres, not films: "n / of" means
// the n-th genre of the session is on screen. A genre whose films are all skipped or unknown
// is passed over, and counts as done.
export function resolveStep(session, genreIndex, movieIndex, isKnown = () => true) {
  let genre = genreIndex;
  let movie = movieIndex;

  while (genre < session.length) {
    const films = session[genre].movies;
    while (movie < films.length && !isKnown(films[movie].id)) {
      movie++;
    }
    if (movie < films.length) {
      return { done: false, genreIndex: genre, movieIndex: movie, genre: session[genre].genre, n: genre + 1, of: session.length, movieId: films[movie].id };
    }
    genre++;
    movie = 0;
  }
  return { done: true, genreIndex: genre, movieIndex: 0, n: session.length, of: session.length };
}

export function progressLabel(step) {
  return `${step.genre} · ${step.n} / ${step.of}`;
}

// Where the visitor goes after answering a film, whether it was new or one they went back to: the
// first film of the session they have not answered, in session order, so nothing already answered
// is walked again. A genre with a rated film is done; otherwise its first known film that is not
// skipped is next, and a genre whose films are all skipped or unknown is passed over.
// answers: { rated, skipped }, two Sets of film ids.
export function nextStep(session, { rated, skipped }, isKnown = () => true) {
  for (let genre = 0; genre < session.length; genre++) {
    const films = session[genre].movies;
    if (films.some(film => rated.has(film.id))) continue;
    const movie = films.findIndex(film => isKnown(film.id) && !skipped.has(film.id));
    if (movie !== -1) {
      return resolveStep(session, genre, movie, isKnown);
    }
  }
  return resolveStep(session, session.length, 0, isKnown);
}

// The place of a film in the session, as { genreIndex, movieIndex }, or null if it is not in it.
export function locateFilm(session, movieId) {
  for (let genre = 0; genre < session.length; genre++) {
    const movie = session[genre].movies.findIndex(film => film.id === movieId);
    if (movie !== -1) return { genreIndex: genre, movieIndex: movie };
  }
  return null;
}

// The films shown before a position, for saves made before Back existed. Those sessions only ever
// moved forward, so the answered films before the position, in session order, are exactly the
// films that were shown.
export function shownBefore(session, genreIndex, movieIndex, isAnswered) {
  const shown = [];
  for (let genre = 0; genre < Math.min(genreIndex + 1, session.length); genre++) {
    const films = session[genre].movies;
    const end = genre === genreIndex ? movieIndex : films.length;
    for (let movie = 0; movie < Math.min(end, films.length); movie++) {
      if (isAnswered(films[movie].id)) shown.push(films[movie].id);
    }
  }
  return shown;
}
