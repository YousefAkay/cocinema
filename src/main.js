import { renderMovieCard, renderRatingWidget, renderResults, renderTopPick } from './ui.js';
import {
  getAllRatings, getSkippedIds, markSkipped, savePosition, saveExtra, saveSeed, saveLength, loadSavedState, clearSavedState,
} from './ratings.js';
import { recommend, explainMatch } from './recommend.js';
import { buildWhyLine } from './why.js';
import { EXTRA_COUNT, pickNextCandidate } from './candidates.js';
import { topPercent } from './percentile.js';
import { titleWithYear, genreOrder } from './format.js';
import { parseHash, shortId } from './route.js';
import { renderDetail, renderNotFound, renderStreaming, showStreamingLoading } from './detail.js';
import { loadAvailability, streamingView } from './availability.js';
import { buildSession, newSeed, isValidLength } from './shuffle.js';
import { registerServiceWorker, watchOnlineStatus } from './offline.js';
import { resolveStep, progressLabel } from './progress.js';

const TOP_COUNT = 5;
const RESULT_COUNT = 25;

let catalog = [];
let onboarding = [];
let seed = newSeed();
let session = [];
let sessionLength = null; // 10 (Quick) or 15 (Full) once a session has started
let dataLoaded = false;
let catalogById = new Map();
let moviesByQid = new Map();
let genreRank = [];

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
let started = false;
let resultsScrollY = 0;
let cameFromResults = false;

const landingScreen = document.getElementById('landing-screen');
const ratingScreen = document.getElementById('rating-screen');
const resultsScreen = document.getElementById('results-screen');
const detailScreen = document.getElementById('detail-screen');

function showOnly(screen) {
  for (const candidate of [landingScreen, ratingScreen, resultsScreen, detailScreen]) {
    candidate.style.display = candidate === screen ? '' : 'none';
  }
  document.body.classList.toggle('started', screen !== landingScreen);
}

// Remember where the results list was scrolled when a film is opened from it.
resultsScreen.addEventListener('click', event => {
  if (event.target.closest('a[href^="#/movie/"]')) {
    resultsScrollY = window.scrollY;
    cameFromResults = true;
  }
});

