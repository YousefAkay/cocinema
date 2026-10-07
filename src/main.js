import { renderMovieCard, renderRatingWidget, renderResults, renderTopPick } from './ui.js';
import {
  getAllRatings, getSkippedIds, markSkipped, savePosition, saveExtra, loadSavedState, clearSavedState,
} from './ratings.js';
import { recommend, explainMatch } from './recommend.js';
import { buildWhyLine } from './why.js';
import { EXTRA_COUNT, pickNextCandidate } from './candidates.js';

const TOP_COUNT = 5;
const RESULT_COUNT = 25;

let catalog = [];
let onboarding = [];
let catalogById = new Map();

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`${path}: unexpected format`);
  }
  return data;
}

let genreIndex = 0;
let movieIndex = 0;
let extra = null;

const landingScreen = document.getElementById('landing-screen');
const ratingScreen = document.getElementById('rating-screen');
const resultsScreen = document.getElementById('results-screen');

// One rating step: a progress label, the movie, the rating buttons and "Haven't seen it".
function showRatingStep({ label, movie, onConfirm, onSkip }) {
  ratingScreen.style.display = '';
  resultsScreen.style.display = 'none';
  ratingScreen.innerHTML = '';
  window.scrollTo(0, 0);

  const progress = document.createElement('p');
  progress.textContent = label;

  const skipButton = document.createElement('button');
  skipButton.textContent = "Haven't seen it";
  skipButton.addEventListener('click', onSkip);

  ratingScreen.append(
    progress,
    renderMovieCard(movie),
    renderRatingWidget(movie.id, null, onConfirm),
    skipButton,
  );
}

function skipMovie(movie) {
  markSkipped(movie.id);
  nextMovie();
}

function nextMovie() {
  movieIndex++;
  savePosition(genreIndex, movieIndex);
  showCurrentMovie();
}

function nextGenre() {
  genreIndex++;
  movieIndex = 0;
  savePosition(genreIndex, movieIndex);
  showCurrentMovie();
}

function showCurrentMovie() {
  if (extra) {
    resumeExtra();
    return;
  }

  if (genreIndex >= onboarding.length) {
    showResults();
    return;
  }

  const genre = onboarding[genreIndex];
  if (movieIndex >= genre.movies.length) {
    nextGenre();
    return;
  }

  const movie = catalogById.get(genre.movies[movieIndex].id);
  if (!movie) {
    nextMovie();
    return;
  }

  showRatingStep({
    label: `${genre.genre} · ${genreIndex + 1} / ${onboarding.length}`,
    movie,
    onConfirm: nextGenre,
    onSkip: () => skipMovie(movie),
  });
}

// "Rate 5 more": EXTRA_COUNT well-known films the user has not rated or skipped.
function startExtra() {
  extra = { rated: 0, shown: [] };
  showNextExtra();
}

function showNextExtra() {
  const movie = pickNextCandidate(catalog, {
    rated: new Set(getAllRatings().map(rating => rating.id)),
    skipped: new Set(getSkippedIds()),
    shown: extra.shown,
  });

  if (!movie) {
    finishExtra(extra.rated === 0
      ? 'There are no more films to suggest right now.'
      : `Only ${extra.rated} more ${extra.rated === 1 ? 'film was' : 'films were'} available to rate.`);
    return;
  }

  extra.shown.push(movie.id);
  saveExtra(extra);
  showExtraStep(movie);
}

function showExtraStep(movie) {
  showRatingStep({
    label: `Rate more · ${extra.rated + 1} of ${EXTRA_COUNT}`,
    movie,
    onConfirm: () => {
      extra.rated++;
      if (extra.rated >= EXTRA_COUNT) {
        finishExtra();
      } else {
        saveExtra(extra);
        showNextExtra();
      }
    },
    onSkip: () => {
      markSkipped(movie.id);
      showNextExtra();
    },
  });
}

// After a refresh: show the film that was on screen, or move on if it was already handled.
function resumeExtra() {
  const current = catalogById.get(extra.shown[extra.shown.length - 1]);
  const handled = new Set([...getAllRatings().map(rating => rating.id), ...getSkippedIds()]);

  if (!current || handled.has(current.id)) {
    showNextExtra();
    return;
  }
  showExtraStep(current);
}

