// --- FIREBASE CONNECTION ---
// 1. Import the initialized connection from your new file
import { auth, db, provider, functions } from './firebase.js';

// 2. Import the active Firebase functions needed to run logic in this file
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { collection, addDoc, getDocs, getDoc, query, doc, deleteDoc, updateDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import {
  searchMovies,
  searchMoviesWithYear,
  discoverMovies,
  getMovieDetails,
  getMovieCredits,
  getMovieDetailsWithCredits,
  getGenreList,
  getMovieVideos,
  getFirstMovieByTitleYear,
  getSimilarMovies
} from './tmdb.js';
import {
  showSkeletonLoaders,
  removeSkeletonLoaders,
  showToast,
  getMedian,
  getStdDev,
  toBase64,
  getRuntimeMinutes,
  hapticFeedback,
  ensurePapaParse,
  escapeHtml,
  escapeAttr,
  askConfirm
} from './utils.js';
import { initTheme, initBottomNav, initFiltersToggle, closeForm, closeReviewModal, openProfileModal, showProfileMainView, attachProfileListeners, showProfileConfirmPage, startRepairWithProgress, setUIDependencies } from './ui.js';
import { setStatsDependencies, initVaultMap } from './stats.js';
import { startBattle, closeBattleModal, migrateMoviesToElo, resetEloSystemState } from './elo.js';
import { initModalSystem, openModal, closeModal } from './modal-manager.js';
import { registerListener, unregisterAll } from './listener-registry.js';
import { enhanceAllSelects } from './custom-select.js';

// --- GLOBALS ---
let currentUser = null;

let currentMovieId = null, currentSelectedMovieExtras = {}, ratingChartInstance = null;
let isLoading = false, hasMore = true, currentOffset = 0, BATCH_SIZE = 20;
let exploreFilters = { query: '', genre: '', year: '', sort: 'popularity.desc', minVotes: 1000 };
let explorePage = 1;
let exploreHasMore = true;
let currentFilters = { search: '', director: '', year: '', genre: '', award: '', rating: '', hasReview: false, sort: 'newest_added', decade: '' };
let spotlightInterval = null;
let pendingScrollY = null;
let timeoutId;

let cachedMovies = null;
let pendingFetch = null;

async function fetchAllMovies() {
    if (!currentUser) return [];
    if (cachedMovies) return cachedMovies;
    if (pendingFetch) return pendingFetch;
    pendingFetch = (async () => {
        try {
            const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
            cachedMovies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return cachedMovies;
        } finally {
            pendingFetch = null;
        }
    })();
    return pendingFetch;
}

function invalidateMoviesCache() {
    cachedMovies = null;
}

function updateMovieInCache(id, changes) {
    if (!cachedMovies) return;
    const idx = cachedMovies.findIndex(m => m.id === id);
    if (idx !== -1) cachedMovies[idx] = { ...cachedMovies[idx], ...changes };
}

function removeMovieFromCache(id) {
    if (!cachedMovies) return;
    cachedMovies = cachedMovies.filter(m => m.id !== id);
}

// Esposti su window per i moduli (elo.js, ui.js) che scrivono senza dependency injection
window.invalidateMoviesCache = invalidateMoviesCache;
window.updateMovieInCache = updateMovieInCache;
window.removeMovieFromCache = removeMovieFromCache;

// --- VOTE MODAL (sostituisce prompt() nativo) ---
function askRating(movieTitle, currentRating) {
    return new Promise((resolve) => {
        const voteModal = document.getElementById('voteModal');
        const slider = document.getElementById('voteSlider');
        const valueLabel = document.getElementById('voteValueLabel');
        const title = document.getElementById('voteModalTitle');
        const confirmBtn = document.getElementById('voteConfirmBtn');
        const cancelBtn = document.getElementById('voteCancelBtn');
        const closeBtn = voteModal.querySelector('.close-vote');

        const startValue = (currentRating !== null && currentRating !== undefined && !isNaN(parseFloat(currentRating)))
            ? parseFloat(currentRating)
            : 7;
        slider.value = startValue;
        valueLabel.textContent = startValue.toFixed(1);
        title.textContent = `Rate "${movieTitle}"`;

        const onInput = () => {
            valueLabel.textContent = parseFloat(slider.value).toFixed(1);
            hapticFeedback('light');
        };
        const cleanup = () => {
            slider.removeEventListener('input', onInput);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            closeModal('voteModal');
        };
        const onConfirm = () => {
            const value = parseFloat(slider.value);
            cleanup();
            resolve(value);
        };
        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        slider.addEventListener('input', onInput);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);

        openModal('voteModal');
        setTimeout(() => slider.focus(), 50);
    });
}

function populateFilters(movies) {
    const years = [...new Set(movies.map(m => m.year))].filter(y => y && y !== 'N/A').sort().reverse();
    const dirs = [...new Set(movies.map(m => m.director))].filter(d => d && d !== 'Unknown').sort();
    const genresSet = new Set();
    movies.forEach(m => m.genres?.split(', ').forEach(g => genresSet.add(g)));
    document.getElementById('filterYear').innerHTML = '<option value="">All Years</option>' + years.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    document.getElementById('filterGenre').innerHTML = '<option value="">All Genres</option>' + Array.from(genresSet).sort().map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    document.getElementById('directorOptions').innerHTML = dirs.map(v => `<option value="${escapeAttr(v)}">`).join('');
}

async function showRecommendations(movies) {
    const favorites = movies.filter(m => !m.isWatchlist && m.rating >= 8);
    const watchlist = movies.filter(m => m.isWatchlist);
    const scored = watchlist.map(w => {
        let s = 0; favorites.forEach(f => { if(f.director === w.director) s+=5; if(f.genres === w.genres) s+=3; });
        return { movie: w, score: s };
    }).sort((a,b)=>b.score - a.score).slice(0,4);
    const grid = document.getElementById('recommendGrid');
    grid.innerHTML = '';
    scored.forEach(({movie}) => grid.appendChild(createSmallCard(movie)));
}

function createSmallCard(m) {
    const div = document.createElement('div'); div.className='movie-card'; div.onclick=()=>openReview(m.id);
    div.innerHTML = `<div class="poster-container"><img src="${escapeAttr(m.poster)}" alt=""></div><div class="card-info"><h3>${escapeHtml(m.title)}</h3></div>`;
    return div;
}

function updateSpotlightAndCounters(movies){
    const countersEl = document.getElementById('globalCounters');
    if (!countersEl) return;   // esce silenziosamente se l'elemento non c'è

    countersEl.innerText = `${movies.filter(m=>!m.isWatchlist).length} Watched | ${movies.filter(m=>m.isWatchlist).length} To Watch`;

    const viewMode = document.getElementById('viewMode')?.value;
    if (!viewMode) return;

    const list = movies.filter(m => !!m.isWatchlist === (viewMode==='watchlist'));

    if(list.length){
        const rand = list[Math.floor(Math.random()*list.length)];
        const titleEl = document.getElementById('spotlightTitle');
        const directorEl = document.getElementById('spotlightDirector');
        const backdropEl = document.getElementById('spotlightBackdrop');
        const headerEl = document.getElementById('spotlightHeader');

        if (!titleEl || !directorEl || !backdropEl || !headerEl) return;

        titleEl.innerText = rand.title;
        directorEl.innerText = `Directed by ${rand.director}`;
        const bgImage = rand.backdrop
            ? `url('${rand.backdrop}')`
            : `linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), url('${rand.poster}')`;
        backdropEl.style.backgroundImage = bgImage;
        headerEl.style.display='flex';
    }
}

function syncFilterUI(mode) {
    const normalFilters = document.getElementById('normalFilters');
    const exploreFilters = document.getElementById('exploreFilters');
    if (mode === 'explore') {
        normalFilters.style.display = 'none';
        exploreFilters.style.display = 'flex';
    } else {
        normalFilters.style.display = 'flex';
        exploreFilters.style.display = 'none';
    }
}

async function renderGallery(){
    const movies = await fetchAllMovies();
    if (typeof populateFilters === 'function') { populateFilters(movies); }
    updateSpotlightAndCounters(movies);
    showRecommendations(movies);
    resetInfiniteScroll();
    syncFilterUI(document.getElementById('viewMode').value);   // 👈 aggiungi questa riga
}



