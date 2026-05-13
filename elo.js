/**
 * --- ELO RANKING SYSTEM (A/B Testing for Movies) ---
 * Implementa un sistema di confronto binario tra film usando la formula Elo.
 * Preserva il sistema di rating 1-10 esistente aggiungendo un campo eloRating.
 *
 * MODIFICHE:
 * - I delta Elo appaiono subito dopo la scelta, anche in caso di upset.
 * - Rimossi TUTTI i toast/popup durante le battaglie (ora silenzioso).
 * - Logica semplificata: l'Elo si salva immediatamente, la correzione rating è accessoria.
 */

import { auth, db } from './firebase.js';
import {
    collection,
    getDocs,
    updateDoc,
    doc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { openModal, closeModal } from './modal-manager.js';
import { showToast } from './utils.js';   // Mantenuto per eventuali altri usi, ma non chiamato in battle

// === COSTANTI ===
const INITIAL_ELO = 1200;

function getKFactor(matchCount = 0) {
    return matchCount <= 10 ? 40 : 20;
}

// === VARIABILI GLOBALI ===
let currentBattleMovieA = null;
let currentBattleMovieB = null;
let isBattleMode = false;
let nextBattleTimeoutId = null;
let battleChoiceLocked = false;
let hasRunEloMigration = false;

let ratingEditorState = {
    active: false,
    winnerConfirmed: false,
    loserConfirmed: false,
    winnerValue: null,
    loserValue: null,
    winnerMovieId: null,
    loserMovieId: null
};

/**
 * Calcola l'expected score (probabilità di vittoria) per il film A
 */
export function calculateExpectedScore(ratingA, ratingB) {
    const exponent = (ratingB - ratingA) / 400;
    return 1 / (1 + Math.pow(10, exponent));
}

/**
 * Calcola il nuovo punteggio Elo dopo una battaglia
 */
export function updateEloScore(currentRating, expectedScore, score, matchCount = 0) {
    const kFactor = getKFactor(matchCount);
    const newRating = currentRating + kFactor * (score - expectedScore);
    return Math.round(newRating);
}

/**
 * Inizializza l'eloRating per un film basato sul rating se non esiste
 */
export function initializeEloRating(movieData) {
    const hasRating = movieData.rating !== null && movieData.rating !== undefined;
    const rating = Number(movieData.rating) || 5;
    const baselineElo = Math.round(800 + (rating - 1) * (1200 / 9));

    if (movieData.eloRating == null) return baselineElo;
    if (movieData.eloRating === INITIAL_ELO && hasRating) return baselineElo;
    return movieData.eloRating;
}

// === PARAMETRI LEAPFROG ===
const LEAP_BONUS = 10;
const BASE_CONFIRM_REWARD = 15;
const MATCH_SCALE = 1;
const BASE_WEIGHT = 50;

function roundElo(value) {
    return Number(value.toFixed(2));
}

function formatDelta(value) {
    const rounded = Number(value.toFixed(1));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function calculateAverageEloByRating(movies) {
    const groups = new Map();
    movies.forEach(movie => {
        const ratingKey = Number(movie.rating);
        if (Number.isNaN(ratingKey)) return;
        const eloValue = initializeEloRating(movie);
        const existing = groups.get(ratingKey) || { totalElo: 0, count: 0 };
        existing.totalElo += eloValue;
        existing.count += 1;
        groups.set(ratingKey, existing);
    });
    const averages = new Map();
    groups.forEach((data, key) => averages.set(key, data.totalElo / data.count));
    return averages;
}

function selectWeightedMovieA(movies) {
    const averagesByRating = calculateAverageEloByRating(movies);
    const weightedMovies = movies.map(movie => {
        const ratingKey = Number(movie.rating);
        const movieElo = initializeEloRating(movie);
        const averageElo = averagesByRating.get(ratingKey) ?? movieElo;
        const deviation = Math.abs(movieElo - averageElo);
        const weight = deviation + BASE_WEIGHT;
        return { movie, weight };
    });
    const totalWeight = weightedMovies.reduce((sum, entry) => sum + entry.weight, 0);
    let random = Math.random() * totalWeight;
    for (const entry of weightedMovies) {
        random -= entry.weight;
        if (random <= 0) return entry.movie;
    }
    return weightedMovies.length ? weightedMovies[weightedMovies.length - 1].movie : null;
}

function getAnomalyDirection(movieA, averagesByRating) {
    const eloA = initializeEloRating(movieA);
    const averageElo = averagesByRating.get(Number(movieA.rating));
    if (averageElo == null) return 'normal';
    const difference = eloA - averageElo;
    if (difference <= -100) return 'climb';
    if (difference >= 100) return 'drop';
    return 'normal';
}

function selectDirectionalOpponent(movieA, movies, averagesByRating) {
    const movieAElo = initializeEloRating(movieA);
    const movieARating = Number(movieA.rating);
    const direction = getAnomalyDirection(movieA, averagesByRating);
    const candidates = movies
        .filter(m => m.id !== movieA.id)
        .map(m => ({ movie: m, elo: initializeEloRating(m), rating: Number(m.rating) }));

    let pool = [];
    if (direction === 'climb') {
        pool = candidates.filter(c => c.elo > movieAElo && c.elo <= movieAElo + 400 && c.rating < movieARating);
    } else if (direction === 'drop') {
        pool = candidates.filter(c => c.elo < movieAElo && c.elo >= movieAElo - 400 && c.rating > movieARating);
    } else {
        pool = candidates.filter(c => Math.abs(c.elo - movieAElo) <= 150);
    }
    if (pool.length === 0) pool = direction === 'climb'
        ? candidates.filter(c => c.elo > movieAElo && c.elo <= movieAElo + 400)
        : (direction === 'drop' ? candidates.filter(c => c.elo < movieAElo && c.elo >= movieAElo - 400) : []);
    if (pool.length === 0) {
        const fallback = candidates.sort((a, b) => Math.abs(a.elo - movieAElo) - Math.abs(b.elo - movieAElo));
        return fallback.length ? fallback[0].movie : null;
    }
    return pool[Math.floor(Math.random() * pool.length)].movie;
}

function clearNextBattleTimer() {
    if (nextBattleTimeoutId) {
        clearTimeout(nextBattleTimeoutId);
        nextBattleTimeoutId = null;
    }
}

export function resetEloSystemState() {
    hasRunEloMigration = false;
    isBattleMode = false;
    battleChoiceLocked = false;
    currentBattleMovieA = null;
    currentBattleMovieB = null;
    clearNextBattleTimer();
    resetRatingEditorState();
    removeRatingEditors();
}

function resetRatingEditorState() {
    ratingEditorState = {
        active: false,
        winnerConfirmed: false,
        loserConfirmed: false,
        winnerValue: null,
        loserValue: null,
        winnerMovieId: null,
        loserMovieId: null
    };
}

function removeRatingEditors() {
    ['battleMovieARatingEditor', 'battleMovieBRatingEditor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

// ==================== EDITOR RATING ====================

function renderSingleRatingEditor(containerId, movie, role) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'battle-rating-editor';

    const label = document.createElement('div');
    label.className = 'battle-rating-editor-label';
    label.textContent = role === 'winner' ? 'Winner rating' : 'Loser rating';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'battle-rating-input';
    input.min = '0';
    input.max = '10';
    input.step = '0.1';
    input.value = Number(movie.rating).toFixed(movie.rating % 1 === 0 ? 0 : 1);
    input.addEventListener('input', () => {
        ratingEditorState[`${role}Value`] = input.value;
    });
    input.addEventListener('click', (e) => e.stopPropagation());

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'battle-rating-save-button';
    button.textContent = 'OK';

    button.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleRatingEditorConfirm(role, movie.id, input, button, wrapper);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(button);
    container.appendChild(wrapper);
}

function renderRatingEditors(winnerMovie, loserMovie, winnerSide) {
    resetRatingEditorState();
    ratingEditorState.active = true;
    ratingEditorState.winnerMovieId = winnerMovie.id;
    ratingEditorState.loserMovieId = loserMovie.id;
    ratingEditorState.winnerValue = winnerMovie.rating;
    ratingEditorState.loserValue = loserMovie.rating;

    const winnerEditorId = winnerSide === 'A' ? 'battleMovieARatingEditor' : 'battleMovieBRatingEditor';
    const loserEditorId = winnerSide === 'A' ? 'battleMovieBRatingEditor' : 'battleMovieARatingEditor';

    renderSingleRatingEditor(winnerEditorId, winnerMovie, 'winner');
    renderSingleRatingEditor(loserEditorId, loserMovie, 'loser');
}

async function handleRatingEditorConfirm(role, movieId, inputElement, buttonElement, wrapperElement) {
    if (ratingEditorState[`${role}Confirmed`]) return;

    const rawValue = inputElement.value;
    const parsedValue = parseFloat(rawValue);
    if (Number.isNaN(parsedValue) || parsedValue < 0 || parsedValue > 10) {
        // Nessun toast: semplicemente non conferma se valore non valido;
        // volendo si può ripristinare il valore originale. Rimuoviamo il feedback.
        return;
    }

    const normalizedValue = Number(parsedValue.toFixed(1));
    ratingEditorState[`${role}Value`] = normalizedValue;
    ratingEditorState[`${role}Confirmed`] = true;

    inputElement.disabled = true;
    buttonElement.disabled = true;
    wrapperElement.classList.add('battle-rating-editor-confirmed');
    buttonElement.textContent = 'Saved';
    inputElement.value = normalizedValue;

    if (ratingEditorState.winnerConfirmed && ratingEditorState.loserConfirmed) {
        await finishRatingUpdate();
    }
}

/**
 * Salva solo i rating (l'Elo è già stato salvato in precedenza)
 * e carica la prossima battaglia.
 */
async function finishRatingUpdate() {
    if (!ratingEditorState.active) return;
    if (!ratingEditorState.winnerConfirmed || !ratingEditorState.loserConfirmed) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
        const updates = [];
        if (ratingEditorState.winnerMovieId) {
            updates.push(
                updateDoc(doc(db, 'users', user.uid, 'movies', ratingEditorState.winnerMovieId), {
                    rating: ratingEditorState.winnerValue
                })
            );
        }
        if (ratingEditorState.loserMovieId) {
            updates.push(
                updateDoc(doc(db, 'users', user.uid, 'movies', ratingEditorState.loserMovieId), {
                    rating: ratingEditorState.loserValue
                })
            );
        }
        await Promise.all(updates);
    } catch (error) {
        console.error('Errore aggiornamento rating:', error);
        // Nessun toast
    } finally {
        clearNextBattleTimer();
        battleChoiceLocked = false;
        resetRatingEditorState();
        removeRatingEditors();

        nextBattleTimeoutId = setTimeout(() => {
            if (isBattleMode) loadNextBattle();
        }, 500);
    }
}

// ==================== CALCOLO E SALVATAGGIO ELO ====================

export function computeLeapfrogElo(movieA, movieB, winnerIsA) {
    const eloA = Number(movieA.eloRating || 0);
    const eloB = Number(movieB.eloRating || 0);
    const countA = Number(movieA.matchCount || 0);
    const countB = Number(movieB.matchCount || 0);

    const winnerElo = winnerIsA ? eloA : eloB;
    const loserElo = winnerIsA ? eloB : eloA;
    const winnerCount = winnerIsA ? countA : countB;
    const loserCount = winnerIsA ? countB : countA;

    const gap = Math.abs(eloA - eloB);
    const senW = 1 / (1 + MATCH_SCALE * winnerCount);
    const senL = 1 / (1 + MATCH_SCALE * loserCount);
    const isUnderdogWin = winnerElo < loserElo;
    let winnerNewElo, loserNewElo, gain, loss;
    let hasOvertaken = false;

    if (isUnderdogWin) {
        gain = (gap * senW) + LEAP_BONUS;
        loss = gap * senL;
        winnerNewElo = winnerElo + gain;
        loserNewElo = loserElo - loss;
        hasOvertaken = true;
        if (winnerNewElo <= loserNewElo) {
            winnerNewElo = loserNewElo + 1;
            gain = winnerNewElo - winnerElo;
        }
    } else {
        const gapFactor = Math.max(0.1, 1 - (gap / 600));
        gain = BASE_CONFIRM_REWARD * gapFactor * senW;
        loss = BASE_CONFIRM_REWARD * gapFactor * senL;
        winnerNewElo = winnerElo + gain;
        loserNewElo = loserElo - loss;
    }

    const updatedMovieA = {
        ...movieA,
        eloRating: roundElo(winnerIsA ? winnerNewElo : loserNewElo),
        matchCount: countA + 1,
        hasOvertaken: winnerIsA ? hasOvertaken : false
    };
    const updatedMovieB = {
        ...movieB,
        eloRating: roundElo(winnerIsA ? loserNewElo : winnerNewElo),
        matchCount: countB + 1,
        hasOvertaken: winnerIsA ? false : hasOvertaken
    };

    return {
        updatedMovieA,
        updatedMovieB,
        isLeapfrog: isUnderdogWin,
        winnerDelta: Number(gain.toFixed(1)),
        loserDelta: Number(loss.toFixed(1))
    };
}

export async function saveLeapfrogResults(updatedMovieA, updatedMovieB) {
    const user = auth.currentUser;
    if (!user) throw new Error('Utente non autenticato');
    await Promise.all([
        updateDoc(doc(db, 'users', user.uid, 'movies', updatedMovieA.id), {
            eloRating: updatedMovieA.eloRating,
            matchCount: updatedMovieA.matchCount
        }),
        updateDoc(doc(db, 'users', user.uid, 'movies', updatedMovieB.id), {
            eloRating: updatedMovieB.eloRating,
            matchCount: updatedMovieB.matchCount
        })
    ]);
}

export async function updateLeapfrog(movieA, movieB, winnerIsA) {
    const { updatedMovieA, updatedMovieB, isLeapfrog, winnerDelta, loserDelta } = computeLeapfrogElo(movieA, movieB, winnerIsA);
    await saveLeapfrogResults(updatedMovieA, updatedMovieB);

    document.dispatchEvent(new CustomEvent('eloRankingUpdated', {
        detail: {
            updatedMovieA,
            updatedMovieB,
            isLeapfrog,
            winnerId: winnerIsA ? updatedMovieA.id : updatedMovieB.id,
            loserId: winnerIsA ? updatedMovieB.id : updatedMovieA.id
        }
    }));

    return {
        updatedMovieA,
        updatedMovieB,
        isLeapfrog,
        winnerDelta,
        loserDelta,
        winnerTitle: winnerIsA ? movieA.title : movieB.title,
        loserTitle: winnerIsA ? movieB.title : movieA.title,
        winnerId: winnerIsA ? updatedMovieA.id : updatedMovieB.id,
        loserId: winnerIsA ? updatedMovieB.id : updatedMovieA.id
    };
}

// ==================== GESTIONE BATTAGLIA ====================

async function getMoviesForBattle() {
    const user = auth.currentUser;
    if (!user) return [];
    const snapshot = await getDocs(collection(db, "users", user.uid, "movies"));
    return snapshot.docs
        .map(doc => ({
            id: doc.id,
            matchCount: typeof doc.data().matchCount === 'number' ? doc.data().matchCount : 0,
            ...doc.data()
        }))
        .filter(movie => !movie.isWatchlist && movie.rating > 0);
}

export async function startBattle() {
    try {
        isBattleMode = true;
        await loadNextBattle();
    } catch (error) {
        console.error("Error starting battle:", error);
        alert("Errore nell'avvio della battaglia. Riprova."); // solo alert per errore grave
    }
}

async function loadNextBattle() {
    if (!isBattleMode) return;

    try {
        const movies = await getMoviesForBattle();
        if (!movies || movies.length < 2) {
            alert("Hai bisogno di almeno 2 film valutati per iniziare una battaglia!");
            isBattleMode = false;
            return;
        }

        const averagesByRating = calculateAverageEloByRating(movies);
        const movieA = selectWeightedMovieA(movies);
        if (!movieA) {
            alert("Impossibile selezionare un film per iniziare la battaglia.");
            isBattleMode = false;
            return;
        }

        const eloA = initializeEloRating(movieA);
        const movieB = selectDirectionalOpponent(movieA, movies, averagesByRating);
        if (!movieB) {
            alert("Impossibile selezionare una coppia di film.");
            isBattleMode = false;
            return;
        }

        currentBattleMovieA = { ...movieA, eloRating: eloA };
        currentBattleMovieB = { ...movieB, eloRating: initializeEloRating(movieB) };
        displayBattleModal();
    } catch (error) {
        console.error("Error loading next battle:", error);
        alert("Errore nel caricamento della battaglia. Riprova.");
        isBattleMode = false;
    }
}

function displayBattleModal() {
    const modal = document.getElementById('battleModal');
    if (!modal) return;

    const movieACard = document.getElementById('battleMovieA');
    const movieBCard = document.getElementById('battleMovieB');

    if (movieACard && currentBattleMovieA) {
        const eloValueA = typeof currentBattleMovieA.eloRating === 'number'
            ? currentBattleMovieA.eloRating.toFixed(1) : '1200.0';
        movieACard.innerHTML = `
            <div class="battle-movie-container">
                <img src="${currentBattleMovieA.poster}" alt="${currentBattleMovieA.title}" class="battle-poster">
                <div class="battle-info">
                    <h3>${currentBattleMovieA.title}</h3>
                    <div class="battle-info-footer">
                        <p class="battle-rating">⭐ ${currentBattleMovieA.rating}/10</p>
                        <p id="battleMovieAElo" class="battle-elo">Elo: ${eloValueA}</p>
                    </div>
                </div>
            </div>
            <div id="battleMovieARatingEditor" class="battle-rating-editor-container"></div>
        `;
        movieACard.onclick = () => handleBattleChoice('A');
    }

    if (movieBCard && currentBattleMovieB) {
        const eloValueB = typeof currentBattleMovieB.eloRating === 'number'
            ? currentBattleMovieB.eloRating.toFixed(1) : '1200.0';
        movieBCard.innerHTML = `
            <div class="battle-movie-container">
                <img src="${currentBattleMovieB.poster}" alt="${currentBattleMovieB.title}" class="battle-poster">
                <div class="battle-info">
                    <h3>${currentBattleMovieB.title}</h3>
                    <div class="battle-info-footer">
                        <p class="battle-rating">⭐ ${currentBattleMovieB.rating}/10</p>
                        <p id="battleMovieBElo" class="battle-elo">Elo: ${eloValueB}</p>
                    </div>
                </div>
            </div>
            <div id="battleMovieBRatingEditor" class="battle-rating-editor-container"></div>
        `;
        movieBCard.onclick = () => handleBattleChoice('B');
    }

    document.getElementById('battleClose').onclick = () => closeModal('battleModal');
    openModal('battleModal');
}

export function closeBattleModal() {
    closeModal('battleModal');
    currentBattleMovieA = null;
    currentBattleMovieB = null;
    clearNextBattleTimer();
    resetRatingEditorState();
    removeRatingEditors();
    battleChoiceLocked = false;
}

/**
 * Gestisce la scelta dell'utente:
 * - Calcola Elo e matchCount
 * - Mostra SUBITO i delta nel DOM
 * - Salva immediatamente su Firebase
 * - Se c'è upset, mostra gli editor per correggere i rating (senza popup)
 * - Altrimenti carica la prossima battaglia
 */
async function handleBattleChoice(choice) {
    if (!currentBattleMovieA || !currentBattleMovieB || battleChoiceLocked) return;
    battleChoiceLocked = true;
    clearNextBattleTimer();

    try {
        const user = auth.currentUser;
        if (!user) {
            battleChoiceLocked = false;
            return;
        }

        const winnerIsA = choice === 'A';
        const { updatedMovieA, updatedMovieB, winnerDelta, loserDelta } =
            computeLeapfrogElo(currentBattleMovieA, currentBattleMovieB, winnerIsA);

        // Aggiorna i dati locali
        currentBattleMovieA = updatedMovieA;
        currentBattleMovieB = updatedMovieB;

        // ---- 1) Mostra SUBITO i delta Elo (indipendentemente dall'upset) ----
        const winnerEloId = winnerIsA ? 'battleMovieAElo' : 'battleMovieBElo';
        const loserEloId = winnerIsA ? 'battleMovieBElo' : 'battleMovieAElo';
        insertInlineEloDelta(winnerEloId, `+${formatDelta(winnerDelta)}`, 'gain');
        insertInlineEloDelta(loserEloId, `-${formatDelta(loserDelta)}`, 'loss');

        // ---- 2) Salva i nuovi Elo su Firebase (subito) ----
        await saveLeapfrogResults(updatedMovieA, updatedMovieB);

        // ---- 3) Verifica upset e, se necessario, mostra editor (senza toast) ----
        const winnerMovie = winnerIsA ? currentBattleMovieA : currentBattleMovieB;
        const loserMovie = winnerIsA ? currentBattleMovieB : currentBattleMovieA;
        const isRatingUpset = winnerMovie.rating < loserMovie.rating;

        if (isRatingUpset) {
            // Mostra gli editor di rating (l'Elo è già aggiornato e salvato)
            renderRatingEditors(winnerMovie, loserMovie, choice);
            // Nessun popup; l'utente potrà correggere i rating e premere OK.
            // battleChoiceLocked rimane true; sarà sbloccato in finishRatingUpdate().
        } else {
            // Nessun upset: sblocca e carica la prossima battaglia dopo un breve timer
            battleChoiceLocked = false;
            clearNextBattleTimer();
            nextBattleTimeoutId = setTimeout(() => {
                if (isBattleMode) loadNextBattle();
            }, 500);
        }

    } catch (error) {
        console.error("Error handling battle choice:", error);
        alert("Errore nell'aggiornamento. Riprova.");
        battleChoiceLocked = false;
    }
}

function insertInlineEloDelta(eloTextId, deltaText, type) {
    const eloElement = document.getElementById(eloTextId);
    if (!eloElement) return;
    const existing = eloElement.querySelector('.elo-gain, .elo-loss');
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = type === 'gain' ? 'elo-gain' : 'elo-loss';
    span.textContent = deltaText;
    eloElement.appendChild(span);
}

export async function getEloRanking() {
    try {
        const movies = await getMoviesForBattle();
        return movies
            .map(movie => ({
                ...movie,
                matchCount: typeof movie.matchCount === 'number' ? movie.matchCount : 0,
                eloRating: initializeEloRating(movie)
            }))
            .sort((a, b) => b.eloRating - a.eloRating);
    } catch (error) {
        console.error("Error getting Elo ranking:", error);
        return [];
    }
}

export async function migrateMoviesToElo() {
    if (hasRunEloMigration) {
        console.log('ℹ️ ELO migration already completed in this session');
        return 0;
    }

    const user = auth.currentUser;
    if (!user) {
        console.warn('⚠️ Cannot migrate: user not authenticated');
        return 0;
    }

    try {
        const snapshot = await getDocs(collection(db, "users", user.uid, "movies"));
        let migrated = 0, skipped = 0;

        for (const docSnap of snapshot.docs) {
            const movie = docSnap.data();
            if (movie.isWatchlist || !movie.rating) {
                skipped++;
                continue;
            }
            const correctedElo = initializeEloRating(movie);
            const currentElo = movie.eloRating;
            const hasMatchCount = typeof movie.matchCount === 'number';

            const needsUpdate = currentElo == null || currentElo === INITIAL_ELO || currentElo !== correctedElo;
            if (needsUpdate || !hasMatchCount) {
                const payload = { eloRating: correctedElo };
                if (!hasMatchCount) payload.matchCount = 0;
                await updateDoc(docSnap.ref, payload);
                migrated++;
            }
        }
        hasRunEloMigration = true;
        console.log(`✅ ELO migration: ${migrated} updated, ${skipped} skipped`);
        return migrated;
    } catch (error) {
        console.error("❌ Error migrating movies to Elo:", error);
        return 0;
    }
}