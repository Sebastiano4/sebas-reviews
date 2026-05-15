require('dotenv').config();
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// IMPORTANTE: firebase-functions v7 carica v2 di default. La firma del callback
// di onCall è (request) — con request.data, request.auth, ecc. — NON (data, context)
// come in v1. Usando la firma v1 con la SDK v2, "context" finisce per essere
// l'oggetto response, che non ha .auth, quindi !context.auth è sempre true e
// ogni chiamata risponde "Utente non autenticato".

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY;
}

function getTmdbApiKey() {
  return process.env.TMDB_API_KEY;
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