// --- UI MODULE DEPENDENCY INJECTION ---
// Set up dependencies for the UI module
setUIDependencies({
    showToast,
    toBase64,
    searchMoviesWithYear,
    getMovieDetails,
    getMovieCredits,
    getMovieVideos,
    getFirstMovieByTitleYear,
    signOut,
    collection,
    getDocs,
    deleteDoc,
    updateDoc,
    addDoc,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    auth,
    getCurrentUser: () => currentUser,
    getCurrentMovieId: () => currentMovieId,
    setCurrentMovieId: (id) => { currentMovieId = id; },
    getCurrentSelectedMovieExtras: () => currentSelectedMovieExtras,
    setCurrentSelectedMovieExtras: (value) => { currentSelectedMovieExtras = value; },
    fetchAllMovies,
    renderGallery
});
setStatsDependencies({
    fetchAllMovies,
    saveMovieProductionCountries: async (movieId, production_countries) => {
        if (!currentUser || !movieId) return;
        try {
            await updateDoc(doc(db, "users", currentUser.uid, "movies", movieId), { production_countries });
            updateMovieInCache(movieId, { production_countries });
        } catch (err) {
            console.warn('Failed to save production countries for map:', err);
        }
    }
});

initVaultMap();

// --- TEMA (SCURO / CHIARO) ---
// Theme logic moved to ui.js

// Initialize UI components
initTheme();
initBottomNav();
initFiltersToggle();
enhanceAllSelects();




// --- PROFILO / IMPOSTAZIONI ---
// Profile logic moved to ui.js


// Bottom navigation logic moved to ui.js

// DOM elements
const modal = document.getElementById('modal'), reviewModal = document.getElementById('reviewModal'), statsModal = document.getElementById('statsModal');
const tmdbSearch = document.getElementById('tmdbSearch'), searchResults = document.getElementById('searchResults');
const loginBtn = document.getElementById('login-btn'), logoutBtn = document.getElementById('logout-btn'), appContent = document.getElementById('app-content'), profileBtn = document.getElementById('profileBtn');