// One rating step: a progress label, the movie, the rating buttons and "Haven't seen it".
function showRatingStep({ label, movie, onConfirm, onSkip }) {
  showOnly(ratingScreen);
  ratingScreen.innerHTML = '';
  window.scrollTo(0, 0);

  // The step label is the page's heading; focus moves to it so a screen reader announces the new step.
  const progress = document.createElement('h1');
  progress.tabIndex = -1;
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
  progress.focus({ preventScroll: true });
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

  const step = resolveStep(session, genreIndex, movieIndex, id => catalogById.has(id));
  if (step.genreIndex !== genreIndex || step.movieIndex !== movieIndex) {
    genreIndex = step.genreIndex;
    movieIndex = step.movieIndex;
    savePosition(genreIndex, movieIndex);
  }
  if (step.done) {
    showResults();
    return;
  }

  const movie = catalogById.get(step.movieId);
  showRatingStep({
    label: progressLabel(step),
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

function showResults(notice, restoreScroll = false) {
  showOnly(resultsScreen);
  resultsScreen.innerHTML = '';
  if (!restoreScroll) {
    window.scrollTo(0, 0);
  }

  const ratings = getAllRatings();
  // Score every unrated film once, so each shown film can be placed among all of them.
  const everyUnrated = recommend(ratings, catalog, catalog.length);
  const allScores = everyUnrated.map(result => result.score);
  const ranked = everyUnrated.slice(0, RESULT_COUNT);

  const pageHeading = document.createElement('h1');
  pageHeading.className = 'visually-hidden';
  pageHeading.tabIndex = -1;
  pageHeading.textContent = 'Your recommendations';
  resultsScreen.append(pageHeading);

  if (ranked.length === 0) {
    addParagraph(resultsScreen, '', 'Rate at least 3 movies (with different scores) to get recommendations.');
    addButton(resultsScreen, 'start-over', 'Start over', startOver);
    pageHeading.focus({ preventScroll: true });
    return;
  }

  if (notice) {
    addParagraph(resultsScreen, 'results-notice', notice);
  }

  const noun = ratings.length === 1 ? 'film' : 'films';
  addParagraph(resultsScreen, 'results-basis', `These picks are based on the ${ratings.length} ${noun} you rated.`);
  if (sessionLength === 10) {
    addParagraph(resultsScreen, 'results-nudge', `Want sharper picks? Rate ${EXTRA_COUNT} more.`);
  }

  const topSection = document.createElement('section');
  topSection.className = 'top-picks';
  const topHeading = document.createElement('h2');
  topHeading.textContent = 'Your top picks';
  topHeading.tabIndex = -1;
  topSection.append(topHeading);

  ranked.slice(0, TOP_COUNT).forEach((result, index) => {
    const why = buildWhyLine(explainMatch(result.movie.id, ratings, catalog));
    topSection.append(renderTopPick(result, index + 1, everyUnrated.length, why));
  });
  addParagraph(topSection, 'match-note',
    'Top N% ranks each film against the rest of the catalog for you. It is not the chance you will like it.');
  resultsScreen.append(topSection);

  const rest = ranked.slice(TOP_COUNT);
  if (rest.length > 0) {
    const restSection = document.createElement('section');
    restSection.className = 'more-picks';
    const restHeading = document.createElement('h2');
    restHeading.textContent = 'More to explore';
    restSection.append(restHeading, renderResults(rest.map(result => ({ movie: result.movie, percent: topPercent(result.score, allScores) })), TOP_COUNT + 1));
    resultsScreen.append(restSection);
  }

  const actions = document.createElement('div');
  actions.className = 'results-actions';
  addButton(actions, 'rate-more', `Rate ${EXTRA_COUNT} more`, startExtra);
  addButton(actions, 'start-over', 'Start over', startOver);
  resultsScreen.append(actions);

  if (restoreScroll) {
    window.scrollTo(0, resultsScrollY);
  } else {
    topHeading.focus({ preventScroll: true });
  }
}

// A film's own page, at #/movie/<id>. Renders from the saved ratings, so it works after a reload.
function showDetail(qid) {
  const movie = moviesByQid.get(qid);
  showOnly(detailScreen);
  detailScreen.innerHTML = '';
  window.scrollTo(0, 0);

  if (!movie) {
    detailScreen.append(renderNotFound(leaveDetail));
    document.title = 'Movie not found · CoCinema';
  } else {
    const ratings = getAllRatings();
    const everyUnrated = recommend(ratings, catalog, catalog.length);
    const entry = everyUnrated.find(result => result.movie.id === movie.id);
    const own = ratings.find(rating => rating.id === movie.id);

    detailScreen.append(renderDetail(movie, {
      percent: entry ? topPercent(entry.score, everyUnrated.map(result => result.score)) : null,
      userScore: own ? own.score : null,
      contributions: explainMatch(movie.id, ratings, catalog),
      genreOrder: genreRank,
      onBack: leaveDetail,
    }));
    document.title = `${titleWithYear(movie)} · CoCinema`;
    fillStreaming(movie);
  }

  const heading = document.getElementById('detail-heading');
  if (heading) {
    heading.focus({ preventScroll: true });
  }
}

// Streaming services load on their own after the page is up, so a slow or missing file never
// blocks or breaks the film page. Any problem leaves only the JustWatch links.
async function fillStreaming(movie) {
  const slot = document.getElementById('streaming-services');
  if (!slot) return;
  showStreamingLoading(slot);
  try {
    const data = await loadAvailability();
    if (slot.isConnected) {
      renderStreaming(slot, streamingView(data, movie.id));
    }
  } catch (error) {
    slot.replaceChildren();
  }
}

function leaveDetail() {
  if (cameFromResults) {
    history.back();
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

function showHome() {
  document.title = 'CoCinema';
  if (!started) {
    showOnly(landingScreen);
    return;
  }
  if (extra) {
    resumeExtra();
  } else if (genreIndex >= session.length) {
    showResults(undefined, cameFromResults);
    resultsScreen.querySelector('h2')?.focus({ preventScroll: true });
  } else {
    showCurrentMovie();
  }
}

function route() {
  const target = parseHash(location.hash);
  if (target.type === 'movie') {
    showDetail(target.qid);
  } else {
    showHome();
  }
}

window.addEventListener('hashchange', route);

function startOver() {
  clearSavedState();
  genreIndex = 0;
  movieIndex = 0;
  extra = null;
  started = false;
  cameFromResults = false;
  seed = newSeed();
  session = [];
  sessionLength = null;
  clearLengthChoice();
  resultsScreen.innerHTML = '';
  ratingScreen.innerHTML = '';
  detailScreen.innerHTML = '';
  history.replaceState(null, '', location.pathname + location.search);
  document.title = 'CoCinema';
  showOnly(landingScreen);
  landingScreen.querySelector('h1').focus({ preventScroll: true });
}

const startButton = document.getElementById('start-button');
const retryButton = document.getElementById('retry-button');
const loadError = document.getElementById('load-error');

function setLoadError(message) {
  loadError.textContent = message || '';
  loadError.hidden = !message;
  retryButton.hidden = !message;
}

const lengthInputs = [...document.querySelectorAll('input[name="length"]')];
const lengthStatus = document.getElementById('length-status');

// The length picked on the landing screen, or null. Only 10 and 15 count.
function chosenLength() {
  const picked = lengthInputs.find(input => input.checked);
  const value = picked ? Number(picked.value) : null;
  return isValidLength(value) ? value : null;
}

const LENGTH_TEXT = { 10: 'Ready: 10 films, about a minute', 15: 'Ready: 15 films, about two minutes' };

// Get started needs both the data and a chosen length; nothing is chosen for the visitor.
function updateStartState() {
  const length = chosenLength();
  startButton.disabled = !(dataLoaded && length);
  lengthStatus.textContent = length ? LENGTH_TEXT[length] : 'Choose a length to begin';
}

function clearLengthChoice() {
  lengthInputs.forEach(input => { input.checked = false; });
  updateStartState();
}

lengthInputs.forEach(input => input.addEventListener('change', updateStartState));
// Browsers can remember a ticked radio across a reload; the landing screen always starts empty.
clearLengthChoice();

startButton.addEventListener('click', function() {
  const length = chosenLength();
  if (startButton.disabled || !length) {
    return;
  }
  started = true;
  sessionLength = length;
  session = buildSession(onboarding, seed, sessionLength);
  saveSeed(seed);
  saveLength(sessionLength);
  showCurrentMovie();
});

async function loadData() {
  dataLoaded = false;
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
  moviesByQid = new Map(catalog.map(movie => [shortId(movie.id), movie]));
  genreRank = genreOrder(catalog, onboarding);
  dataLoaded = true;
  updateStartState();

  const saved = loadSavedState(new Set(catalogById.keys()));
  if (saved) {
    seed = saved.seed;
    sessionLength = saved.length;
    genreIndex = saved.genreIndex;
    movieIndex = saved.movieIndex;
    extra = saved.extra;
    started = true;
    session = buildSession(onboarding, seed, sessionLength);
  }
  route();
}

retryButton.addEventListener('click', loadData);
loadData();

watchOnlineStatus(document.getElementById('offline-notice'));
registerServiceWorker();
