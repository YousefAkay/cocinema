// Offline support. Code (HTML, JS, CSS) is network-first so a phone with signal always gets the
// latest deploy; the large data files are stale-while-revalidate so they open instantly and
// still refresh in the background. Other origins (posters, fonts) are never touched.

const CACHE_NAME = 'cocinema-v8';
const NETWORK_TIMEOUT_MS = 4000;

// Everything the app needs to start, relative to this file (/src/).
const SHELL = [
  './', './index.html', './style.css', './logo.svg',
  './main.js', './ui.js', './ratings.js', './recommend.js', './similarity.js', './why.js', './dialog.js',
  './candidates.js', './percentile.js', './format.js', './links.js', './route.js',
  './detail.js', './availability.js', './shuffle.js', './offline.js', './progress.js', './evaluation-stats.js', './landing-posters.js', './cowatch.js', './combine.js', './flags.js', './samples.js', './cowatchScreens.js',
  './fonts/manrope-variable-latin.woff2', './fonts/instrument-serif-regular-latin.woff2',
  './fonts/instrument-serif-italic-latin.woff2',
];
// Cached when available; a miss is not fatal (availability.json may not exist yet, and the
// manifest and icons are only for installing the app).
const OPTIONAL = [
  '../data/catalog.json', '../data/onboarding.json', '../data/availability.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './favicon.svg', './favicon.ico',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    await Promise.allSettled(OPTIONAL.map(path => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isData(url) {
  return url.pathname.endsWith('.json') && url.pathname.includes('/data/');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  return (await refresh) || Response.error();
}

// Fonts never change under the same name, so the saved copy is used straight away.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const appRoot = new URL('./', self.location);
      // A page inside the app: serve the saved app shell.
      if (new URL(request.url).pathname.startsWith(appRoot.pathname)) {
        const shell = await cache.match(new URL('./index.html', self.location));
        if (shell) return shell;
      } else {
        // The site root, which the host redirects to the app: do the same redirect offline.
        return Response.redirect(appRoot.href, 302);
      }
    }
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Posters, fonts and anything else from another origin go straight to the network, so they
  // simply fail offline (and the page shows its placeholder).
  if (url.origin !== self.location.origin) return;
  // The worker file itself is always fetched fresh by the browser.
  if (url.pathname === self.location.pathname) return;

  if (url.pathname.includes('/fonts/')) {
    event.respondWith(cacheFirst(request).catch(() => Response.error()));
    return;
  }
  event.respondWith(isData(url) ? staleWhileRevalidate(request) : networkFirst(request));
});