function getCacheBustedUrl(url) {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${Date.now()}`;
}

function updateProfileButtonAvatar(profilePic) {
    if (!profileBtn) return;
    if (profilePic) {
        profileBtn.innerHTML = `<img src="${getCacheBustedUrl(profilePic)}" alt="Avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover;display:block;">`;
        profileBtn.style.padding = '0.25rem';
    } else {
        profileBtn.innerText = '👤';
        profileBtn.style.padding = '0.5rem 1rem';
    }
}

console.log("Script avviato, modal:", modal);

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        appContent.hidden = false;
        
        // Initialize global modal system (only once per auth session)
        initModalSystem();
        
        if (profileBtn) {
            profileBtn.style.display = 'inline-block';   // 👈 mostra profilo
            let profilePic = localStorage.getItem('sebas-profile-pic') || user?.photoURL || null;
            let nickname = localStorage.getItem('sebas-nickname') || user?.displayName || '';
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    const remotePic = data.profilePic;
                    const remoteNick = data.nickname;
                    if (remotePic) {
                        profilePic = remotePic;
                        localStorage.setItem('sebas-profile-pic', profilePic);
                    }
                    if (remoteNick) {
                        nickname = remoteNick;
                        localStorage.setItem('sebas-nickname', nickname);
                    }
                }
            } catch (err) {
                console.warn('Impossibile leggere i dati del profilo da Firestore', err);
            }
            updateProfileButtonAvatar(profilePic);
        }
            loadExploreGenres().catch(err => console.error('Errore nel caricamento generi:', err));
        // Initialize battle button
        const bottomBattleBtn = document.getElementById('bottomBattleBtn');
        if (bottomBattleBtn) {
            bottomBattleBtn.addEventListener('click', async () => {
                await startBattle();
            });
        }

        // Migrate existing movies to Elo system (one-time operation)
        try {
            await migrateMoviesToElo();
        } catch (error) {
            console.warn('Error migrating movies to Elo:', error);
        }

        // Aggiorna i contatori "Watched | To Watch" subito dopo il login.
        // Senza questa chiamata la galleria viene popolata dall'IntersectionObserver
        // via loadMoreMovies(), che NON tocca updateSpotlightAndCounters(): i contatori
        // rimangono "0 | 0" finché l'utente non cambia view mode o filtro.
        try {
            const movies = await fetchAllMovies();
            updateSpotlightAndCounters(movies);
        } catch (err) {
            console.warn('Counters initial update failed:', err);
        }
    } else {
        // User logged out
        currentUser = null;
        // Chiude tutti i listener Firestore attivi per evitare leak
        unregisterAll();
        invalidateMoviesCache();
        loginBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        appContent.hidden = true;
        if (profileBtn) profileBtn.style.display = 'none';

        // Reset all global state
        resetEloSystemState();
    }
});

if(loginBtn) loginBtn.addEventListener('click', () => signInWithPopup(auth, provider));
if(logoutBtn) logoutBtn.addEventListener('click', () => signOut(auth));

// --- BATTLE BUTTON (Navbar) ---
const battleBtn = document.getElementById('battleBtn');
if (battleBtn) {
    battleBtn.addEventListener('click', async () => {
        if (!currentUser) {
            showToast('Please log in first');
            return;
        }
        await startBattle();
    });
}

// --- TMDB SEARCH ---
tmdbSearch.addEventListener('input', (e) => {
    clearTimeout(timeoutId);
    const q = e.target.value;
    if(q.length<3){ searchResults.innerHTML=''; return; }
    timeoutId = setTimeout(async()=>{
        const data = await searchMovies(q);
        searchResults.innerHTML = '';
        data.results.slice(0,5).forEach(movie=>{
            const div = document.createElement('div'); 
            div.className = 'dropdown-item'; 
            const posterHtml = movie.poster_path ? `<img src="https://image.tmdb.org/t/p/w92${encodeURIComponent(movie.poster_path).replace(/%2F/g,'/')}" alt="" class="dropdown-poster">` : `<div class="dropdown-poster" style="background:#0c0e12;"></div>`;
            div.innerHTML = `${posterHtml} <span>${escapeHtml(movie.title)} (${escapeHtml(movie.release_date?.split('-')[0]||'N/A')})</span>`;
            div.onclick = () => fetchMovieDetailsAndSelect(movie.id);
            searchResults.appendChild(div);
        });
    },500);
});

async function fetchMovieDetailsAndSelect(movieId) {
    // Recupera i dettagli del film e il cast
    const { movie, credits } = await getMovieDetailsWithCredits(movieId);
    
    // Estrae regista
    const dir = credits.crew.find(p => p.job === 'Director')?.name || 'Unknown';
    // Prende i primi 10 attori
    const castArray = credits.cast.slice(0, 10).map(a => a.name);

    // Assegna TUTTI i campi in un unico oggetto (nessuna sovrascrittura)
    currentSelectedMovieExtras = {
        year: movie.release_date?.split('-')[0] || 'N/A',
        director: dir,
        genres: movie.genres.map(g => g.name).join(', '),
        backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : '',
        runtime: movie.runtime ? `${movie.runtime} min` : 'N/A',
        cast: castArray,
        tmdbId: movieId,
        production_countries: Array.isArray(movie.production_countries) ? movie.production_countries : []
    };

    // Popola i campi del form
    document.getElementById('tmdbTitle').value = movie.title;
    document.getElementById('tmdbPlot').value = movie.overview;
    document.getElementById('tmdbPoster').value = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
    document.getElementById('previewTitle').innerText = movie.title;
    document.getElementById('previewPlot').innerText = movie.overview.substring(0, 200) + '...';
    document.getElementById('previewPoster').src = document.getElementById('tmdbPoster').value;
    document.getElementById('moviePreview').style.display = 'flex';
    searchResults.innerHTML = '';
}

// --- SAVE & FORM LOGIC ---
// Form logic moved to ui.js

document.getElementById('movieForm').onsubmit = async(e)=>{
    e.preventDefault();
    if(!currentUser) return;
    const isWatchlist = document.getElementById('isWatchlist').checked;

    // Valori sicuri per i campi extra (mai undefined)
    const safeExtras = {
        year: currentSelectedMovieExtras.year || '',
        director: currentSelectedMovieExtras.director || 'Unknown',
        genres: currentSelectedMovieExtras.genres || '',
        backdrop: currentSelectedMovieExtras.backdrop || '',
        runtime: currentSelectedMovieExtras.runtime || 'N/A',
        cast: currentSelectedMovieExtras.cast || [],
        tmdbId: currentSelectedMovieExtras.tmdbId || null,
        production_countries: Array.isArray(currentSelectedMovieExtras.production_countries) ? currentSelectedMovieExtras.production_countries : []
    };

    const movieData = {
        title: document.getElementById('tmdbTitle').value,
        plot: document.getElementById('tmdbPlot').value,
        poster: document.getElementById('tmdbPoster').value,
        rating: isWatchlist ? null : parseFloat(document.getElementById('rating').value),
        watchDate: isWatchlist ? null : document.getElementById('watchDate').value,
        isWatchlist,
        awards: isWatchlist ? [] : Array.from(document.querySelectorAll('.seba-award:checked')).map(cb=>cb.value),
        ...safeExtras,   // ora tutti i campi sono definiti
        updatedAt: serverTimestamp(),
        order: Date.now()
    };

    if (!movieData.title.trim()) {
    alert("Please search and select a movie first.");
    return;
}

    const fileInput = document.getElementById('reviewFile').files[0];
    if(fileInput){ movieData.fileData = await toBase64(fileInput); movieData.fileType = fileInput.type; }

        try {
        if (currentMovieId) {
            // 1. Aggiorna il documento su Firestore
            await updateDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId), movieData);
            updateMovieInCache(currentMovieId, movieData);

            // 2. Prepara l’oggetto completo del film (con id)
            const updatedMovie = { id: currentMovieId, ...movieData };

            // 3. Verifica se la card esiste nel DOM e se soddisfa ancora i filtri
            const existingCard = document.querySelector(`.movie-card[data-id="${currentMovieId}"]`);
            const isWatchlistMode = document.getElementById('viewMode').value === 'watchlist';

            if (existingCard) {
                if (moviePassesFilters(updatedMovie, currentFilters, isWatchlistMode)) {
                    // Sostituisci la card con quella aggiornata (nessuno scroll)
                    const newCard = createCardElement(updatedMovie, isWatchlistMode);
                    existingCard.replaceWith(newCard);
                } else {
                    // Il film non è più visibile: rimuovilo con una piccola animazione
                    existingCard.style.transition = 'opacity 0.3s, transform 0.3s';
                    existingCard.style.opacity = '0';
                    existingCard.style.transform = 'scale(0.8)';
                    setTimeout(() => existingCard.remove(), 300);
                }
            } // se la card non c'è (es. schermate diverse), non fare nulla

        } else {
            // Nuovo film: salva in Firestore
            movieData.createdAt = serverTimestamp();
            const newRef = await addDoc(collection(db, "users", currentUser.uid, "movies"), movieData);
            if (cachedMovies) {
                cachedMovies.unshift({ id: newRef.id, ...movieData });
            }

            closeForm();

            // Controlla se siamo in modalità Explore
            const viewMode = document.getElementById('viewMode').value;
            
            if (viewMode === 'explore') {
                // Trova la card appena aggiunta usando il titolo e rimuovila con un'animazione
                const addedTitle = movieData.title;
                const cards = document.querySelectorAll('#gallery .movie-card');
                cards.forEach(card => {
                    const titleEl = card.querySelector('h3');
                    if (titleEl && titleEl.textContent === addedTitle) {
                        card.style.transition = 'opacity 0.3s, transform 0.3s';
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.8)';
                        setTimeout(() => card.remove(), 300);
                    }
                });
                
                // Aggiorna solo i contatori in alto senza ricaricare la galleria
                const allMovies = await fetchAllMovies();
                updateSpotlightAndCounters(allMovies);
                showToast('Movie added!');
            } else {
                // Se siamo in Archivio o Watchlist, usa il vecchio metodo
                pendingScrollY = window.scrollY;   
                renderGallery();
            }
            return;
        }

        // Chiudi il form e aggiorna solo i contatori/spotlight (senza ricaricare le card)
        closeForm();
        const allMovies = await fetchAllMovies();
        updateSpotlightAndCounters(allMovies);
        showToast('Movie updated!');
    } catch (err) {
        console.error(err);
    }
};

// --- GALLERY & FILTERS ---
function moviePassesFilters(movie, filters, isWatchlistMode) {
    const searchTerm = filters.search.toLowerCase();
    const decade = filters.decade;

    if (!!movie.isWatchlist !== isWatchlistMode) return false;
    if (searchTerm && !movie.title.toLowerCase().includes(searchTerm) && !(movie.awards||[]).some(a=>a.toLowerCase().includes(searchTerm))) return false;
    if (filters.director && movie.director && !movie.director.toLowerCase().includes(filters.director.toLowerCase())) return false;
    if (filters.year && movie.year !== filters.year) return false;
    if (filters.genre && !(movie.genres||'').includes(filters.genre)) return false;
    if (filters.award === 'none' && movie.awards && movie.awards.length > 0) return false;
    if (filters.award && filters.award !== 'none' && !(movie.awards||[]).includes(filters.award)) return false;
    if (filters.hasReview && !movie.fileData) return false;
    if (filters.rating && movie.rating < parseFloat(filters.rating)) return false;
    if (decade) {
        const y = parseInt(movie.year);
        if (isNaN(y) || y < parseInt(decade) || y > parseInt(decade)+9) return false;
    }
    return true;
}

async function getFilteredMovies(offset, limit){
    let movies = await fetchAllMovies();
    const isWatchlistMode = document.getElementById('viewMode').value === 'watchlist';
    const searchTerm = currentFilters.search.toLowerCase();
    const decade = currentFilters.decade;

    movies = movies.filter(m => {
        if(!!m.isWatchlist !== isWatchlistMode) return false;
        if(searchTerm && !m.title.toLowerCase().includes(searchTerm) && !(m.awards||[]).some(a=>a.toLowerCase().includes(searchTerm))) return false;
        if(currentFilters.director && m.director && !m.director.toLowerCase().includes(currentFilters.director.toLowerCase())) return false;
        if(currentFilters.year && m.year !== currentFilters.year) return false;
        if(currentFilters.genre && !(m.genres||'').includes(currentFilters.genre)) return false;
        if(currentFilters.award === 'none' && m.awards && m.awards.length > 0) return false;
        if(currentFilters.award && currentFilters.award !== 'none' && !(m.awards||[]).includes(currentFilters.award)) return false;
        if(currentFilters.hasReview && !m.fileData) return false;
        if(currentFilters.rating && m.rating < parseFloat(currentFilters.rating)) return false;
        if(decade){ const y = parseInt(m.year); if(isNaN(y) || y < parseInt(decade) || y > parseInt(decade)+9) return false; }
        return true;
    });

    const sort = currentFilters.sort;
    if (isWatchlistMode && sort === 'newest_added') {
        // Nella watchlist usa l'ordine manuale (drag & drop)
        movies.sort((a,b) => (a.order || 0) - (b.order || 0));
    } else if(sort === 'highest_rated') movies.sort((a,b)=>(b.rating||0) - (a.rating||0));
    else if(sort === 'lowest_rated') movies.sort((a,b)=>(a.rating||0) - (b.rating||0));
    else if(sort === 'year_new') movies.sort((a,b)=>parseInt(b.year)-parseInt(a.year));
    else if(sort === 'year_old') movies.sort((a,b)=>parseInt(a.year)-parseInt(b.year));
    else movies.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    hasMore = offset + limit < movies.length;
    return movies.slice(offset, offset + limit);
}

function resetInfiniteScroll() {
    currentOffset = 0;
    hasMore = true;
    explorePage = 1;
    exploreHasMore = true;
    document.getElementById('gallery').innerHTML = '';
    loadMoreMovies();
}


async function fetchExploreMovies(page = 1) {
    try {
        const [data, userMovies] = await Promise.all([
            discoverMovies(exploreFilters, page),
            fetchAllMovies()
        ]);

        // Se TMDB non restituisce risultati, fermati in sicurezza
        if (!data || !data.results) {
            exploreHasMore = false;
            return [];
        }

        // Set di titoli sicuro (evita crash se un titolo è mancante)
        const userTitles = new Set(userMovies.map(m => (m.title || '').toLowerCase().trim()));
        
        const movies = data.results
            .filter(m => m.title && !userTitles.has(m.title.toLowerCase().trim())) 
            .map(m => ({
                id: m.id,
                title: m.title,
                // Fallback nel caso in cui un film non abbia locandina
                poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster',
                year: m.release_date?.split('-')[0] || '',
                overview: m.overview,
                vote_average: m.vote_average,
                vote_count: m.vote_count,
                tmdbId: m.id
            }));
        
        exploreHasMore = page < data.total_pages;
        return movies;
    } catch (error) {
        console.error("Errore irreversibile in Explore:", error);
        exploreHasMore = false;
        return [];
    }
}


async function showExploreMovieDetails(tmdbId) {
    const movie = await getMovieDetails(tmdbId, 'credits');
    const modal = document.getElementById('exploreMovieModal');
    const content = document.getElementById('exploreMovieContent');
    
    const genres = movie.genres?.map(g => g.name).join(', ') || 'N/A';
    const director = movie.credits?.crew?.find(p => p.job === 'Director')?.name || 'N/A';
    const runtime = movie.runtime ? `${movie.runtime} min` : 'N/A';
    const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '';
    const releaseYear = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
    const originalLanguage = movie.original_language ? movie.original_language.toUpperCase() : 'N/A';
    
    content.innerHTML = `
    <h2>${escapeHtml(movie.title)} (${escapeHtml(releaseYear)})</h2>
    ${poster ? `<img src="${escapeAttr(poster)}" alt="" class="explore-movie-poster">` : ''}
    <p><strong>Release Year:</strong> ${escapeHtml(releaseYear)}</p>
    <p><strong>Original Language:</strong> ${escapeHtml(originalLanguage)}</p>
    <p><strong>Average Rating:</strong> ⭐ ${escapeHtml(movie.vote_average?.toFixed(1))} (${escapeHtml(movie.vote_count)} votes)</p>
    <p><strong>Director:</strong> ${escapeHtml(director)}</p>
    <p><strong>Genres:</strong> ${escapeHtml(genres)}</p>
    <p><strong>Runtime:</strong> ${escapeHtml(runtime)}</p>
    <p><strong>Overview:</strong> ${escapeHtml(movie.overview || 'No overview available.')}</p>
    <button class="btn-primary" id="addFromExploreBtn">➕ Add to Your List</button>
    <!-- 👇 AGGIUNGI QUESTO PULSANTE -->
    <button class="btn-primary" id="openFullDetailsBtn" style="background:#1e293b; margin-top:8px;">📊 Full Details</button>
`;
    
    document.getElementById('addFromExploreBtn').addEventListener('click', async () => {
        await fetchMovieDetailsAndSelect(tmdbId);
        closeModal('exploreMovieModal', true);
        openModal('modal');
    });

    document.getElementById('openFullDetailsBtn').addEventListener('click', () => {
        showFullMovieDetails(tmdbId, movie.imdb_id);
    });
    
    openModal('exploreMovieModal');
}

// Chiusura modale
document.querySelector('.close-explore-movie')?.addEventListener('click', () => {
    closeModal('exploreMovieModal');
});
// Clic fuori dalla modale
window.addEventListener('click', (event) => {
    const modalExplore = document.getElementById('exploreMovieModal');
    if (event.target === modalExplore) {
        closeModal('exploreMovieModal');
    }
});


async function loadExploreGenres() {
    try {
        const data = await getGenreList();
        const select = document.getElementById('exploreGenre');
        select.innerHTML = '<option value="">All Genres</option>';
        data.genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.warn('Impossibile caricare i generi da TMDB:', err);
        // Opzionalmente: lascia la select vuota o nascondi il filtro
    }
}
document.getElementById('applyExploreFilters')?.addEventListener('click', () => {
    exploreFilters.genre = document.getElementById('exploreGenre').value;
    exploreFilters.year = document.getElementById('exploreYear').value;
    exploreFilters.sort = document.getElementById('exploreSort').value;
    exploreFilters.minVotes = document.getElementById('exploreMinVotes').value;
    resetInfiniteScroll();   // riavvia la galleria in modalità Explore
});

document.getElementById('resetExploreFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('exploreGenre').value = '';
    document.getElementById('exploreYear').value = '';
    document.getElementById('exploreSort').value = 'popularity.desc';
    document.getElementById('exploreMinVotes').value = 100;
    exploreFilters = { genre: '', year: '', sort: 'popularity.desc', minVotes: 1000 };
    resetInfiniteScroll();
});


function createCardElement(movie, isWatchlistMode) {
    const card = document.createElement('div');
    card.className = 'movie-card' + (isWatchlistMode ? ' sortable-card' : '');
    card.setAttribute('data-id', movie.id);
    card.innerHTML = `
        <div class="poster-container">
            <img src="${escapeAttr(movie.poster)}" alt="" loading="lazy">
        </div>
        <div class="card-info">
            <h3>${escapeHtml(movie.title)}</h3>
            <div class="card-awards-mini">${(movie.awards||[]).map(a => `<span class="award-badge" title="${escapeAttr(a)}">${escapeHtml(a.split(' ')[0])}</span>`).join('')}</div>
            <div class="quick-tools">
                <span style="color:var(--accent);">★ ${escapeHtml(movie.rating||'-')}</span>
                <button class="btn-quick vote-btn">VOTE</button>
            </div>
        </div>
    `;

    // Desktop – il click normale funziona sempre
    card.addEventListener('click', () => window.openReview(movie.id, movie));

    // Variabili per il riconoscimento del tap su mobile
    let touchStartTime = 0;
    let touchStartX = 0, touchStartY = 0;
    let touchMoved = false;

    card.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartTime = Date.now();
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchMoved = false;
    }, { passive: true });

    card.addEventListener('touchmove', () => {
        touchMoved = true; // ha spostato il dito → è uno scroll, non un tap
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
        const elapsed = Date.now() - touchStartTime;
        const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);

        // Se si è mosso più di 10px o il tocco è durato troppo a lungo, non è un tap → esci
        if (touchMoved || dx > 10 || dy > 10 || elapsed > 500) return;

        // Se il tocco è avvenuto sul pulsante VOTE, lascia che il click lo gestisca
        if (typeof e.target?.closest === 'function' && e.target.closest('.vote-btn')) return;

        // Altrimenti è un tap volontario: impedisci il click successivo e apri la recensione
        e.preventDefault();
        window.openReview(movie.id, movie);
    });

    // Pulsante VOTE – logica invariata
    const voteBtn = card.querySelector('.vote-btn');
    voteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rating = await askRating(movie.title, movie.rating);
        if (rating !== null && !isNaN(rating)) {
            if (movie.isWatchlist) {
                const watchDate = new Date().toISOString().split('T')[0];
                await updateDoc(doc(db, "users", currentUser.uid, "movies", movie.id), {
                    rating,
                    isWatchlist: false,
                    watchDate
                });
                updateMovieInCache(movie.id, { rating, isWatchlist: false, watchDate });
                if (isWatchlistMode) {
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.8)';
                    setTimeout(() => card.remove(), 300);
                } else {
                    const ratingSpan = card.querySelector('.quick-tools span');
                    if (ratingSpan) ratingSpan.textContent = `★ ${rating}`;
                }
            } else {
                await updateDoc(doc(db, "users", currentUser.uid, "movies", movie.id), { rating });
                updateMovieInCache(movie.id, { rating });
                const ratingSpan = card.querySelector('.quick-tools span');
                if (ratingSpan) ratingSpan.textContent = `★ ${rating}`;
            }
            const movies = await fetchAllMovies();
            updateSpotlightAndCounters(movies);
            showToast('Rating updated!');
        }
    });

    return card;
}


async function loadMoreMovies() {
    if (isLoading || !hasMore) return;

    const viewModeVal = document.getElementById('viewMode').value;

    // 1. Show the loaders immediately!
    showSkeletonLoaders(BATCH_SIZE);
    
    isLoading = true;

    // --- EXPLORE MODE (TMDB) ---
    if (viewModeVal === 'explore') {
        if (!exploreHasMore) {
            removeSkeletonLoaders();
            isLoading = false;
            return;
        }
        
        const newMovies = await fetchExploreMovies(explorePage);
        const gallery = document.getElementById('gallery');

        // 2. Remove the skeleton loaders
        removeSkeletonLoaders();

        // 3. EMPTY STATE CHECK: If no movies are found and the gallery is empty
        if (newMovies.length === 0 && gallery.innerHTML === '') {
            gallery.innerHTML = `
                <div class="empty-state">
                    <span>🍿</span>
                    <h2>No movies found</h2>
                    <p>Try adjusting your search or clearing your filters.</p>
                </div>
            `;
            isLoading = false;
            return;
        }

        if (gallery.sortableInstance) {
            gallery.sortableInstance.destroy();
            gallery.sortableInstance = null;
        }

        newMovies.forEach(m => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            card.innerHTML = `
                <div class="poster-container">
                    <img src="${escapeAttr(m.poster)}" alt="" loading="lazy">
                </div>
                <div class="card-info">
                    <h3>${escapeHtml(m.title)}</h3>
                    <p style="color:var(--accent); margin:0.5rem 0;">
                        ⭐ ${escapeHtml(m.vote_average?.toFixed(1) || 'N/A')}
                        <small style="color:var(--text-muted);">(${escapeHtml(m.vote_count || 0)} votes)</small>
                    </p>
                </div>
            `;

            let touchStartX = 0, touchStartY = 0, touchMoved = false, touchStartTime = 0;

            card.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchMoved = false;
                touchStartTime = Date.now();
            }, { passive: true });

            card.addEventListener('touchmove', () => {
                touchMoved = true;
            }, { passive: true });

            card.addEventListener('touchend', (e) => {
                const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
                const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
                const elapsed = Date.now() - touchStartTime;

                if (touchMoved || dx > 10 || dy > 10 || elapsed > 500) return;

                e.preventDefault();
                showFullMovieDetails(m.id);
            });

            card.addEventListener('click', () => showFullMovieDetails(m.id));

            gallery.appendChild(card);
        });

        explorePage++;
        isLoading = false;
        hasMore = exploreHasMore;

        if (pendingScrollY !== null) {
            window.scrollTo(0, pendingScrollY);
            pendingScrollY = null;
        }
        return;
    }

    // --- ARCHIVE / WATCHLIST MODE ---
    const newMovies = await getFilteredMovies(currentOffset, BATCH_SIZE);
    const gallery = document.getElementById('gallery');
    const isWatchlistMode = viewModeVal === 'watchlist';

    // 2. Remove the skeleton loaders
    removeSkeletonLoaders();

    // 3. EMPTY STATE CHECK: If no movies match the filters
    if (newMovies.length === 0 && gallery.innerHTML === '') {
        gallery.innerHTML = `
            <div class="empty-state">
                <span>🍿</span>
                <h2>No movies found</h2>
                <p>Try adjusting your search or clearing your filters.</p>
            </div>
        `;
        isLoading = false;
        return;
    }

    if (gallery.sortableInstance) {
        gallery.sortableInstance.destroy();
        gallery.sortableInstance = null;
    }

    newMovies.forEach(m => {
        const card = createCardElement(m, isWatchlistMode);
        gallery.appendChild(card);
    });

    if (isWatchlistMode && typeof Sortable !== 'undefined') {
        gallery.sortableInstance = new Sortable(gallery, {
            animation: 250,
            ghostClass: 'sortable-ghost',
            onEnd: async function(evt) {
                const cards = [...gallery.querySelectorAll('.movie-card[data-id]')];
                for (let i = 0; i < cards.length; i++) {
                    const id = cards[i].getAttribute('data-id');
                    await updateDoc(doc(db, "users", currentUser.uid, "movies", id), { order: i });
                    updateMovieInCache(id, { order: i });
                }
                showToast('Order saved');
            }
        });
    }

    currentOffset += BATCH_SIZE;
    if (pendingScrollY !== null) {
        window.scrollTo(0, pendingScrollY);
        pendingScrollY = null;
    }
    isLoading = false;
}


// --- REVIEW, EDIT, DELETE ---
async function openReview(id, movieData = null) {
    currentMovieId = id;

    // Se i dati del film sono stati passati (dalla card), usali subito – nessun fetch necessario
    let m = movieData;
    if (!m) {
        const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", id));
        m = snap.data();
    }

    // Popola i campi immediatamente
    document.getElementById('viewTitle').innerText = m.title;
    document.getElementById('viewRating').innerText = m.isWatchlist ? "Watchlist" : `★ ${m.rating}/10`;
    document.getElementById('viewMetadata').textContent = `${m.director} | ${m.year} | ${m.runtime} | ${m.genres}`;
    document.getElementById('viewPlot').innerText = m.plot;
    document.getElementById('dynamicBackdrop').style.backgroundImage = `url('${encodeURI(m.backdrop || '')}')`;
    document.getElementById('viewAwards').innerHTML = (m.awards || []).map(a => `<span>${escapeHtml(a)}</span>`).join('');

    const cont = document.getElementById('reviewContainer');
    if (m.fileData) {
        if (m.fileType === 'application/pdf') cont.innerHTML = `<embed src="${m.fileData}" type="application/pdf" width="100%" height="500px">`;
        else cont.innerHTML = `<iframe src="${m.fileData}" width="100%" height="500px"></iframe>`;
    } else cont.innerHTML = '<p>No written review.</p>';

    // Pulisce i rating esterni precedenti
    const omdbContainer = document.getElementById('omdbRatings');
    if (omdbContainer) omdbContainer.innerHTML = '';

    // Apre la modale SUBITO (tutto è già stato riempito)
    openModal('reviewModal');
    requestAnimationFrame(() => reviewModal.classList.add('active'));

    // Operazioni in background, senza bloccare l'interfaccia
    showSimilarMovies(id);

    // Recupera i rating OMDb in silenzio
    if (omdbContainer) {
        try {
            const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(m.title)}&y=${m.year}&apikey=3bab6459`);
            const omdbData = await omdbRes.json();
            if (omdbData.Response === 'True') {
                const ratings = omdbData.Ratings || [];
                const imdb = ratings.find(r => r.Source === 'Internet Movie Database');
                const rt = ratings.find(r => r.Source === 'Rotten Tomatoes');
                const meta = ratings.find(r => r.Source === 'Metacritic');
                let html = '<div style="margin-top: 10px; font-size: 0.9rem; color: var(--text-muted);">';
                if (imdb) html += `🎬 IMDb: ${escapeHtml(imdb.Value)} `;
                if (rt) html += `🍅 Rotten Tomatoes: ${escapeHtml(rt.Value)} `;
                if (meta) html += `📊 Metacritic: ${escapeHtml(meta.Value)}`;
                html += '</div>';
                omdbContainer.innerHTML = html;
            }
        } catch (e) {
            console.warn('OMDb unreachable');
        }
    }

        // Rimuovi eventuali pulsanti "Full Details" già esistenti (per evitare accumulo)
    document.querySelectorAll('.full-details-btn').forEach(b => b.remove());

    // Pulsante "Full Details" – aggiunto dopo la review
    const fullDetailsBtn = document.createElement('button');
    fullDetailsBtn.className = 'btn-primary full-details-btn';
    fullDetailsBtn.style.background = '#1e293b';
    fullDetailsBtn.style.marginTop = '10px';
    fullDetailsBtn.innerText = '📊 Full Details';
    fullDetailsBtn.addEventListener('click', async () => {
        const movieResult = await getFirstMovieByTitleYear(m.title, m.year);
        if (movieResult) {
            showFullMovieDetails(movieResult.id);
        } else {
            alert('Movie not found on TMDB.');
        }
    });
    document.getElementById('reviewContainer').insertAdjacentElement('afterend', fullDetailsBtn);
}

