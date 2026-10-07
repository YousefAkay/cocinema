import { renderPoster } from './ui.js';
import { titleWithYear, topGenres, capitalize } from './format.js';
import { trailerSearchUrl, whereToWatchLinks } from './links.js';

// Every piece of film data goes in with textContent or a property, never as HTML.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function externalLink(url, text, className) {
  const link = element('a', className, text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function signed(value) {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(4)}`;
}

function renderBreakdown(contributions) {
  const section = element('section', 'detail-section');
  section.append(element('h2', '', 'Why it fits you'));
  section.append(element('p', 'detail-help',
    'Each row is a film you rated. A bar to the right pushes this film up for you, a bar to the left pushes it down, '
    + 'and the longer the bar the bigger the push. The pushes add up to the total below.'));

  const biggest = Math.max(...contributions.map(item => Math.abs(item.contribution)), 1e-12);
  const list = element('ul', 'contrib-list');

  for (const item of contributions) {
    const row = element('li', 'contrib-row');
    row.append(element('span', 'contrib-label', `${titleWithYear(item)} · you rated ${item.score}`));

    const track = element('span', 'contrib-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = element('span', item.contribution >= 0 ? 'contrib-bar positive' : 'contrib-bar negative');
    bar.style.width = `${(Math.abs(item.contribution) / biggest) * 50}%`;
    track.append(bar);

    row.append(track, element('span', 'contrib-value', signed(item.contribution)));
    list.append(row);
  }

  const total = contributions.reduce((sum, item) => sum + item.contribution, 0);
  section.append(list, element('p', 'contrib-total', `Total: ${signed(total)}`));
  return section;
}

// movie: the catalog entry. context: { percent, userScore, contributions, genreOrder, onBack }.
export function renderDetail(movie, context) {
  const page = element('div', 'detail');

  page.append(backButton(context.onBack));

  const heading = element('h1', '', titleWithYear(movie));
  heading.tabIndex = -1;
  heading.id = 'detail-heading';

  const header = element('div', 'detail-header');
  const poster = element('div', 'detail-poster');
  poster.append(renderPoster(movie));

  const facts = element('div', 'detail-facts');
  facts.append(heading);

  const genres = topGenres(movie, context.genreOrder);
  const lines = [
    genres.length ? genres.map(capitalize).join(' · ') : null,
    movie.runtime,
    movie.director ? `Directed by ${movie.director}` : null,
    movie.rated ? `Rated ${movie.rated}` : null,
  ].filter(Boolean);
  for (const line of lines) {
    facts.append(element('p', 'detail-fact', line));
  }
  if (movie.rottenTomatoes) {
    facts.append(element('p', 'detail-rt', `Rotten Tomatoes: ${movie.rottenTomatoes}`));
  }
  header.append(poster, facts);
  page.append(header);

  if (context.userScore) {
    page.append(element('p', 'detail-rated', `You rated this ${context.userScore} out of 10.`));
  } else if (context.percent !== null && context.contributions.length > 0) {
    page.append(element('p', 'detail-match', `Top ${context.percent}% for your taste`));
    page.append(element('p', 'detail-help',
      'This ranks the film against the rest of the catalog for you. It is not the chance you will like it.'));
  }

  if (movie.plot) {
    const plot = element('section', 'detail-section');
    plot.append(element('h2', '', 'Plot'), element('p', 'detail-plot', movie.plot));
    page.append(plot);
  }

  if (!context.userScore && context.contributions.length > 0) {
    page.append(renderBreakdown(context.contributions));
  }

  const watch = element('section', 'detail-section');
  watch.append(element('h2', '', 'Watch'));
  watch.append(externalLink(trailerSearchUrl(movie), 'Search for the trailer on YouTube', 'detail-link trailer-link'));

  watch.append(element('h3', '', 'Where to watch'));
  const links = element('div', 'where-to-watch');
  for (const { country, url } of whereToWatchLinks(movie)) {
    links.append(externalLink(url, country, 'detail-link'));
  }
  watch.append(links);
  watch.append(element('p', 'detail-help',
    'These open a JustWatch search for the title. They are search links, not a guarantee the film is available.'));

  // Streaming service names from a data file will be added here later.
  const services = element('div', 'streaming-services');
  services.id = 'streaming-services';
  watch.append(services);

  page.append(watch);
  return page;
}

export function renderNotFound(onBack) {
  const page = element('div', 'detail');
  page.append(backButton(onBack));
  const heading = element('h1', '', 'Movie not found');
  heading.tabIndex = -1;
  heading.id = 'detail-heading';
  page.append(heading, element('p', 'detail-help', 'We could not find that film in the catalog.'));
  return page;
}

function backButton(onBack) {
  const button = element('button', 'back-button', '← Back');
  button.addEventListener('click', onBack);
  return button;
}
