/**
 * SERVICE WORKER – gestisce la cache per i file locali.
 * Le richieste a Firebase, TMDB e altri domini esterni vengono ignorate,
 * così da non rompere gli streaming in tempo reale.
 */

const CACHE_NAME = 'movie-battle-v2';

// Elenco dei file locali da mettere in cache.

const urlsToCache = [
  './index.html',
  './style.css',
  './app.js',
  './tmdb.js',
  './utils.js',
  './ui.js',
  './stats.js',
  './ai.js',
  './gallery.js',
  './elo.js',
  './modal-manager.js',
  './manifest.json'
];

// Installazione: crea la cache ma non blocca l'install se qualche risorsa fallisce
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(() => {
        console.log('SW Install: cache opened');
      })
      .catch((err) => {
        console.error('SW Install failed opening cache:', err);
      })
  );
  self.skipWaiting();
});

// Attivazione: pulisce le vecchie cache
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Gestione delle richieste
self.addEventListener('fetch', (event) => {
  // 1. Gestiamo SOLO richieste GET verso il nostro stesso dominio.
  // Tutto il resto (Firebase, TMDB, POST, ecc.) passa invariato.
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return; // Non intercettiamo la richiesta → nessun errore
  }

  const url = new URL(event.request.url);
  const pathname = url.pathname;
  const shouldNetworkFirst = ['/app.js', '/ui.js', '/style.css', '/index.html', '/ai.js', '/gallery.js'].some(p => pathname.endsWith(p));

  if (shouldNetworkFirst) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const responseToCache = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Se troviamo il file in cache, lo restituiamo
      if (response) return response;

      // Altrimenti lo prendiamo dalla rete
      return fetch(event.request).then((res) => {
        // Mettiamo in cache solo risposte valide e locali
        if (!res || res.status !== 200 || res.type !== 'basic') {
          return res;
        }

        const responseToCache = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return res;
      });
    }).catch(() => {
      // Se la rete non è disponibile e la richiesta è una navigazione,
      // mostriamo index.html (fallback offline)
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html').then((fallback) => {
          return fallback || caches.match('index.html');
        }).then((fallback) => {
          return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