// Review modal logic moved to ui.js

document.getElementById('editBtn').addEventListener('click', async (event) => {
    event.preventDefault();
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    const m = snap.data();
    closeModal('reviewModal', true);
    openModal('modal');
    document.getElementById('tmdbTitle').value=m.title;
    document.getElementById('tmdbPlot').value=m.plot;
    document.getElementById('tmdbPoster').value=m.poster;
    document.getElementById('rating').value=m.rating||'';
    document.getElementById('watchDate').value=m.watchDate||'';
    document.getElementById('isWatchlist').checked=!!m.isWatchlist;
    document.querySelectorAll('.seba-award').forEach(cb=>cb.checked=(m.awards||[]).includes(cb.value));
    if (window.syncAwardChips) syncAwardChips();
    document.getElementById('previewTitle').innerText=m.title;
    document.getElementById('previewPoster').src=m.poster;
    document.getElementById('moviePreview').style.display='flex';
    currentSelectedMovieExtras = {
        year: m.year || 'N/A',
        director: m.director || 'Unknown',
        genres: m.genres || '',
        backdrop: m.backdrop || '',
        runtime: m.runtime || 'N/A',
        cast: Array.isArray(m.cast) ? m.cast : [],
        tmdbId: m.tmdbId || null,
        production_countries: Array.isArray(m.production_countries) ? m.production_countries : []
    };
});

