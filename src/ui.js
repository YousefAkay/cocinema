import { saveRating } from "./ratings.js";

export function renderMovieCard(movie) {
  const card = document.createElement('div');
  card.className = 'movie-card';

  const title = document.createElement('p');
  title.textContent = movie.title;

  function posterPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'poster-placeholder';
    placeholder.textContent = movie.title;
    return placeholder;
  }

  if (movie.poster) {
    const img = document.createElement('img');
    img.alt = movie.title;
    img.addEventListener('error', () => img.replaceWith(posterPlaceholder()));
    img.src = movie.poster;
    card.appendChild(img);
  } else {
    card.appendChild(posterPlaceholder());
  }
  card.appendChild(title);

  return card;
}

export function renderRatingWidget(movieId, current, onConfirm) {
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
      hint.hidden = true;
    });

    container.appendChild(btn);
  }

  const hint = document.createElement('p');
  hint.className = 'rating-hint';
  hint.textContent = 'Pick a score first';
  hint.hidden = true;
  container.appendChild(hint);

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', function() {
    if (!selected) {
      hint.hidden = false;
      return;
    }

     saveRating(movieId, selected);
     onConfirm();

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