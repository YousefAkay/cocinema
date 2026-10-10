import { renderPoster } from './ui.js';
import { titleWithYear } from './format.js';
import { movieHash } from './route.js';
import { SAMPLE_FRIENDS } from './samples.js';

// Everything on screen for "Watch with a friend". All text from a link or from the data goes in
// with textContent, never as HTML.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export const PRIVACY_LINE = 'Your ratings are stored inside the link itself and are never sent to a server. Anyone who has the link can see them.';

// Shown on the visitor's own results: share a link, or try a made-up friend.
export function renderShareSection({ onShare, onSample }) {
  const section = element('section', 'cowatch-section');
  section.setAttribute('aria-labelledby', 'cowatch-title');
  section.append(element('h2', '', 'Watch with a friend'));
  section.firstChild.id = 'cowatch-title';
  section.firstChild.tabIndex = -1;
  section.append(element('p', 'cowatch-intro', 'Send a link, and when your friend rates their own films you both get one list of films that suit the two of you.'));

  const share = button('cowatch-button', navigator.share ? 'Share invite link' : 'Copy invite link', onShare);
  share.id = 'cowatch-share';
  section.append(share);
  const status = element('p', 'cowatch-status');
  status.setAttribute('role', 'status');
  status.id = 'cowatch-status';
  section.append(status);
  section.append(element('p', 'cowatch-privacy', PRIVACY_LINE));

  const samples = element('div', 'cowatch-samples');
  samples.append(element('h3', '', 'Try it with a sample friend'));
  samples.append(element('p', 'cowatch-intro', 'Made-up tastes for trying the feature on your own, not real people.'));
  const row = element('div', 'cowatch-sample-row');
  for (const sample of SAMPLE_FRIENDS) {
    row.append(button('cowatch-sample', `${sample.label} (sample)`, () => onSample(sample.key)));
  }
  samples.append(row);
  section.append(samples);
  return section;
}

// Lets the sharing button report what happened, where a screen reader will hear it.
export function setShareStatus(text, link) {
  const status = document.getElementById('cowatch-status');
  if (!status) return;
  status.replaceChildren(document.createTextNode(text));
  if (link) {
    const field = element('input', 'cowatch-link');
    field.type = 'text';
    field.readOnly = true;
    field.value = link;
    field.setAttribute('aria-label', 'Link to copy');
    status.append(field);
  }
}

// The invitation shown on the landing screen when the visitor opens a friend's link.
export function renderFriendBanner({ count, skipped, hasSaved, onUseSaved }) {
  const banner = element('section', 'friend-banner');
  banner.setAttribute('aria-labelledby', 'friend-banner-title');
  const title = element('h2', '', 'A friend shared their taste with you');
  title.id = 'friend-banner-title';
  banner.append(title);
  banner.append(element('p', '', `They rated ${count} ${count === 1 ? 'film' : 'films'}. Rate your own and you will both get one list of films you would enjoy together.`));
  if (skipped > 0) {
    banner.append(element('p', 'friend-banner-note', `${skipped} of their films ${skipped === 1 ? 'is' : 'are'} not in this catalog and will be left out.`));
  }
  if (hasSaved) {
    banner.append(button('friend-use-saved', 'Use my saved ratings', onUseSaved));
    banner.append(element('p', 'friend-banner-note', 'Or choose a length below to rate again. That replaces your saved ratings.'));
  }
  return banner;
}

// A short, polite notice on the landing screen, for a link that cannot be used.
export function renderFriendNotice(text) {
  const notice = element('p', 'friend-notice', text);
  notice.setAttribute('role', 'status');
  return notice;
}

// The combined list: films that suit both people.
export function renderCombined({ results, friendLabel, skipped, hasSolo, onSolo, onRateMore, onStartOver }) {
  const section = element('section', 'combined');
  section.setAttribute('aria-labelledby', 'combined-title');

  const hidden = element('h1', 'visually-hidden', "Films you'd both enjoy");
  hidden.tabIndex = -1;
  hidden.id = 'combined-heading';
  section.append(hidden);

  const heading = element('h2', '', "Films you'd both enjoy");
  heading.id = 'combined-title';
  heading.tabIndex = -1;
  section.append(heading);
  section.append(element('p', 'combined-intro', `A film ranks high here only if it suits both of you: films are ordered by whichever of the two matches is weaker. "Top N%" is where the film sits among the films neither of you has rated, from each person's own taste.`));
  if (skipped > 0) {
    section.append(element('p', 'combined-note', `${skipped} of your friend's rated ${skipped === 1 ? 'film was' : 'films were'} not in this catalog and left out.`));
  }

  const list = element('ol', 'combined-list');
  results.forEach((result, index) => {
    const item = element('li', 'combined-card');
    const poster = element('a', 'combined-poster');
    poster.href = movieHash(result.movie.id);
    poster.setAttribute('aria-hidden', 'true');
    poster.tabIndex = -1;
    poster.append(renderPoster(result.movie));

    const body = element('div', 'combined-body');
    const title = element('h3');
    const link = element('a', '', titleWithYear(result.movie));
    link.href = movieHash(result.movie.id);
    title.append(link);
    body.append(element('p', 'combined-rank', `#${index + 1}`));
    body.append(title);
    const figures = element('ul', 'combined-figures');
    figures.append(element('li', '', `You: Top ${result.percentA}%`));
    figures.append(element('li', '', `${friendLabel}: Top ${result.percentB}%`));
    body.append(figures);
    item.append(poster, body);
    list.append(item);
  });
  section.append(list);

  const actions = element('div', 'results-actions');
  if (hasSolo) actions.append(button('cowatch-solo', 'Back to my picks', onSolo));
  actions.append(button('rate-more', 'Rate 5 more', onRateMore));
  actions.append(button('start-over', 'Start over', onStartOver));
  section.append(actions);
  return section;
}

export function focusCombinedHeading() {
  const heading = document.getElementById('combined-title');
  if (heading) heading.focus({ preventScroll: true });
}