document.getElementById('deleteBtn').addEventListener('click', async (event) => {
    event.preventDefault();
    const ok = await askConfirm({
        title: 'Eliminare il film?',
        message: 'Verrà rimosso definitivamente dalla tua collezione. L\'azione non può essere annullata.',
        confirmText: 'Elimina',
        cancelText: 'Annulla',
        danger: true,
        icon: '🗑️'
    });
    if (!ok) return;
    await deleteDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    removeMovieFromCache(currentMovieId);
    closeModal('reviewModal');
    renderGallery();
});

// --- SIMILAR MOVIES & RECOMMENDATIONS ---
// Discovery-focused: pulls suggestions from TMDB, hides anything the user
// already has in their watched collection, and flags items still in the
// watchlist with a small badge. All filtering happens against the in-memory
// cache — no extra Firestore reads.
async function showSimilarMovies(id){
    const grid = document.getElementById('similarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const movies = await fetchAllMovies();
    const current = movies.find(m => m.id === id);
    if (!current) return;

    // Legacy movies in the archive may lack tmdbId — resolve it by title/year.
    let tmdbId = current.tmdbId;
    if (!tmdbId) {
        try {
            const lookup = await getFirstMovieByTitleYear(current.title, current.year);
            tmdbId = lookup?.id || null;
        } catch (err) {
            console.warn('TMDB lookup for similar failed:', err);
        }
        if (!tmdbId) {
            console.info('[similar] no tmdbId for', current.title);
            return;
        }
    }

    let results = [];
    try {
        const data = await getSimilarMovies(tmdbId);
        results = Array.isArray(data?.results) ? data.results : [];
    } catch (err) {
        console.warn('Similar movies fetch failed:', err);
        return;
    }

    const watchedIds = new Set();
    const watchlistIds = new Set();
    for (const m of movies) {
        if (!m.tmdbId) continue;
        const key = String(m.tmdbId);
        if (m.isWatchlist) watchlistIds.add(key);
        else watchedIds.add(key);
    }

    // Soglia di notorietà: scarta i titoli con pochi voti su TMDB per evitare
    // suggerimenti di film praticamente sconosciuti.
    const MIN_VOTE_COUNT = 1000;

    const discovery = [];
    for (const r of results) {
        if (!r?.id) continue;
        if ((r.vote_count || 0) < MIN_VOTE_COUNT) continue;
        const key = String(r.id);
        if (watchedIds.has(key)) continue;
        discovery.push({ tmdb: r, inWatchlist: watchlistIds.has(key) });
        if (discovery.length >= 4) break;
    }

    discovery.forEach(({ tmdb, inWatchlist }) => {
        grid.appendChild(createDiscoveryCard(tmdb, inWatchlist));
    });
}

function createDiscoveryCard(tmdb, inWatchlist) {
    const div = document.createElement('div');
    div.className = 'movie-card discovery-card';
    div.onclick = () => showFullMovieDetails(tmdb.id);
    const poster = tmdb.poster_path
        ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`
        : 'https://via.placeholder.com/500x750?text=No+Poster';
    const badge = inWatchlist
        ? `<span class="watchlist-badge" title="In Watchlist" aria-label="In Watchlist">🔖</span>`
        : '';
    div.innerHTML = `<div class="poster-container">${badge}<img src="${escapeAttr(poster)}" alt=""></div><div class="card-info"><h3>${escapeHtml(tmdb.title || '')}</h3></div>`;
    return div;
}



// Stats moved to stats.js

// --- SPOTLIGHT ---
function startDynamicSpotlight() {
    if (spotlightInterval) clearInterval(spotlightInterval);
    spotlightInterval = setInterval(async () => {
        const movies = await fetchAllMovies();
        updateSpotlightAndCounters(movies);
    }, 20000);
}


// --- LISTENERS & IMPORT ---
document.getElementById('viewMode').onchange = () => {
    const gallery = document.getElementById('gallery');
    if (gallery && gallery.sortableInstance) {
        gallery.sortableInstance.destroy();
        gallery.sortableInstance = null;
    }
    const mode = document.getElementById('viewMode').value;
    syncFilterUI(mode);

    // Crossfade transition: fade out current content, swap, fade back in.
    const appRoot = document.getElementById('app');
    const FADE_MS = 200;
    appRoot?.classList.add('view-fading-out');
    setTimeout(() => {
        if (mode === 'explore') {
            resetInfiniteScroll();
        } else {
            renderGallery();
        }
        startDynamicSpotlight();
        requestAnimationFrame(() => appRoot?.classList.remove('view-fading-out'));
    }, FADE_MS);
};

document.getElementById('repairMetadataBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const movies = await fetchAllMovies();
    const toRepair = movies.filter(m => !m.director || m.director === 'Unknown' || !m.genres || m.runtime === 'N/A' || !m.cast || m.cast.length === 0);
    if (toRepair.length === 0) {
        alert("All movies already have complete metadata.");
        return;
    }
    if (!confirm(`Found ${toRepair.length} movies with missing data. Update now?`)) return;
    
    const progressDiv = document.getElementById('importProgress');
    const statusEl = document.getElementById('importStatus');
    const barEl = document.getElementById('importProgressBar');
    progressDiv.style.display = 'block';
    barEl.style.width = '0%';
    let completed = 0;
    const total = toRepair.length;

    for (const movie of toRepair) {
        statusEl.innerText = `Repairing: ${movie.title} (${completed + 1} of ${total})`;
        barEl.style.width = `${(completed / total) * 100}%`;
        try {
            const sData = await searchMoviesWithYear(movie.title, movie.year);
            if (sData.results?.length) {
                const tmdb = sData.results[0];
                const [detRes, credRes] = await Promise.all([
                    getMovieDetails(tmdb.id),
                    getMovieCredits(tmdb.id)
                ]);
                const director = credRes.crew?.find(p => p.job === 'Director')?.name || 'Unknown';
                const genres = detRes.genres?.map(g => g.name).join(', ') || '';
                const runtime = detRes.runtime ? `${detRes.runtime} min` : 'N/A';
                const year = detRes.release_date?.split('-')[0] || movie.year;
                const cast = credRes.cast?.slice(0, 10).map(a => a.name) || [];

                await updateDoc(doc(db, "users", currentUser.uid, "movies", movie.id), {
                    director,
                    genres,
                    runtime,
                    year,
                    cast   // 👈 aggiunto il cast
                });
                updateMovieInCache(movie.id, { director, genres, runtime, year, cast });
            }
        } catch (err) {
            console.error(`Error repairing ${movie.title}:`, err);
        }
        completed++;
        await new Promise(r => setTimeout(r, 250));
    }
    barEl.style.width = '100%';
    statusEl.innerText = `Repair completed: ${total} movies updated.`;
    setTimeout(() => {
        progressDiv.style.display = 'none';
        barEl.style.width = '0%';
    }, 2500);
    showToast('Metadata repaired!');
    renderGallery();
});

document.getElementById('sortOrder').onchange = (e) => { currentFilters.sort = e.target.value; renderGallery(); };
document.getElementById('mainSearch').oninput = (e) => { const viewMode = document.getElementById('viewMode').value; if (viewMode === 'explore') { exploreFilters.query = e.target.value; resetInfiniteScroll(); } else { currentFilters.search = e.target.value; renderGallery(); } };
document.getElementById('filterYear').onchange = (e) => { currentFilters.year = e.target.value; renderGallery(); };
document.getElementById('filterGenre').onchange = (e) => { currentFilters.genre = e.target.value; renderGallery(); };
document.getElementById('filterRating').onchange = (e) => { currentFilters.rating = e.target.value; renderGallery(); };
document.getElementById('filterAward').onchange = (e) => { currentFilters.award = e.target.value; renderGallery(); };
document.getElementById('filterHasReview').onchange = (e) => { currentFilters.hasReview = e.target.checked; renderGallery(); };
document.getElementById('filterDirector').oninput = (e) => { currentFilters.director = e.target.value; renderGallery(); };
document.getElementById('applyExploreFilters')?.addEventListener('click', () => {
    exploreFilters.genre = document.getElementById('exploreGenre').value;
    exploreFilters.year = document.getElementById('exploreYear').value;
    exploreFilters.sort = document.getElementById('exploreSort').value;
    exploreFilters.minVotes = document.getElementById('exploreMinVotes').value;
    resetInfiniteScroll();   // riavvia la galleria Explore con i nuovi filtri
});

document.getElementById('resetExploreFiltersBtn')?.addEventListener('click', () => {
    // Ripristina i valori dei campi
    document.getElementById('exploreGenre').value = '';
    document.getElementById('exploreYear').value = '';
    document.getElementById('exploreSort').value = 'popularity.desc';
    document.getElementById('exploreMinVotes').value = 1000;   // o 0 se preferisci toglierlo
    // Aggiorna l'oggetto globale
    exploreFilters = { genre: '', year: '', sort: 'popularity.desc', minVotes: 1000 };
    // Ricarica la galleria
    resetInfiniteScroll();
});

document.getElementById('resetFiltersBtn').onclick = () => {
    currentFilters = { search: '', director: '', year: '', genre: '', award: '', rating: '', hasReview: false, sort: 'newest_added', decade: '' };
    document.getElementById('mainSearch').value = '';
    document.getElementById('filterDirector').value = '';
    document.getElementById('filterYear').value = '';
    document.getElementById('filterGenre').value = '';
    document.getElementById('filterAward').value = '';
    document.getElementById('filterRating').value = '';
    document.getElementById('filterHasReview').checked = false;
    document.getElementById('sortOrder').value = 'newest_added';
    document.querySelectorAll('.decade-btn').forEach(b => b.classList.remove('active'));
    renderGallery();
};



document.getElementById('resetVaultBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;
    if (!confirm("Are you sure you want to delete ALL your movies? This cannot be undone.")) return;
    const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
    const deletions = [];
    snap.forEach(docSnap => deletions.push(deleteDoc(doc(db, "users", currentUser.uid, "movies", docSnap.id))));
    await Promise.all(deletions);
    invalidateMoviesCache();
    showToast('Archive cleared!');
    closeModal('statsModal');
    renderGallery();
});

document.querySelectorAll('.decade-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.decade-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        currentFilters.decade = btn.dataset.decade;
        renderGallery();
    };
});

// --- GESTIONE MODALI ---
// Modal event listeners moved to ui.js

// --- IMPORT CSV (completo, recupera regista, generi, runtime) ---
const importCsvBtn = document.getElementById('importCsvBtn2'); // NEW ID
if (importCsvBtn) importCsvBtn.onclick = () => document.getElementById('csvFileInput2').click();

const csvFileInput = document.getElementById('csvFileInput2'); // NEW ID
if (csvFileInput) csvFileInput.onchange = async (e) => {
    const file = e.target.files[0];
    await ensurePapaParse();
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const rows = results.data.filter(row => row.Name);
            if (rows.length === 0) {
                alert("No valid rows in CSV.");
                return;
            }
            const progressDiv = document.getElementById('importProgress');
            const statusEl = document.getElementById('importStatus');
            const barEl = document.getElementById('importProgressBar');
            progressDiv.style.display = 'block';
            barEl.style.width = '0%';
            let completed = 0;
            const total = rows.length;

            for (const row of rows) {
                statusEl.innerText = `Importing: ${row.Name} (${completed + 1} of ${total})`;
                barEl.style.width = `${(completed / total) * 100}%`;
                try {
                    // Prima cerca il film
                    const sData = await searchMoviesWithYear(row.Name, row.Year);
                    if (sData.results?.length) {
                        const tmdb = sData.results[0];
                        // Ottieni dettagli completi e crediti
                        const [detRes, credRes] = await Promise.all([
                            getMovieDetails(tmdb.id),
                            getMovieCredits(tmdb.id)
                        ]);
                        const director = credRes.crew?.find(p => p.job === 'Director')?.name || 'Unknown';
                        const genres = detRes.genres?.map(g => g.name).join(', ') || '';
                        const runtime = detRes.runtime ? `${detRes.runtime} min` : 'N/A';
                        const year = detRes.release_date?.split('-')[0] || tmdb.release_date?.split('-')[0] || row.Year;

                        await addDoc(collection(db, "users", currentUser.uid, "movies"), {
                            title: tmdb.title,
                            poster: `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`,
                            backdrop: detRes.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detRes.backdrop_path}` : '',
                            plot: tmdb.overview,
                            rating: row.Rating ? parseFloat(row.Rating) * 2 : null,
                            watchDate: row['Watched Date'] || null,
                            isWatchlist: !row.Rating,
                            director,
                            genres,
                            runtime,
                            year,
                            awards: [],
                            createdAt: serverTimestamp(),
                            order: Date.now() + completed // per ordinamento
                        });
                    }
                } catch (err) {
                    console.error(`Error importing ${row.Name}:`, err);
                }
                completed++;
                await new Promise(r => setTimeout(r, 250));
            }
            barEl.style.width = '100%';
            statusEl.innerText = `Import completed: ${total} movies processed.`;
            setTimeout(() => {
                progressDiv.style.display = 'none';
                barEl.style.width = '0%';
            }, 2500);
            invalidateMoviesCache();
            showToast('Import complete!');
            renderGallery();
        }
    });
};

