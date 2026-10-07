import { renderMovieCard, renderRatingWidget, renderResults } from './ui.js';
import { getAllRatings, savePosition, loadSavedState, clearSavedState } from './ratings.js';
import { recommend } from './recommend.js';

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

const ratingScreen = document.getElementById('rating-screen');
const resultsScreen = document.getElementById('results-screen');

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
  ratingScreen.style.display = '';
  resultsScreen.style.display = 'none';
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

  ratingScreen.innerHTML = ''; 

  const progress = document.createElement('p');
  progress.textContent = `${genre.genre} · ${genreIndex + 1} / ${onboarding.length}`;

  const skipButton = document.createElement('button');
  skipButton.textContent = "Haven't seen it";
  skipButton.addEventListener('click', nextMovie);

  ratingScreen.append(
    progress,
    renderMovieCard(movie),
    renderRatingWidget(movie.id, null, nextGenre),
    skipButton,
  );
}

function showResults() {
  ratingScreen.style.display = 'none';
  resultsScreen.style.display = '';
  resultsScreen.innerHTML = '';

  const ranked = recommend(getAllRatings(), catalog, 20);

  if (ranked.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'Rate at least 3 movies (with different scores) to get recommendations.';
    resultsScreen.append(message);
  } else {
    resultsScreen.append(renderResults(ranked.map(result => result.movie)));
  }

  const startOverButton = document.createElement('button');
  startOverButton.className = 'start-over';
  startOverButton.textContent = 'Start over';
  startOverButton.addEventListener('click', startOver);
  resultsScreen.append(startOverButton);
}

function startOver() {
  clearSavedState();
  genreIndex = 0;
  movieIndex = 0;
  resultsScreen.style.display = 'none';
  resultsScreen.innerHTML = '';
  ratingScreen.style.display = 'none';
  ratingScreen.innerHTML = '';
  document.body.classList.remove('started');
  landingScreen.style.display = '';
}

const landingScreen = document.getElementById('landing-screen');
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
    landingScreen.style.display = 'none';
    document.body.classList.add('started');
    showCurrentMovie();
  }
}

retryButton.addEventListener('click', loadData);
loadData();
