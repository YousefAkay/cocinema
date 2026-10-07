import { saveRating } from "./ratings.js";
import { titleWithYear } from './format.js';
import { movieHash } from './route.js';

export function renderPoster(movie) {
  function posterPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'poster-placeholder';
    placeholder.textContent = movie.title;
    return placeholder;
  }

  if (!movie.poster) {
    return posterPlaceholder();
  }

  const img = document.createElement('img');
  img.alt = movie.title;
  img.addEventListener('error', () => img.replaceWith(posterPlaceholder()));
  img.src = movie.poster;
  return img;
}

// A poster and a caption. With linkTo (a movie), the whole card is a link to that film's page.
export function renderMovieCard(movie, linkTo = null, note = null) {
  const card = document.createElement('div');
  card.className = 'movie-card';

  const title = document.createElement('p');
  title.textContent = titleWithYear(movie);

  card.appendChild(renderPoster(movie));
  card.appendChild(title);

  if (note) {
    const caption = document.createElement('p');
    caption.className = 'movie-card-note';
    caption.textContent = note;
    card.appendChild(caption);
  }

  if (!linkTo) {
    return card;
  }

  const link = document.createElement('a');
  link.className = 'movie-link';
  link.href = movieHash(linkTo.id);
  link.appendChild(card);
  return link;
}

// A larger result card for the top picks: poster, title with year, rank among all candidates and
// the "why" line. Everything goes in with textContent, so titles are never parsed as HTML.
export function renderTopPick(result, rank, total, whyLine) {
  const { movie } = result;
  const card = document.createElement('article');
  card.className = 'top-pick';

  const body = document.createElement('div');
  body.className = 'top-pick-body';

  const heading = document.createElement('h3');
  const link = document.createElement('a');
  link.href = movieHash(movie.id);
  link.textContent = titleWithYear(movie);
  heading.append(link);

  const match = document.createElement('p');
  match.className = 'top-pick-match';
  match.textContent = `#${rank} of ${total} films`;

  const why = document.createElement('p');
  why.className = 'top-pick-why';
  why.textContent = whyLine;

  body.append(heading, match, why);
  card.append(renderPoster(movie), body);
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

export function renderResults(list, startRank = 1) {
  const container = document.createElement('div');
  container.className = 'movie-result';
  container.style.counterReset = `rank ${startRank - 1}`;
  for (const { movie, percent } of list) {
    container.appendChild(renderMovieCard(movie, movie, `Top ${percent}% for your taste`));
  }
  return container;
}
