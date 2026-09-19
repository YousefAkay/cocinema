export function renderMovieCard(movie) {
  const card = document.createElement('div');
  card.className = 'movie-card';

  const img = document.createElement('img');
  img.src = movie.poster;

  const title = document.createElement('p');
  title.textContent = movie.title;

  card.appendChild(img);
  card.appendChild(title);

  return card;
}
