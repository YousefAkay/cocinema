import { saveRating } from "./ratings.js";

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

export function renderRatingWidget(movieId, current) {
  const container = document.createElement('div');
  container.className = 'rating-widget';

  let selected = current;
  let selectedButton = null;

  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;

    if (i === current) {
      btn.classList.add('selected');
      selectedButton = btn;
    }

    btn.addEventListener('click', function() {
      if (selectedButton) {
        selectedButton.classList.remove('selected');
      }
      btn.classList.add('selected');
      selectedButton = btn;
      selected = i;
    });

    container.appendChild(btn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', function() {
    saveRating(movieId, selected);
  });
  container.appendChild(confirmBtn);

  return container;
}

export function renderResults(list) {
  const container = document.createElement('div');
  container.className = 'movie-result';
  for (const movie of list) {
    const card =  renderMovieCard(movie);
    container.appendChild(card);  
  }
return container;
}