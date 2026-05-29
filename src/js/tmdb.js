/**
 * --- IL CERCATORE DI FILM (TMDB) ---
 * Le richieste passano attraverso la Cloud Function `tmdbProxy`: la chiave API
 * resta sul backend e non viene mai esposta al browser. L'autenticazione utente
 * (Firebase Auth) viene verificata server-side.
 */

import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { auth, functions } from './firebase.js';

const tmdbProxyFn = httpsCallable(functions, 'tmdbProxy');

/**
 * Aspetta che Firebase Auth abbia risolto lo stato corrente prima di chiamare
 * la Cloud Function. Senza questa attesa, una chiamata partita prima del
 * primo onAuthStateChanged arriva con context.auth === null e il proxy
 * risponde "Utente non autenticato".
 */
function waitForAuthReady() {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      resolve(user);
    });
  });
}

async function tmdbFetch(path, params = {}) {
  try {
    const user = await waitForAuthReady();
    if (!user) {
      throw new Error('Devi essere autenticato per usare TMDB');
    }
    const result = await tmdbProxyFn({ path, params });
    return result.data;
  } catch (err) {
    throw new Error(`TMDB proxy failed: ${err.message || err.code || 'unknown error'}`);
  }
}

export async function searchMovies(query, page = 1) {
  return tmdbFetch('/search/movie', {
    language: 'en-US',
    query,
    page
  });
}

export async function searchMoviesWithYear(query, year, page = 1) {
  const params = {
    language: 'en-US',
    query,
    page
  };
  if (year) params.year = year;
  return tmdbFetch('/search/movie', params);
}

export async function discoverMovies(filters = {}, page = 1) {
  const { query, genre, year, sort = 'popularity.desc', minVotes } = filters;
  if (query && query.trim() !== '') {
    return searchMovies(query, page);
  }

  const params = {
    language: 'en-US',
    page,
    sort_by: sort
  };
  if (genre) params.with_genres = genre;
  if (year) params.primary_release_year = year;
  if (minVotes) params['vote_count.gte'] = minVotes;

  return tmdbFetch('/discover/movie', params);
}

export async function getMovieDetails(movieId, appendToResponse = '') {
  const params = {
    language: 'en-US'
  };
  if (appendToResponse) {
    params.append_to_response = appendToResponse;
  }
  return tmdbFetch(`/movie/${movieId}`, params);
}

export async function getMovieCredits(movieId) {
  return tmdbFetch(`/movie/${movieId}/credits`, {
    language: 'en-US'
  });
}

export async function getMovieDetailsWithCredits(movieId) {
  // append_to_response evita una round-trip aggiuntiva e ci dà subito anche
  // imdb_id + external_ids, indispensabili per il matching IMDb-first.
  const movie = await getMovieDetails(movieId, 'credits,external_ids');
  const credits = movie.credits || { cast: [], crew: [] };
  return { movie, credits };
}

export async function getGenreList() {
  return tmdbFetch('/genre/movie/list', {
    language: 'en-US'
  });
}

export async function getMovieVideos(movieId) {
  return tmdbFetch(`/movie/${movieId}/videos`, {
    language: 'en-US'
  });
}

export async function getSimilarMovies(movieId, page = 1) {
  return tmdbFetch(`/movie/${movieId}/similar`, {
    language: 'en-US',
    page
  });
}