function finishExtra(notice) {
  extra = null;
  saveExtra(null);
  showResults(notice);
}

function addParagraph(parent, className, text) {
  const paragraph = document.createElement('p');
  if (className) {
    paragraph.className = className;
  }
  paragraph.textContent = text;
  parent.append(paragraph);
  return paragraph;
}

function addButton(parent, className, text, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function showResults(notice) {
  ratingScreen.style.display = 'none';
  resultsScreen.style.display = '';
  resultsScreen.innerHTML = '';
  window.scrollTo(0, 0);

  const ratings = getAllRatings();
  const ranked = recommend(ratings, catalog, RESULT_COUNT);

  if (ranked.length === 0) {
    addParagraph(resultsScreen, '', 'Rate at least 3 movies (with different scores) to get recommendations.');
    addButton(resultsScreen, 'start-over', 'Start over', startOver);
    return;
  }

  if (notice) {
    addParagraph(resultsScreen, 'results-notice', notice);
  }

  const topSection = document.createElement('section');
  topSection.className = 'top-picks';
  const topHeading = document.createElement('h2');
  topHeading.textContent = 'Your top picks';
  topSection.append(topHeading);

  ranked.slice(0, TOP_COUNT).forEach((result, index) => {
    const why = buildWhyLine(explainMatch(result.movie.id, ratings, catalog));
    topSection.append(renderTopPick(result, index + 1, why));
  });
  addParagraph(topSection, 'match-note',
    'Match shows how closely a film’s story points the same way as your taste. It is not the chance you will like it.');
  resultsScreen.append(topSection);

  const rest = ranked.slice(TOP_COUNT);
  if (rest.length > 0) {
    const restSection = document.createElement('section');
    restSection.className = 'more-picks';
    const restHeading = document.createElement('h2');
    restHeading.textContent = 'More to explore';
    restSection.append(restHeading, renderResults(rest.map(result => result.movie), TOP_COUNT + 1));
    resultsScreen.append(restSection);
  }

  const actions = document.createElement('div');
  actions.className = 'results-actions';
  addButton(actions, 'rate-more', `Rate ${EXTRA_COUNT} more`, startExtra);
  addButton(actions, 'start-over', 'Start over', startOver);
  resultsScreen.append(actions);
}

function startOver() {
  clearSavedState();
  genreIndex = 0;
  movieIndex = 0;
  extra = null;
  resultsScreen.style.display = 'none';
  resultsScreen.innerHTML = '';
  ratingScreen.style.display = 'none';
  ratingScreen.innerHTML = '';
  document.body.classList.remove('started');
  landingScreen.style.display = '';
}

const startButton = document.getElementById('start-button');
const retryButton = document.getElementById('retry-button');
const loadError = document.getElementById('load-error');

function setLoadError(message) {
  loadError.textContent = message || '';
  loadError.hidden = !message;
  retryButton.hidden = !message;
}

startButton.addEventListener('click', function() {
  if (startButton.disabled) {
    return;
  }
  landingScreen.style.display = 'none';
  ratingScreen.style.display = '';
  document.body.classList.add('started');
  showCurrentMovie();
});

async function loadData() {
  startButton.disabled = true;
  retryButton.disabled = true;
  setLoadError('');

  try {
    [catalog, onboarding] = await Promise.all([
      fetchJson('../data/catalog.json'),
      fetchJson('../data/onboarding.json'),
    ]);
  } catch (error) {
    console.error('Failed to load data', error);
    setLoadError("Couldn't load the movie data. Check your connection and try again.");
    retryButton.disabled = false;
    return;
  }

  catalogById = new Map(catalog.map(movie => [movie.id, movie]));
  startButton.disabled = false;

  const saved = loadSavedState(new Set(catalogById.keys()), onboarding.length);
  if (saved) {
    genreIndex = saved.genreIndex;
    movieIndex = saved.movieIndex;
    extra = saved.extra;
    landingScreen.style.display = 'none';
    document.body.classList.add('started');
    showCurrentMovie();
  }
}

retryButton.addEventListener('click', loadData);
loadData();
