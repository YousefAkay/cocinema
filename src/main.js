import { renderMovieCard, renderRatingWidget, renderResults } from './ui.js';
import { getAllRatings } from './ratings.js';
import { recommend } from './recommend.js';

const catalogResponse = await fetch('../data/catalog.json');
const catalog = await catalogResponse.json();

const onboardingResponse = await fetch('../data/onboarding.json');
const onboarding = await onboardingResponse.json();

const catalogById = new Map(catalog.map(movie => [movie.id, movie]));

let genreIndex = 0; 
let movieIndex = 0; 

const ratingScreen = document.getElementById('rating-screen');
const resultsScreen = document.getElementById('results-screen');

function nextMovie() {  
  movieIndex++;
  showCurrentMovie();
}

function nextGenre() {
  genreIndex++;
  movieIndex = 0;
  showCurrentMovie();
}

function showCurrentMovie() {
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
    return;
  }

  resultsScreen.append(renderResults(ranked.map(result => result.movie)));
}

showCurrentMovie();