// ---------------------------------------------------------------------------
// MATCHING ACCURATO — evita collisioni tra titoli simili (es. "Wonder" vs
// "Wonder Woman", "The Return" 2003 russo vs "The Return of the King")
// ---------------------------------------------------------------------------

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’‚‛'`]/g, "'")
    .replace(/[“”„‟"]/g, '"')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCountry(c) {
  if (!c) return null;
  const v = String(c).trim().toLowerCase();
  if (!v) return null;
  // Mappa nomi comuni → codice ISO-3166-1 a 2 lettere usato da TMDB.
  const map = {
    'usa': 'us', 'united states': 'us', 'united states of america': 'us', 'us': 'us', 'u.s.': 'us',
    'uk': 'gb', 'united kingdom': 'gb', 'great britain': 'gb', 'england': 'gb', 'gb': 'gb',
    'russia': 'ru', 'russian federation': 'ru', 'ussr': 'ru', 'soviet union': 'ru', 'ru': 'ru',
    'italy': 'it', 'italia': 'it', 'it': 'it',
    'france': 'fr', 'francia': 'fr', 'fr': 'fr',
    'germany': 'de', 'deutschland': 'de', 'de': 'de',
    'spain': 'es', 'españa': 'es', 'es': 'es',
    'japan': 'jp', 'jp': 'jp',
    'china': 'cn', 'cn': 'cn',
    'korea': 'kr', 'south korea': 'kr', 'kr': 'kr',
    'india': 'in', 'in': 'in',
    'mexico': 'mx', 'mx': 'mx',
    'brazil': 'br', 'br': 'br',
    'canada': 'ca', 'ca': 'ca',
    'australia': 'au', 'au': 'au',
    'argentina': 'ar', 'ar': 'ar'
  };
  if (map[v]) return map[v];
  if (/^[a-z]{2}$/i.test(v)) return v;
  return v;
}

/**
 * Risolve un IMDb id a un record TMDB tramite l'endpoint /find.
 * È il match più affidabile possibile: identifier univoco IMDb → TMDB.
 */
export async function findMovieByImdbId(imdbId) {
  if (!imdbId || typeof imdbId !== 'string' || !imdbId.startsWith('tt')) return null;
  try {
    const data = await tmdbFetch(`/find/${imdbId}`, {
      external_source: 'imdb_id',
      language: 'en-US'
    });
    return data?.movie_results?.[0] || null;
  } catch (err) {
    console.warn('[findMovieByImdbId] failed for', imdbId, err);
    return null;
  }
}

/**
 * Trova la migliore corrispondenza TMDB applicando regole strette di matching.
 * Tiene conto di: imdbId (priorità assoluta), titolo esatto, titolo originale,
 * anno (±1), paese di produzione e regista (verificato via /credits sui top 3).
 *
 * Restituisce un oggetto TMDB arricchito con `_matchedBy` e `_score`, oppure
 * null se nessun candidato raggiunge la soglia minima di affidabilità.
 *
 * NOTE: la validazione tramite director costa una chiamata /credits aggiuntiva
 * per ogni candidato controllato (max 3) — è il prezzo per evitare falsi
 * positivi su titoli generici. Quando il director non è noto, usiamo solo
 * titolo + anno + paese, che già copre la grande maggioranza dei casi.
 */
export async function findBestMovieMatch({
  title,
  originalTitle,
  year,
  country,
  director,
  imdbId
} = {}) {
  // 1) IMDb id → match diretto, fonte di verità assoluta.
  if (imdbId) {
    const hit = await findMovieByImdbId(imdbId);
    if (hit?.id) return { ...hit, _matchedBy: 'imdb_id', _score: Infinity };
  }

  if (!title || !String(title).trim()) return null;

  const normTitle = normalizeTitle(title);
  const normOriginal = originalTitle ? normalizeTitle(originalTitle) : null;
  const targetYear = year ? parseInt(year, 10) : null;
  const targetCountry = normalizeCountry(country);
  const targetDirector = director && director !== 'Unknown'
    ? normalizeTitle(director)
    : null;

  // Raccogli candidati: con anno (più preciso) e senza (fallback) → unione.
  // Cerchiamo in BOTH per non perdere casi con date strane.
  const pool = new Map(); // tmdb id → result
  if (targetYear) {
    const r = await searchMoviesWithYear(title, targetYear, 1).catch(() => null);
    (r?.results || []).forEach(c => { if (c?.id) pool.set(c.id, c); });
  }
  {
    const r = await searchMovies(title, 1).catch(() => null);
    (r?.results || []).forEach(c => { if (c?.id) pool.set(c.id, c); });
  }
  if (pool.size === 0) return null;

  // FASE 1: filtra solo i candidati con TITOLO ESATTO (title o original_title).
  // Niente substring/inclusione: "wonder" non deve mai accoppiarsi a "wonder
  // woman", "the return" non deve mai accoppiarsi a "the return of the king".
  const exactMatches = [];
  for (const c of pool.values()) {
    const ct = normalizeTitle(c.title);
    const co = normalizeTitle(c.original_title);
    const isExact =
      ct === normTitle ||
      co === normTitle ||
      (normOriginal && (ct === normOriginal || co === normOriginal));
    if (isExact) exactMatches.push(c);
  }
  if (!exactMatches.length) return null; // nessun match esatto → fallisci

  // FASE 2: scoring tra i candidati a titolo esatto.
  const scored = exactMatches.map(c => {
    let score = 100; // baseline (titolo esatto)
    let yearScore = 0;
    if (targetYear && c.release_date) {
      const cy = parseInt(c.release_date.split('-')[0], 10);
      if (Number.isFinite(cy)) {
        if (cy === targetYear) yearScore = 80;
        else if (Math.abs(cy - targetYear) === 1) yearScore = 40;
        else if (Math.abs(cy - targetYear) <= 2) yearScore = 10;
        else yearScore = -120; // anno molto diverso → quasi sicuramente sbagliato
      }
    }
    score += yearScore;
    if (targetCountry && Array.isArray(c.origin_country) && c.origin_country.length) {
      const codes = c.origin_country.map(x => String(x).toLowerCase());
      if (codes.includes(targetCountry)) score += 40;
    }
    score += Math.min(8, Math.log10((c.vote_count || 0) + 1) * 1.5);
    return { ...c, _score: score, _yearScore: yearScore };
  });
  scored.sort((a, b) => b._score - a._score);

  // FASE 3: validazione anno (se fornito). Niente match con anno > 2 di
  // distanza, e MAI senza un candidato che abbia un anno coerente quando
  // l'anno è critico per la disambiguazione.
  if (targetYear) {
    const yearOk = scored.filter(c => {
      const cy = c.release_date ? parseInt(c.release_date.split('-')[0], 10) : NaN;
      return Number.isFinite(cy) && Math.abs(cy - targetYear) <= 2;
    });
    if (!yearOk.length) {
      // Anno fornito ma nessun candidato esatto entro ±2 anni → niente match.
      return null;
    }
    // Riduciamo i candidati a quelli con anno coerente.
    scored.length = 0;
    scored.push(...yearOk);
    scored.sort((a, b) => b._score - a._score);
  }

  // FASE 4: validazione director (se fornito). Se più candidati a titolo
  // esatto + anno, il regista è il tie-breaker definitivo.
  if (targetDirector && scored.length > 1) {
    for (let i = 0; i < Math.min(scored.length, 4); i++) {
      const cand = scored[i];
      try {
        const credits = await getMovieCredits(cand.id);
        const dirs = (credits?.crew || [])
          .filter(p => p.job === 'Director')
          .map(p => normalizeTitle(p.name));
        if (!dirs.length) continue;
        const matchesDir = dirs.some(d =>
          d === targetDirector ||
          d.includes(targetDirector) ||
          targetDirector.includes(d)
        );
        if (matchesDir) {
          return { ...cand, _matchedBy: 'director' };
        }
      } catch (_) { /* ignora errori singoli */ }
    }
    // Director fornito ma nessun candidato lo matcha → meglio nessun risultato
    // che uno sbagliato.
    return null;
  }

  return { ...scored[0], _matchedBy: 'title+year' };
}

/**
 * Validazione di un riferimento TMDB salvato in Firestore: garantisce che
 * il `tmdbId` memorizzato corrisponda davvero al film salvato (titolo
 * normalizzato uguale). Necessario per i record legacy in cui il tmdbId
 * fu assegnato dalla vecchia logica fuzzy e oggi punta a un film sbagliato.
 *
 * Restituisce { id, title, ... } se valido, null se va re-risolto da zero.
 */
export async function validateStoredTmdbId(savedMovie) {
  if (!savedMovie || !savedMovie.tmdbId) return null;
  try {
    const det = await getMovieDetails(savedMovie.tmdbId, 'external_ids');
    if (!det || !det.id) return null;
    const saved = normalizeTitle(savedMovie.title);
    const candTitle = normalizeTitle(det.title);
    const candOriginal = normalizeTitle(det.original_title);
    const matchesTitle = saved && (candTitle === saved || candOriginal === saved);

    // Year sanity: se entrambi gli anni sono noti e differiscono di oltre 2
    // anni, è probabile che il tmdbId punti al film sbagliato.
    if (savedMovie.year && det.release_date) {
      const savedYear = parseInt(savedMovie.year, 10);
      const candYear = parseInt(det.release_date.split('-')[0], 10);
      if (Number.isFinite(savedYear) && Number.isFinite(candYear)
          && Math.abs(savedYear - candYear) > 2) {
        return null;
      }
    }

    if (matchesTitle) return det;

    // Se l'imdb_id del record TMDB combacia con l'imdb salvato → fidiamoci.
    const savedImdb = savedMovie.imdbId || savedMovie.imdb_id;
    const candImdb = det.external_ids?.imdb_id || det.imdb_id;
    if (savedImdb && candImdb && savedImdb === candImdb) return det;

    return null; // titolo non corrisponde → re-risolvi
  } catch (_) {
    return null;
  }
}

/**
 * Risolve un film salvato in Firestore al record TMDB corretto, sempre.
 * Ordine di priorità (NON c'è fallback al "primo risultato"):
 *   1. IMDb id (autoritativo)
 *   2. tmdbId salvato, MA solo se il titolo TMDB combacia
 *   3. Match stretto su titolo + anno + paese + regista
 *   → null se nessuno dei precedenti è affidabile
 *
 * Usare questa funzione PRIMA di chiamare showFullMovieDetails / aprire il
 * trailer / cercare film simili. Evita che dati legacy con tmdbId sbagliato
 * propaghino l'errore lungo tutta la UX.
 */
export async function resolveSavedMovieToTmdb(savedMovie) {
  if (!savedMovie) return null;
  // 1) IMDb id
  const imdb = savedMovie.imdbId || savedMovie.imdb_id;
  if (imdb) {
    const hit = await findMovieByImdbId(imdb);
    if (hit?.id) return hit;
  }
  // 2) tmdbId salvato — validato
  if (savedMovie.tmdbId) {
    const validated = await validateStoredTmdbId(savedMovie);
    if (validated?.id) return validated;
  }
  // 3) Matcher stretto
  return findBestMovieMatch({
    title: savedMovie.title,
    originalTitle: savedMovie.originalTitle,
    year: savedMovie.year,
    director: savedMovie.director,
    country: savedMovie.production_countries?.[0]?.iso_3166_1,
    imdbId: imdb
  });
}

/**
 * Compat: vecchia firma. SOLO match stretto, nessun fallback al primo
 * risultato di ricerca. Restituisce null quando il matcher non è certo —
 * preferiamo "nessun risultato" a "risultato sbagliato".
 */
export async function getFirstMovieByTitleYear(title, year) {
  return findBestMovieMatch({ title, year });
}

async function searchPerson(name, page = 1) {
  return tmdbFetch('/search/person', {
    language: 'en-US',
    query: name,
    page
  });
}

export async function fetchDirectorImage(directorName) {
  try {
    const data = await searchPerson(directorName);
    const profilePath = data?.results?.[0]?.profile_path;
    return profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null;
  } catch (err) {
    console.warn(`Immagine non trovata per ${directorName}`, err);
    return null;
  }
}

export async function fetchActorImage(actorName) {
  try {
    const data = await searchPerson(actorName);
    const profilePath = data?.results?.[0]?.profile_path;
    return profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null;
  } catch (err) {
    console.warn(`Immagine non trovata per ${actorName}`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// IMDb rating via OMDb proxy server-side
//
// La chiamata OMDb è ora interamente lato server (Cloud Function omdbProxy):
//   1) la API key resta sul backend
//   2) la cache Firestore è condivisa tra utenti (TTL 7 giorni)
//   3) qui manteniamo due livelli di cache locale: in-memory (intra-sessione)
//      + IndexedDB (cross-session, TTL 7 giorni) per evitare round-trip
//      anche su refresh di pagina
// ---------------------------------------------------------------------------

const omdbProxyFn = httpsCallable(functions, 'omdbProxy');

const imdbCache = new Map();    // chiave → payload (cache hot in-memory)
const imdbPending = new Map();  // chiave → Promise (dedup concorrente)

let imdbInFlight = 0;
const imdbQueue = [];
const IMDB_MAX_CONCURRENT = 4;

const IMDB_IDB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const IMDB_IDB_NAME = 'sebas-omdb-cache';
const IMDB_IDB_STORE = 'imdb';
let imdbIdbPromise = null;

function openImdbIdb() {
  if (imdbIdbPromise) return imdbIdbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  imdbIdbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IMDB_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMDB_IDB_STORE)) {
          db.createObjectStore(IMDB_IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('[OMDb cache] IndexedDB open failed:', req.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('[OMDb cache] IndexedDB unavailable:', e);
      resolve(null);
    }
  });
  return imdbIdbPromise;
}

async function imdbIdbGet(key) {
  const db = await openImdbIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IMDB_IDB_STORE, 'readonly');
      const req = tx.objectStore(IMDB_IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function imdbIdbPut(record) {
  const db = await openImdbIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IMDB_IDB_STORE, 'readwrite');
    tx.objectStore(IMDB_IDB_STORE).put(record);
  } catch (e) { /* best-effort */ }
}

function runImdbQueue() {
  while (imdbInFlight < IMDB_MAX_CONCURRENT && imdbQueue.length) {
    const job = imdbQueue.shift();
    imdbInFlight++;
    job().finally(() => {
      imdbInFlight--;
      runImdbQueue();
    });
  }
}

function enqueueImdb(task) {
  return new Promise((resolve, reject) => {
    imdbQueue.push(() => task().then(resolve, reject));
    runImdbQueue();
  });
}

function imdbCacheKey({ imdbId, title, year }) {
  if (imdbId) return `id:${imdbId}`;
  return `t:${(title || '').toLowerCase()}:${year || ''}`;
}

/**
 * Recupera rating + voti IMDb via Cloud Function (OMDb proxy).
 * Tre livelli di cache: memory → IndexedDB → server (Firestore condiviso).
 * Accetta { imdbId } (preferito), o { title, year } come fallback.
 */
export async function fetchImdbRating({ imdbId, title, year } = {}) {
  const key = imdbCacheKey({ imdbId, title, year });

  // L1: memory
  if (imdbCache.has(key)) return imdbCache.get(key);
  // Dedup di richieste concorrenti
  if (imdbPending.has(key)) return imdbPending.get(key);

  const promise = (async () => {
    // L2: IndexedDB (cross-session)
    try {
      const rec = await imdbIdbGet(key);
      if (rec && rec.payload && rec.fetchedAt && (Date.now() - rec.fetchedAt) < IMDB_IDB_TTL_MS) {
        imdbCache.set(key, rec.payload);
        return rec.payload;
      }
    } catch (_) { /* ignora */ }

    // L3: server (Cloud Function con cache Firestore condivisa)
    return enqueueImdb(async () => {
      try {
        const user = await waitForAuthReady();
        if (!user) {
          // Senza auth non possiamo chiamare la callable: fallback graceful.
          const empty = { rating: null, votes: null };
          imdbCache.set(key, empty);
          return empty;
        }
        const res = await omdbProxyFn({ imdbId, title, year });
        const payload = res?.data || { rating: null, votes: null };
        imdbCache.set(key, payload);
        imdbIdbPut({ key, payload, fetchedAt: Date.now() }).catch(() => {});
        return payload;
      } catch (err) {
        console.warn('[OMDb proxy] failed for', key, err?.message || err);
        const fallback = { rating: null, votes: null };
        imdbCache.set(key, fallback);
        return fallback;
      }
    });
  })();

  imdbPending.set(key, promise);
  promise.finally(() => imdbPending.delete(key));
  return promise;
}

/**
 * Invalida la cache locale (memoria + IndexedDB). Utile per debugging o
 * dopo una operazione di repair che vuole forzare il refetch.
 */
export async function clearImdbCache() {
  imdbCache.clear();
  imdbPending.clear();
  const db = await openImdbIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IMDB_IDB_STORE, 'readwrite');
    tx.objectStore(IMDB_IDB_STORE).clear();
  } catch (e) { /* ignora */ }
}
