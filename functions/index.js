require('dotenv').config();
const functions = require('firebase-functions');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiApiKey() {
  return functions.config()?.gemini?.key || process.env.GEMINI_API_KEY;
}

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