require('dotenv').config();
const functions = require('firebase-functions');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiApiKey() {
  return functions.config()?.gemini?.key || process.env.GEMINI_API_KEY;
}

function getTmdbApiKey() {
  return functions.config()?.tmdb?.key || process.env.TMDB_API_KEY;
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
  /^\/genre\/movie\/list$/
];

function isAllowedTmdbPath(path) {
  return ALLOWED_TMDB_PATHS.some(re => re.test(path));
}

exports.tmdbProxy = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Utente non autenticato');
  }
  const { path, params = {} } = data || {};
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new functions.https.HttpsError('invalid-argument', 'Path non valido');
  }
  if (!isAllowedTmdbPath(path)) {
    throw new functions.https.HttpsError('permission-denied', `Path TMDB non consentito: ${path}`);
  }

  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    throw new functions.https.HttpsError('failed-precondition', 'TMDB API key non configurata sul backend');
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
      throw new functions.https.HttpsError('internal', `TMDB ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error('TMDB proxy error:', err);
    throw new functions.https.HttpsError('internal', err.message || 'Errore TMDB');
  }
});

function createAiModel() {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    throw new Error('Missing Gemini API key: set functions.config().gemini.key or process.env.GEMINI_API_KEY');
  }
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

exports.analyzeReview = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Utente non autenticato');
  }

  const { reviewText, action } = data;

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
        throw new functions.https.HttpsError('invalid-argument', 'Azione non valida');
    }

    const model = createAiModel();
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    return { result: response };
  } catch (error) {
    console.error('Errore AI:', error);
    throw new functions.https.HttpsError('internal', 'Errore nell\'analisi AI');
  }
});