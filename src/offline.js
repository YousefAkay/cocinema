// Registers the service worker and shows a small notice while the browser is offline.
// Both are optional extras: if anything here fails, the app works exactly as before.

function canRegister() {
  return 'serviceWorker' in navigator
    && (location.protocol === 'https:' || location.hostname === '127.0.0.1');
}

export async function registerServiceWorker() {
  if (!canRegister()) {
    return;
  }
  try {
    // Scope "/" lets the worker also serve the site root, which Vercel redirects to /src/.
    // That needs the Service-Worker-Allowed header; without it, fall back to the /src/ scope.
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: '/' });
    } catch (error) {
      await navigator.serviceWorker.register('./sw.js');
    }
  } catch (error) {
    console.warn('Offline support is not available:', error.message);
  }
}

export function watchOnlineStatus(notice) {
  if (!notice) {
    return;
  }
  const update = () => {
    notice.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
