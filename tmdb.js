/**
 * --- IL CERCATORE DI FILM (TMDB) ---
 * Questo file è come un assistente che va su internet a cercare informazioni.
 * Quando scrivi il titolo di un film, lui corre sul sito TMDB e torna con:
 * la locandina, il regista, gli attori e la trama.
 * Serve a non farti scrivere tutto a mano ogni volta.
 */

const TMDB_API_KEY = '0de9856190bca7ec5acd797969c1d952';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

function buildUrl(path, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  const queryParams = { api_key: TMDB_API_KEY, ...params };

  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function tmdbFetch(path, params = {}) {
  const url = buildUrl(path, params);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TMDB fetch failed (${response.status}): ${text}`);
  }
  return response.json();
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
