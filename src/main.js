import { renderMovieCard, renderRatingWidget, renderResults, renderTopPick } from './ui.js';
import {
  getAllRatings, getSkippedIds, markSkipped, savePosition, saveExtra, saveSeed, saveLength, saveFriend, getFriend, loadSavedState, clearSavedState,
} from './ratings.js';
import { recommend, explainMatch } from './recommend.js';
import { buildWhyLine } from './why.js';
import { EXTRA_COUNT, pickNextCandidate } from './candidates.js';
import { topPercent } from './percentile.js';
import { titleWithYear, genreOrder, roundedCount } from './format.js';
import { parseHash, shortId } from './route.js';
import { renderDetail, renderNotFound, renderStreaming, showStreamingLoading } from './detail.js';
import { COWATCH_ENABLED } from './flags.js';
import { encodeTaste, decodeTaste, shareLink, MAX_FILMS } from './cowatch.js';
import { combineTastes } from './combine.js';
import { SAMPLE_FRIENDS, buildSampleFriend } from './samples.js';
import {
  renderShareSection, setShareStatus, renderFriendBanner, renderFriendNotice, renderCombined, focusCombinedHeading,
} from './cowatchScreens.js';
import { loadAvailability, streamingView } from './availability.js';
import { buildSession, newSeed, isValidLength } from './shuffle.js';
import { registerServiceWorker, watchOnlineStatus } from './offline.js';
import { resolveStep, progressLabel } from './progress.js';
import { EVALUATION } from './evaluation-stats.js';
import { LANDING_POSTERS } from './landing-posters.js';

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
let pendingFriend = null; // a friend's taste from a link, not yet part of a session
let soloView = false; // true while the visitor looks at their own picks instead of the shared list

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
    showFinished();
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
  showFinished(notice);
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
    topSection.append(renderTopPick(result, index + 1, why));
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
  if (COWATCH_ENABLED && getFriend()) {
    addButton(actions, 'cowatch-to-combined', "Films you'd both enjoy", () => {
      soloView = false;
      showCombined();
    });
  }
  addButton(actions, 'start-over', 'Start over', startOver);
  resultsScreen.append(actions);

  if (COWATCH_ENABLED) {
    resultsScreen.append(renderShareSection({ onShare: shareMyTaste, onSample: trySampleFriend }));
  }

  if (restoreScroll) {
    window.scrollTo(0, resultsScrollY);
  } else {
    topHeading.focus({ preventScroll: true });
  }
}

// ---- Watch with a friend (behind COWATCH_ENABLED) ----

function showFinished(notice, restoreScroll = false) {
  if (COWATCH_ENABLED && getFriend() && !soloView) {
    showCombined(notice, restoreScroll);
  } else {
    showResults(notice, restoreScroll);
  }
}

function friendLabel(friend) {
  const sample = friend.sample ? SAMPLE_FRIENDS.find(candidate => candidate.key === friend.sample) : null;
  return sample ? `${sample.label} (sample)` : 'Your friend';
}

// Films that suit both people. The friend's ratings are only read here: they are never added to
// the visitor's own ratings or profile.
function showCombined(notice, restoreScroll = false) {
  showOnly(resultsScreen);
  resultsScreen.innerHTML = '';
  if (!restoreScroll) {
    window.scrollTo(0, 0);
  }

  const friend = getFriend();
  const outcome = combineTastes(catalog, getAllRatings(), friend.ratings, 10);
  if (outcome.problem) {
    soloView = true;
    showResults(outcome.problem === 'b'
      ? "Your friend's ratings are not enough to compare (they need at least 3 known films with different scores)."
      : notice);
    return;
  }

  if (notice) {
    addParagraph(resultsScreen, 'results-notice', notice);
  }
  resultsScreen.append(renderCombined({
    results: outcome.results,
    friendLabel: friendLabel(friend),
    skipped: friend.skipped,
    hasSolo: true,
    onSolo: () => {
      soloView = true;
      showResults();
    },
    onRateMore: startExtra,
    onStartOver: startOver,
  }));

  if (restoreScroll) {
    window.scrollTo(0, resultsScrollY);
  } else {
    focusCombinedHeading();
  }
}

// Builds the link from the visitor's own ratings and shares or copies it.
async function shareMyTaste() {
  let link;
  try {
    link = shareLink(location.href, encodeTaste(getAllRatings().slice(0, MAX_FILMS)));
  } catch (error) {
    setShareStatus("Couldn't make a link from your ratings.");
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: 'CoCinema', text: 'Rate your own films and we will find ones we would both enjoy.', url: link });
      setShareStatus('Link shared.');
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return;
      }
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    setShareStatus('Link copied. Send it to your friend.');
  } catch (error) {
    setShareStatus('Copy this link and send it to your friend:', link);
  }
}

// A made-up friend goes through exactly the path a real link takes: encoded, then decoded
// against the catalog, then combined.
function trySampleFriend(key) {
  const ratings = buildSampleFriend(catalog, key);
  const decoded = ratings ? decodeTaste(encodeTaste(ratings), new Set(catalogById.keys())) : null;
  if (!decoded || !decoded.ok) {
    setShareStatus("Couldn't build that sample friend.");
    return;
  }
  saveFriend({ ratings: decoded.ratings, skipped: decoded.skipped, sample: key });
  soloView = false;
  showCombined();
}

function stripHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

function clearFriendBanner() {
  document.querySelectorAll('.friend-banner, .friend-notice').forEach(node => node.remove());
}

function insertOnLanding(node) {
  const actions = document.querySelector('.hero-actions');
  actions.insertBefore(node, document.getElementById('length-choice'));
}

// The visitor opened a friend's link (#/with/<payload>).
function showFriendLanding(payload) {
  document.title = 'CoCinema';
  clearFriendBanner();
  const decoded = decodeTaste(payload, new Set(catalogById.keys()));
  const usable = decoded.ok && recommend(decoded.ratings, catalog, 1).length > 0;

  if (!usable) {
    pendingFriend = null;
    stripHash();
    const text = decoded.ok
      ? "That link didn't have enough films we know to compare tastes. Ask your friend for a new one."
      : "That link doesn't look right, so we couldn't open it. Ask your friend to send it again.";
    if (started) {
      showFinished(text);
    } else {
      showOnly(landingScreen);
      insertOnLanding(renderFriendNotice(text));
    }
    return;
  }

  pendingFriend = { ratings: decoded.ratings, skipped: decoded.skipped, sample: null };
  const finished = started && !extra && genreIndex >= session.length && recommend(getAllRatings(), catalog, 1).length > 0;
  showOnly(landingScreen);
  insertOnLanding(renderFriendBanner({
    count: decoded.ratings.length,
    skipped: decoded.skipped,
    hasSaved: finished,
    onUseSaved: () => {
      saveFriend(pendingFriend);
      pendingFriend = null;
      soloView = false;
      stripHash();
      showFinished();
    },
  }));
  document.getElementById('friend-banner-title').tabIndex = -1;
  document.getElementById('friend-banner-title').focus({ preventScroll: true });
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
    pendingFriend = null;
    clearFriendBanner();
    showOnly(landingScreen);
    return;
  }
  if (extra) {
    resumeExtra();
  } else if (genreIndex >= session.length) {
    showFinished(undefined, cameFromResults);
  } else {
    showCurrentMovie();
  }
}

function route() {
  const target = parseHash(location.hash);
  if (target.type === 'movie') {
    showDetail(target.qid);
  } else if (target.type === 'with') {
    showFriendLanding(target.payload);
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
  pendingFriend = null;
  soloView = false;
  clearFriendBanner();
  clearLengthChoice();
  resultsScreen.innerHTML = '';
  ratingScreen.innerHTML = '';
  detailScreen.innerHTML = '';
  history.replaceState(null, '', location.pathname + location.search);
  document.title = 'CoCinema';
  showOnly(landingScreen);
  landingScreen.querySelector('h1').focus({ preventScroll: true });
}

// ---- Landing page extras ----

// The decorative poster strip. The list is shown twice so the drift loops without a jump; each
// tile has its title underneath, so a poster that cannot load leaves a plain tile, not a broken image.
function renderPosterStrip() {
  const track = document.getElementById('poster-track');
  if (!track) return;
  for (const film of [...LANDING_POSTERS, ...LANDING_POSTERS]) {
    const tile = document.createElement('div');
    tile.className = 'strip-tile';

    const label = document.createElement('span');
    label.textContent = `${film.title} (${film.year})`;

    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove());
    image.src = film.poster;

    tile.append(label, image);
    track.append(tile);
  }
}

function fillLandingNumber(name, text) {
  document.querySelectorAll(`[data-fill="${name}"]`).forEach(node => { node.textContent = text; });
}

// Numbers on the landing page come from the data itself, so they cannot go out of date.
function fillLandingNumbers() {
  // Marketing copy gets a rounded-down label ("550+"), never the exact count.
  fillLandingNumber('films', roundedCount(catalog.length) || 'many');
  fillLandingNumber('dimensions', String(catalog[0] && catalog[0].embedding ? catalog[0].embedding.length : ''));
}

renderPosterStrip();
// The "better than chance" figure is the lift from the latest evaluation run (src/evaluation-stats.js).
fillLandingNumber('lift', `${EVALUATION.lift.toFixed(1)}x`);

document.getElementById('how-link').addEventListener('click', event => {
  event.preventDefault();
  const section = document.getElementById('how');
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  // Moving focus while a smooth scroll is running can cut the scroll short, so wait for it to end.
  const heading = document.getElementById('how-title');
  heading.tabIndex = -1;
  let focused = false;
  const focusHeading = () => {
    if (focused) return;
    focused = true;
    heading.focus({ preventScroll: true });
  };
  window.addEventListener('scrollend', focusHeading, { once: true });
  setTimeout(focusHeading, calm ? 0 : 1200);
});

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

const LENGTH_TEXT = { 10: 'Ready: 10 films', 15: 'Ready: 15 films' };

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
  if (started) {
    // Rating again from a friend's link replaces the saved session.
    clearSavedState();
    genreIndex = 0;
    movieIndex = 0;
    extra = null;
    seed = newSeed();
  }
  started = true;
  sessionLength = length;
  session = buildSession(onboarding, seed, sessionLength);
  saveSeed(seed);
  saveLength(sessionLength);
  if (COWATCH_ENABLED && pendingFriend) {
    saveFriend(pendingFriend);
    pendingFriend = null;
    clearFriendBanner();
    stripHash();
  }
  soloView = false;
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
  fillLandingNumbers();
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