// Esponi funzioni globali per onclick inline
window.quickEdit = async (id) => { /* non più usato ma mantenuto */ };
window.moveToArchive = async (id) => { /* non più usato */ };
window.openReview = openReview;

const observer = new IntersectionObserver(entries => { if(entries[0].isIntersecting) loadMoreMovies(); }, { threshold:0.1 });
observer.observe(document.getElementById('sentinel'));


// --- TOGGLE WATCHLIST & AWARDS CHIPS ---
function initModernForm() {
  const watchlistCheck = document.getElementById('isWatchlist');
  const reviewSection = document.getElementById('reviewSection');

  // Nascondi/mostra sezione recensione in base al toggle
  function toggleReviewFields() {
    reviewSection.style.display = watchlistCheck.checked ? 'none' : 'block';
  }
  watchlistCheck.addEventListener('change', toggleReviewFields);
  toggleReviewFields(); // iniziale

  // Chip awards
  const chips = document.querySelectorAll('.award-chip');
  chips.forEach(chip => {
    const checkbox = chip.querySelector('.seba-award');
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      checkbox.checked = !checkbox.checked;
      chip.classList.toggle('active', checkbox.checked);
    });
    // sincronizza stato iniziale
    chip.classList.toggle('active', checkbox.checked);
  });
}

