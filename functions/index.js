require('dotenv').config();
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');

// IMPORTANTE: firebase-functions v7 carica v2 di default. La firma del callback
// di onCall è (request) — con request.data, request.auth, ecc. — NON (data, context)
// come in v1. Usando la firma v1 con la SDK v2, "context" finisce per essere
// l'oggetto response, che non ha .auth, quindi !context.auth è sempre true e
// ogni chiamata risponde "Utente non autenticato".

if (!admin.apps.length) admin.initializeApp();
const adminDb = admin.firestore();

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY;
}

function getTmdbApiKey() {
  return process.env.TMDB_API_KEY;
}

function getOmdbApiKey() {
  return process.env.OMDB_API_KEY;
}

// Path TMDB consentiti: previene che il proxy venga usato per chiamate arbitrarie
const ALLOWED_TMDB_PATHS = [
  /^\/search\/movie$/,
  /^\/search\/person$/,
  /^\/discover\/movie$/,
  /^\/movie\/\d+$/,
  /^\/movie\/\d+\/credits$/,
  /^\/movie\/\d+\/videos$/,
  /^\/movie\/\d+\/similar$/,
  /^\/movie\/\d+\/recommendations$/,
  /^\/genre\/movie\/list$/,
  /^\/find\/tt\d+$/   // lookup IMDb id → record TMDB (matching stretto)
];

function isAllowedTmdbPath(path) {
  return ALLOWED_TMDB_PATHS.some(re => re.test(path));
}

exports.tmdbProxy = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Utente non autenticato');
  }
  const { path, params = {} } = request.data || {};
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new HttpsError('invalid-argument', 'Path non valido');
  }
  if (!isAllowedTmdbPath(path)) {
    throw new HttpsError('permission-denied', `Path TMDB non consentito: ${path}`);
  }

  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'TMDB API key non configurata sul backend');
  }

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new HttpsError('internal', `TMDB ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('TMDB proxy error:', err);
    throw new HttpsError('internal', err.message || 'Errore TMDB');
  }
});

// ---------------------------------------------------------------------------
// OMDb proxy con cache Firestore condivisa (TTL 7 giorni)
//
// Perché: la API key OMDb era esposta lato client. Ogni utente attivava la
// propria quota e duplicava le richieste per film popolari. Spostando le
// chiamate qui:
//   1) la key resta sul backend (env OMDB_API_KEY)
//   2) la cache Firestore è condivisa tra TUTTI gli utenti → 100 utenti che
//      cercano "Inception" generano 1 sola chiamata OMDb effettiva
//   3) TTL 7 giorni: i rating IMDb cambiano lentamente, è ragionevole
// ---------------------------------------------------------------------------

const OMDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const OMDB_CACHE_COLLECTION = 'omdb_cache';

function omdbCacheKey({ imdbId, title, year }) {
  if (imdbId) return `id_${String(imdbId).replace(/[^a-zA-Z0-9]/g, '')}`;
  const t = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `t_${t}_${year || 'any'}`;
}

function normalizeOmdbPayload(json, imdbId) {
  if (!json || json.Response !== 'True') {
    return { rating: null, votes: null, imdbId: imdbId || null };
  }
  return {
    rating: json.imdbRating && json.imdbRating !== 'N/A' ? json.imdbRating : null,
    votes: json.imdbVotes && json.imdbVotes !== 'N/A' ? json.imdbVotes : null,
    imdbId: json.imdbID || imdbId || null,
    title: json.Title || null,
    year: json.Year || null,
    rated: json.Rated && json.Rated !== 'N/A' ? json.Rated : null,
    runtime: json.Runtime && json.Runtime !== 'N/A' ? json.Runtime : null,
    director: json.Director && json.Director !== 'N/A' ? json.Director : null,
    metascore: json.Metascore && json.Metascore !== 'N/A' ? json.Metascore : null,
    ratings: Array.isArray(json.Ratings) ? json.Ratings : []
  };
}

exports.omdbProxy = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Utente non autenticato');
  }
  const { imdbId, title, year } = request.data || {};
  if (!imdbId && !title) {
    throw new HttpsError('invalid-argument', 'imdbId o title obbligatori');
  }

  const key = omdbCacheKey({ imdbId, title, year });
  const cacheRef = adminDb.collection(OMDB_CACHE_COLLECTION).doc(key);

  // Cache read (best-effort: un errore qui non deve bloccare la chiamata)
  try {
    const snap = await cacheRef.get();
    if (snap.exists) {
      const cached = snap.data();
      if (cached?.fetchedAt && (Date.now() - cached.fetchedAt) < OMDB_CACHE_TTL_MS) {
        return cached.payload || { rating: null, votes: null };
      }
    }
  } catch (e) {
    console.warn('[omdbProxy] cache read failed for', key, e.message);
  }

  const apiKey = getOmdbApiKey();
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'OMDB_API_KEY non configurata sul backend');
  }

  const url = imdbId
    ? `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${apiKey}`
    : `https://www.omdbapi.com/?t=${encodeURIComponent(title)}${year ? `&y=${encodeURIComponent(year)}` : ''}&apikey=${apiKey}`;

  let payload;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new HttpsError('internal', `OMDb ${res.status}`);
    }
    const json = await res.json();
    payload = normalizeOmdbPayload(json, imdbId);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('[omdbProxy] fetch error:', err);
    throw new HttpsError('internal', err.message || 'Errore OMDb');
  }

  // Cache write (best-effort)
  cacheRef.set({
    key,
    payload,
    fetchedAt: Date.now(),
    fetchedAtIso: new Date().toISOString(),
    queriedBy: { imdbId: imdbId || null, title: title || null, year: year || null }
  }).catch(e => console.warn('[omdbProxy] cache write failed:', e.message));

  return payload;
});

function createAiModel() {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    throw new Error('Missing Gemini API key: set process.env.GEMINI_API_KEY');
  }
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

exports.analyzeReview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Utente non autenticato');
  }

  const { reviewText, action } = request.data || {};

  try {
    let prompt = '';

    switch (action) {
      case 'sentiment':
        prompt = `Analizza il sentiment di questa recensione di film: "${reviewText}". Rispondi solo con: positivo/negativo/neutro`;
        break;
      case 'summary':
        prompt = `Crea un riassunto breve (max 50 parole) di questa recensione: "${reviewText}"`;
        break;
      case 'title':
        prompt = `Genera un titolo accattivante per questa recensione di film: "${reviewText}". Max 10 parole.`;
        break;
      case 'advice':
        prompt = `Basandoti su questa recensione, fornisci 2-3 consigli pratici per migliorare future recensioni simili: "${reviewText}"`;
        break;
      case 'chat':
        prompt = `Sei l'assistente esperto di Sebas-Reviews. Rispondi in italiano in modo amichevole e conciso al seguente messaggio dell'utente: "${reviewText}"`;
        break;
      default:
        throw new HttpsError('invalid-argument', 'Azione non valida');
    }

    const model = createAiModel();
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    return { result: response };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Errore AI:', error);
    throw new HttpsError('internal', 'Errore nell\'analisi AI');
  }
});
