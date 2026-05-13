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
  const [movie, credits] = await Promise.all([
    getMovieDetails(movieId),
    getMovieCredits(movieId)
  ]);
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

export async function getFirstMovieByTitleYear(title, year) {
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