// Chiamala dopo che il DOM è pronto (es. in fondo al file o dopo initTheme)
initModernForm();

// Esponi syncAwardChips globalmente per l'edit
window.syncAwardChips = function() {
  document.querySelectorAll('.award-chip').forEach(chip => {
    const checkbox = chip.querySelector('.seba-award');
    chip.classList.toggle('active', checkbox.checked);
  });
};




async function showFullMovieDetails(tmdbId, imdbId = null) {
    const modal = document.getElementById('movieDetailsModal');
    const content = document.getElementById('movieDetailsContent');
    content.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Loading full details…</p>';
    openModal('movieDetailsModal');

    try {
        const movie = await getMovieDetails(tmdbId, 'credits,external_ids,release_dates');

        const genres = movie.genres?.map(g => g.name).join(', ') || 'N/A';
        const director = movie.credits?.crew?.find(p => p.job === 'Director')?.name || 'N/A';
        const runtime = movie.runtime ? `${movie.runtime} min` : 'N/A';
        const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '';
        const releaseYear = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
        const language = movie.original_language?.toUpperCase() || 'N/A';
        const countries = movie.production_countries?.map(c => c.name).join(', ') || 'N/A';
        const budget = movie.budget > 0 ? `$${(movie.budget / 1_000_000).toFixed(0)}M` : 'N/A';
        const revenue = movie.revenue > 0 ? `$${(movie.revenue / 1_000_000).toFixed(0)}M` : 'N/A';
        const cast = movie.credits?.cast?.slice(0, 10).map(a => a.name).join(', ') || 'N/A';
        const imdbActual = movie.imdb_id || imdbId;
        const tmdbLink = `https://www.themoviedb.org/movie/${tmdbId}`;
        const imdbLink = imdbActual ? `https://www.imdb.com/title/${imdbActual}` : '#';

        content.innerHTML = `
            <h2 style="font-family:'Cinzel',serif; margin:0;">${escapeHtml(movie.title)} (${escapeHtml(releaseYear)})</h2>

            <button class="btn-primary" id="addFromFullDetailsBtn" style="width:100%; padding:1rem; font-size:1.1rem; margin:15px 0;">
                ➕ Add to Your List
            </button>

            ${poster ? `<img src="${escapeAttr(poster)}" alt="" style="width:150px; align-self:center; border-radius:12px; margin:10px 0;">` : ''}

            ${movie.overview ? `
            <div class="detail-section">
                <h4>📖 Plot</h4>
                <p style="line-height:1.55;">${escapeHtml(movie.overview)}</p>
            </div>
            ` : ''}

            <div class="detail-section">
                <h4>🎬 Core Info</h4>
                <p><strong>Director:</strong> ${escapeHtml(director)}</p>
                <p><strong>Genres:</strong> ${escapeHtml(genres)}</p>
                <p><strong>Runtime:</strong> ${escapeHtml(runtime)}</p>
                <p><strong>Language:</strong> ${escapeHtml(language)}</p>
                <p><strong>Countries:</strong> ${escapeHtml(countries)}</p>
                <p><strong>Budget:</strong> ${escapeHtml(budget)} | <strong>Revenue:</strong> ${escapeHtml(revenue)}</p>
            </div>

            <div class="detail-section">
                <h4>🌟 Cast</h4>
                <p>${escapeHtml(cast)}</p>
            </div>

            <div class="detail-section">
                <h4>📊 Ratings</h4>
                <p><strong>TMDB Average:</strong> ⭐ ${escapeHtml(movie.vote_average?.toFixed(1))} (${escapeHtml(movie.vote_count)} votes)</p>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
                <!-- NUOVO PULSANTE FILMGRAB -->
                <button class="btn-primary" id="openFilmGrabBtn" style="background:#1e293b; margin-top:10px;">📸 Stills on FilmGrab</button>
                <a href="${escapeAttr(tmdbLink)}" target="_blank" rel="noopener noreferrer" class="external-link-btn">🌐 View on TMDB</a>
                ${imdbLink !== '#' ? `<a href="${escapeAttr(imdbLink)}" target="_blank" rel="noopener noreferrer" class="external-link-btn">🎬 View on IMDb</a>` : ''}
            </div>
        `;

        // Listener per il pulsante “Add to Your List”
        document.getElementById('addFromFullDetailsBtn').addEventListener('click', async () => {
            await fetchMovieDetailsAndSelect(tmdbId);
            closeModal('movieDetailsModal', true);
            openModal('modal');
        });

        // Listener per il pulsante FilmGrab
        document.getElementById('openFilmGrabBtn')?.addEventListener('click', () => {
            apriFilmGrab({ title: movie.title, tmdbId: tmdbId });
        });

    } catch (err) {
        content.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Failed to load details.</p>';
    }
}

