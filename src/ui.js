import { saveRating } from "./ratings.js";
import { titleWithYear, metaParts, capitalize } from './format.js';
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

function pillRow(genres) {
  const list = document.createElement('ul');
  list.className = 'pill-row';
  for (const genre of genres) {
    const item = document.createElement('li');
    item.textContent = capitalize(genre);
    list.append(item);
  }
  return list;
}

// A larger result card for the top picks: poster, title, rank, a facts line (year, runtime,
// Rotten Tomatoes), genre pills and the "why" line. Everything goes in with textContent, so
// titles are never parsed as HTML. genres: the film's genres, already ordered and trimmed.
export function renderTopPick(result, rank, whyLine, genres = []) {
  const { movie } = result;
  const card = document.createElement('article');
  card.className = 'top-pick';

  const body = document.createElement('div');
  body.className = 'top-pick-body';

  const heading = document.createElement('h3');
  const link = document.createElement('a');
  link.href = movieHash(movie.id);
  link.textContent = movie.title;
  heading.append(link);

  const match = document.createElement('p');
  match.className = 'top-pick-match';
  match.textContent = `#${rank}`;

  body.append(heading, match);

  const facts = metaParts(movie);
  if (facts.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'top-pick-meta';
    meta.textContent = facts.join(' · ');
    body.append(meta);
  }
  if (genres.length > 0) {
    body.append(pillRow(genres));
  }

  const why = document.createElement('p');
  why.className = 'top-pick-why';
  why.textContent = whyLine;

  card.append(renderPoster(movie), body, why);
  return card;
}

// A poster in a box of fixed shape. The title sits behind the image as a tile, so a slow or
// missing poster leaves a labelled tile in exactly the same place, and nothing moves when the
// image arrives.
function renderPosterBox(movie) {
  const box = document.createElement('div');
  box.className = 'poster-box';

  const tile = document.createElement('span');
  tile.className = 'poster-tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.textContent = movie.title;
  box.append(tile);

  if (movie.poster) {
    const img = document.createElement('img');
    img.alt = movie.title;
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove());
    img.src = movie.poster;
    box.append(img);
  }
  return box;
}

// One rating step as a fixed frame: counter and Home button, poster, title, facts, genre pills,
// the scores, and the Confirm and "Haven't seen it" buttons. Every block has a fixed size, so
// nothing moves from one film to the next. Returns { frame, heading } (the film title).
export function renderRatingStep({ label, movie, genres, onConfirm, onSkip, onHome }) {
  const frame = document.createElement('div');
  frame.className = 'rating-frame';

  // Home comes first in the page order so that Tab from the title goes straight to the scores.
  const top = document.createElement('div');
  top.className = 'rating-top';
  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'home-button';
  home.textContent = 'Home';
  home.addEventListener('click', onHome);
  const step = document.createElement('p');
  step.className = 'rating-step';
  step.textContent = label;
  top.append(home, step);

  const body = document.createElement('div');
  body.className = 'rating-body';

  const panel = document.createElement('div');
  panel.className = 'rating-panel';

  // The film's title is the page heading; focus moves to it so a screen reader announces the
  // new step, with its place in the list, and the next film.
  const title = document.createElement('h1');
  title.className = 'rating-title';
  title.tabIndex = -1;
  title.setAttribute('aria-label', `${label}, ${movie.title}`);
  title.textContent = movie.title;
  panel.append(title);

  const meta = document.createElement('p');
  meta.className = 'rating-meta';
  meta.textContent = metaParts(movie).join(' · ');
  panel.append(meta, pillRow(genres));
  panel.append(renderRatingWidget(movie.id, null, onConfirm, onSkip));

  body.append(renderPosterBox(movie), panel);
  frame.append(top, body);
  return { frame, heading: title };
}

export function renderRatingWidget(movieId, current, onConfirm, onSkip = null) {
  const container = document.createElement('div');
  container.className = 'rating-controls';

  const scores = document.createElement('div');
  scores.className = 'rating-widget';
  scores.setAttribute('role', 'group');
  scores.setAttribute('aria-label', 'Your score from 1 to 10');

  let selected = current;
  let selectedButton = null;

  // The hint's row is always there, so showing it moves nothing.
  const hint = document.createElement('p');
  hint.className = 'rating-hint';
  hint.setAttribute('role', 'alert');

  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = i;
    btn.setAttribute('aria-pressed', i === current ? 'true' : 'false');

    if (i === current) {
      btn.classList.add('selected');
      selectedButton = btn;
    }

    btn.addEventListener('click', function() {
      if (selectedButton) {
        selectedButton.classList.remove('selected');
        selectedButton.setAttribute('aria-pressed', 'false');
      }
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      selectedButton = btn;
      selected = i;
      hint.textContent = '';
    });

    scores.appendChild(btn);
  }
  container.append(scores, hint);

  const actions = document.createElement('div');
  actions.className = 'rating-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'confirm-score';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', function() {
    if (!selected) {
      hint.textContent = 'Pick a score first';
      return;
    }

    saveRating(movieId, selected);
    onConfirm();
  });
  actions.appendChild(confirmBtn);

  if (onSkip) {
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'skip-button';
    skipBtn.textContent = "Haven't seen it";
    skipBtn.addEventListener('click', onSkip);
    actions.appendChild(skipBtn);
  }
  container.appendChild(actions);

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
