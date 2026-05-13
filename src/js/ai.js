/**
 * --- AI MODULE (Gemini Integration via Firebase Functions) ---
 * Questo modulo gestisce l'integrazione con Google Gemini tramite Cloud Functions.
 * La chiave API è protetta nel backend - non viene mai esposta al browser.
 */

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const functions = getFunctions();
const analyzeReviewFn = httpsCallable(functions, 'analyzeReview');

/**
 * Analizza una recensione di film utilizzando Gemini (via Cloud Function)
 * @param {string} movieTitle - Titolo del film
 * @param {string} reviewText - Testo della recensione
 * @returns {Promise<Object>} Oggetto con sentiment e summary
 */
export async function getAiReviewAdvice(movieTitle, reviewText) {
    if (!movieTitle || !reviewText) {
        throw new Error("Movie title and review text are required");
    }

    try {
        // Chiama la Cloud Function per analizzare il sentiment
        const sentimentResult = await analyzeReviewFn({
            reviewText: `Film: "${movieTitle}"\nRecensione: "${reviewText}"`,
            action: 'sentiment'
        });

        // Chiama la Cloud Function per il riassunto
        const summaryResult = await analyzeReviewFn({
            reviewText: reviewText,
            action: 'summary'
        });

        return {
            sentiment: sentimentResult.data.result.toLowerCase().includes('positivo') ? 'positive' : 
                      sentimentResult.data.result.toLowerCase().includes('negativo') ? 'negative' : 'neutral',
            summary: summaryResult.data.result,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error("AI Review Analysis Error:", error);
        throw new Error(`Failed to analyze review: ${error.message}`);
    }
}

/**
 * Genera suggerimenti per migliorare una recensione (via Cloud Function)
 * @param {string} movieTitle - Titolo del film
 * @param {string} reviewText - Testo della recensione
 * @returns {Promise<Object>} Oggetto con suggerimenti
 */
export async function getReviewImprovementTips(movieTitle, reviewText) {
    if (!movieTitle || !reviewText) {
        throw new Error("Movie title and review text are required");
    }

    try {
        const result = await analyzeReviewFn({
            reviewText: `Film: "${movieTitle}"\nRecensione: "${reviewText}"`,
            action: 'advice'
        });

        return {
            tips: result.data.result.split('\n').filter(t => t.trim()),
            strengths: [],
            weaknesses: [],
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error("AI Review Tips Error:", error);
        throw new Error(`Failed to generate review tips: ${error.message}`);
    }
}

/**
 * Genera un titolo suggerito per una recensione (via Cloud Function)
 * @param {string} movieTitle - Titolo del film
 * @param {string} reviewText - Testo della recensione
 * @returns {Promise<string>} Titolo suggerito
 */
export async function generateReviewTitle(movieTitle, reviewText) {
    if (!movieTitle || !reviewText) {
        throw new Error("Movie title and review text are required");
    }

    try {
        const result = await analyzeReviewFn({
            reviewText: `Film: "${movieTitle}"\nRecensione: "${reviewText}"`,
            action: 'title'
        });

        return result.data.result.trim() || "Review";
    } catch (error) {
        console.error("AI Title Generation Error:", error);
        throw new Error(`Failed to generate title: ${error.message}`);
    }
}

/**
 * Traduce una recensione in un'altra lingua
 * Nota: Questa funzione non è attualmente disponibile tramite Cloud Functions
 * @param {string} reviewText - Testo della recensione
 * @param {string} targetLanguage - Lingua target (es. "inglese", "francese")
 * @returns {Promise<string>} Testo tradotto
 */
export async function translateReview(reviewText, targetLanguage = "inglese") {
    if (!reviewText) {
        throw new Error("Review text is required");
    }

    // Questa funzione non è implementata nel backend per il momento
    console.warn("translateReview non è disponibile tramite Cloud Functions");
    throw new Error("Translation feature is not available yet. Please use the backend analyzeReview Cloud Function instead.");
}