// Chiusura modale
document.querySelector('.close-movie-details')?.addEventListener('click', () => {
    closeModal('movieDetailsModal');
});
// Clic fuori
window.addEventListener('click', (event) => {
    const modal = document.getElementById('movieDetailsModal');
    if (event.target === modal) closeModal('movieDetailsModal');
});




async function apriFilmGrab(film) {
    // Tenta di costruire l'URL diretto
    try {
        const dati = await getMovieDetails(film.tmdbId || film.id);
        const dataRilascio = dati.release_date;
        if (dataRilascio) {
            const [anno, mese, giorno] = dataRilascio.split('-');
            const titoloUrl = film.title
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .replace(/\s+/g, '-');
            const urlFilmGrab = `https://film-grab.com/${anno}/${mese}/${giorno}/${titoloUrl}/`;
            // Apriamo l'URL – se è 404, l'utente può comunque chiudere la scheda e tornerà al sito
            // Non c'è un modo semplice per verificare se la pagina esiste senza fare un fetch CORS, che non funziona.
            // Quindi meglio fare direttamente la ricerca Google.
        }
    } catch (e) { /* ignora */ }

    // Fallback: ricerca Google
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(film.title)}+site:film-grab.com`;
    window.open(searchUrl, '_blank');
}

// --- EXPORT/IMPORT JSON ---
// Export/Import logic moved to ui.js

// --- LOGICA INTELLIGENZA ARTIFICIALE GEMINI (Google AI) ---

async function getAIResponse(userQuery) {
    try {
        const movies = await fetchAllMovies(); // prende già tutti i film dell'utente loggato
        
        // Separiamo visti e watchlist
        const watched = movies.filter(m => !m.isWatchlist);
        const watchlist = movies.filter(m => m.isWatchlist);

        // Costruiamo una descrizione dettagliata per ogni film visto
        const watchedDetails = watched.map(m => {
            const rating = m.rating ? `${m.rating}/10` : 'no vote';
            const genres = m.genres || 'sconosciuto';
            const director = m.director || 'sconosciuto';
            const year = m.year || '????';
            const awards = (m.awards && m.awards.length > 0) ? ` [Premi: ${m.awards.join(', ')}]` : '';
            return `"${m.title}" (${year}) di ${director}. Genere: ${genres}. Voto: ${rating}.${awards}`;
        }).join('\n');

        const watchlistTitles = watchlist.map(m => m.title).join(', ') || 'nessuno';

        const prompt = `Sei l'assistente esperto di Sebas-Reviews, un'appassionato cinefilo. 
Analizza i suoi gusti in base ai film già visti e ai voti che ha dato, e aiutalo con consigli personalizzati.

📽️ **FILM VISTI (con valutazioni):**
${watchedDetails || 'Nessun film visto ancora.'}

📋 **WATCHLIST (da vedere):**
${watchlistTitles || 'Vuota.'}

Domanda dell'utente: "${userQuery}"

Rispondi in italiano, in modo simpatico e breve. Usa le informazioni sui generi, registi e voti per dare un consiglio mirato. Se la domanda non è chiara, chiedi maggiori dettagli.`;

        const analyzeReview = httpsCallable(functions, 'analyzeReview');
        const result = await analyzeReview({ reviewText: prompt, action: 'chat' });
        return result.data?.result || 'Scusa, ho avuto un problema tecnico. Riprova tra poco.';
    } catch (err) {
        console.error("Errore AI:", err);

        if (userQuery.trim().toLowerCase() === "what should you say?") {
            return "Sorry Sir";
        }
        
        return "Scusa, ho avuto un problema tecnico. Riprova tra poco.";
    }
}

// Gestione dell'interfaccia (Click e Invio)
const chatBtn = document.getElementById('toggle-chat');
const chatWindow = document.getElementById('chat-window');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatBtn.onclick = () => {
    if (chatWindow.hidden) {
        chatWindow.hidden = false;
        // Mostra il benvenuto solo se la chat è vuota
        if (chatMessages.children.length === 0) {
            const welcome = document.createElement('div');
            welcome.className = 'chat-bubble chat-bubble-ai';
            welcome.innerHTML = `<b>AI:</b> Ciao! Sono la tua AI di Sebas-Reviews. Chiedimi pure consigli sui film, suggerimenti su cos'altro guardare o curiosità sui generi e registi che hai salvato 🎬`;
            chatMessages.appendChild(welcome);
        }
    } else {
        chatWindow.hidden = true;
    }
};

function appendChatBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-ai';
    const label = document.createElement('b');
    label.textContent = role === 'user' ? 'Tu:' : 'AI:';
    bubble.appendChild(label);
    bubble.appendChild(document.createTextNode(' ' + text));
    chatMessages.appendChild(bubble);
}

chatInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== "") {
        const text = chatInput.value;
        chatInput.value = "";

        appendChatBubble('user', text);
        const aiText = await getAIResponse(text);
        appendChatBubble('ai', aiText);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});
