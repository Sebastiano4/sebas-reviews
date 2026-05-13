/**
 * SERVICE WORKER – cache stale-while-revalidate per file locali.
 * Strategia: servi subito dalla cache (istantaneo), poi aggiorna in background.
 * Le richieste a Firebase, TMDB e altri domini esterni vengono ignorate.
 */

const CACHE_NAME = 'movie-battle-v4';

const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './src/css/style.css',
  './src/js/app.js',
  './src/js/firebase.js',
  './src/js/tmdb.js',
  './src/js/utils.js',
  './src/js/ui.js',
  './src/js/stats.js',
  './src/js/ai.js',
  './src/js/gallery.js',
  './src/js/elo.js',
  './src/js/modal-manager.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('SW Install: some assets failed to precache', err);
      }))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Strategia stale-while-revalidate: cache hit immediato + refresh in background
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((cached) => {
      const networkPromise = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => cached);
      return cached || networkPromise;
    })
  );
}

self.addEventListener('fetch', (event) => {
  // Solo GET dello stesso dominio; tutto il resto passa invariato (Firebase, TMDB, ecc.)
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);

  // Navigazioni: prova la rete, fallback su index.html cached
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('./index.html').then((fallback) =>
          fallback || new Response('Offline', { status: 503 })
        )
      )
    );
    return;
  }

  // Asset locali: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// Permette al client di forzare lo skip waiting (per aggiornamenti rapidi)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
