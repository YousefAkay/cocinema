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
