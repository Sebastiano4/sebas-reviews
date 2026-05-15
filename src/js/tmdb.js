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
  // 1) IMDb id → match diretto (nessun dubbio possibile).
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

  // Cerca con anno (più preciso). Se vuoto, fallback senza anno.
  let candidates = [];
  if (targetYear) {
    const r = await searchMoviesWithYear(title, targetYear, 1).catch(() => null);
    if (r?.results) candidates = r.results.slice();
  }
  if (candidates.length === 0) {
    const r = await searchMovies(title, 1).catch(() => null);
    if (r?.results) candidates = r.results.slice();
  }
  if (!candidates.length) return null;

  // Scoring
  const scored = [];
  for (const c of candidates) {
    const ct = normalizeTitle(c.title);
    const co = normalizeTitle(c.original_title);
    let score = 0;
    let exactTitle = false;

    if (ct === normTitle || co === normTitle) {
      score += 100;
      exactTitle = true;
    } else if (normOriginal && (ct === normOriginal || co === normOriginal)) {
      score += 90;
      exactTitle = true;
    } else if (ct.includes(normTitle) || normTitle.includes(ct)) {
      score += 25;
    } else {
      continue; // titoli completamente diversi: scartiamo subito
    }

    if (targetYear && c.release_date) {
      const cy = parseInt(c.release_date.split('-')[0], 10);
      if (Number.isFinite(cy)) {
        if (cy === targetYear) score += 50;
        else if (Math.abs(cy - targetYear) === 1) score += 20;
        else if (Math.abs(cy - targetYear) <= 3) score += 5;
        else score -= 40;
      }
    }

    if (targetCountry && Array.isArray(c.origin_country) && c.origin_country.length) {
      const codes = c.origin_country.map(x => String(x).toLowerCase());
      if (codes.includes(targetCountry)) score += 25;
    }

    // Popolarità come tie-breaker leggero
    score += Math.min(10, Math.log10((c.vote_count || 0) + 1) * 2);

    scored.push({ ...c, _score: score, _exactTitle: exactTitle });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b._score - a._score);

  // Se il director è noto, verifica i primi 3 candidati tramite /credits.
  // Saltiamo questa verifica quando il top candidate ha già uno score molto
  // alto (titolo esatto + anno esatto + paese) per non sprecare quota API.
  if (targetDirector && scored[0]._score < 170) {
    for (let i = 0; i < Math.min(scored.length, 3); i++) {
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
          return { ...cand, _matchedBy: 'director', _score: cand._score + 200 };
        }
      } catch (e) { /* ignora errori singoli */ }
    }
  }

  const top = scored[0];
  // Soglia minima: titolo esatto richiesto, o score generalmente alto.
  if (!top._exactTitle && top._score < 60) return null;

  return { ...top, _matchedBy: top._exactTitle ? 'title+year' : 'fuzzy' };
}

/**
 * Compat: vecchia firma. Ora delega al matcher stretto per evitare
 * collisioni con titoli simili. Restituisce comunque un risultato anche
 * quando il punteggio è basso, per mantenere il comportamento storico
 * nei flussi che non passano per il nuovo path.
 */
export async function getFirstMovieByTitleYear(title, year) {
  const strict = await findBestMovieMatch({ title, year });
  if (strict) return strict;
  // Fallback morbido: vecchio comportamento (primo risultato della ricerca).
  const data = await searchMoviesWithYear(title, year, 1);
  return data?.results?.[0] || null;
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
// IMDb rating via OMDb — with in-memory cache + concurrency limit
// ---------------------------------------------------------------------------
const OMDB_KEY = '3bab6459';
const imdbCache = new Map(); // key → { rating: string|null, votes: string|null }
const imdbPending = new Map(); // key → Promise (deduplica chiamate concorrenti)

let imdbInFlight = 0;
const imdbQueue = [];
const IMDB_MAX_CONCURRENT = 4;

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

/**
 * Recupera rating + numero voti IMDb via OMDb.
 * Accetta { imdbId } (preferito) o { title, year } come fallback.
 * Restituisce { rating: "7.3" | null, votes: "1,933,456" | null } o null se irraggiungibile.
 */
export async function fetchImdbRating({ imdbId, title, year } = {}) {
  const key = imdbId ? `id:${imdbId}` : `t:${(title || '').toLowerCase()}:${year || ''}`;
  if (imdbCache.has(key)) return imdbCache.get(key);
  if (imdbPending.has(key)) return imdbPending.get(key);

  const promise = enqueueImdb(async () => {
    const url = imdbId
      ? `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${OMDB_KEY}`
      : `https://www.omdbapi.com/?t=${encodeURIComponent(title || '')}${year ? `&y=${encodeURIComponent(year)}` : ''}&apikey=${OMDB_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.Response !== 'True') {
        const result = { rating: null, votes: null };
        imdbCache.set(key, result);
        return result;
      }
      const result = {
        rating: data.imdbRating && data.imdbRating !== 'N/A' ? data.imdbRating : null,
        votes: data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : null,
        imdbId: data.imdbID || imdbId || null
      };
      imdbCache.set(key, result);
      return result;
    } catch (err) {
      console.warn('[OMDb] fetch failed for', key, err);
      const result = { rating: null, votes: null };
      imdbCache.set(key, result);
      return result;
    }
  });

  imdbPending.set(key, promise);
  promise.finally(() => imdbPending.delete(key));
  return promise;
}
