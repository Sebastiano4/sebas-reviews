// --- FIREBASE SETUP ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, doc, deleteDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC5rtNbMp2GY9myxCiausHBp1c9jUliXbk",
    authDomain: "sebas-reviews.firebaseapp.com",
    projectId: "sebas-reviews",
    storageBucket: "sebas-reviews.firebasestorage.app",
    messagingSenderId: "155619440463",
    appId: "1:155619440463:web:af3382d4ae1f3141edb73a",
    measurementId: "G-6B779X2HJV"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- GLOBALS ---
const TMDB_API_KEY = '0de9856190bca7ec5acd797969c1d952';
export let currentUser = null;
let currentMovieId = null, currentSelectedMovieExtras = {}, ratingChartInstance = null;
let isLoading = false, hasMore = true, currentOffset = 0, BATCH_SIZE = 20;
let currentFilters = { search: '', director: '', year: '', genre: '', award: '', rating: '', hasReview: false, sort: 'newest_added', decade: '' };
let spotlightInterval = null;
let timeoutId;

// DOM elements
const modal = document.getElementById('modal'), reviewModal = document.getElementById('reviewModal'), statsModal = document.getElementById('statsModal');
const tmdbSearch = document.getElementById('tmdbSearch'), searchResults = document.getElementById('searchResults');
const loginBtn = document.getElementById('login-btn'), logoutBtn = document.getElementById('logout-btn'), appContent = document.getElementById('app-content');

// --- TOAST NOTIFICATIONS ---
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// --- AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        appContent.style.display = 'block';
        renderGallery();
        startDynamicSpotlight();
    } else {
        currentUser = null;
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        appContent.style.display = 'none';
        if(spotlightInterval) clearInterval(spotlightInterval);
    }
});

if(loginBtn) loginBtn.addEventListener('click', () => signInWithPopup(auth, provider));
if(logoutBtn) logoutBtn.addEventListener('click', () => signOut(auth));

// --- UTILS ---
const getMedian = (arr) => { if (!arr.length) return 0; const sorted = [...arr].sort((a,b)=>a-b); const mid = Math.floor(sorted.length/2); return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; };
const getStdDev = (arr) => { if (!arr.length) return 0; const mean = arr.reduce((a,b)=>a+b)/arr.length; return Math.sqrt(arr.map(x=>Math.pow(x-mean,2)).reduce((a,b)=>a+b)/arr.length); };
const toBase64 = f => new Promise((res,rej)=>{ const r=new FileReader(); r.readAsDataURL(f); r.onload=()=>res(r.result); r.onerror=rej; });
const getRuntimeMinutes = (runtime) => {
    if (!runtime || runtime === 'N/A' || runtime === 'Unknown') return 105; 
    if (typeof runtime === 'number') return runtime;
    const match = String(runtime).match(/\d+/);
    return match ? parseInt(match[0], 10) : 105;
};

async function fetchAllMovies() {
    if (!currentUser) return [];
    const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// --- TMDB SEARCH ---
tmdbSearch.addEventListener('input', (e) => {
    clearTimeout(timeoutId);
    const q = e.target.value;
    if(q.length<3){ searchResults.innerHTML=''; return; }
    timeoutId = setTimeout(async()=>{
        const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=en-US`);
        const data = await res.json();
        searchResults.innerHTML = '';
        data.results.slice(0,5).forEach(movie=>{
            const div = document.createElement('div'); 
            div.className = 'dropdown-item'; 
            const posterHtml = movie.poster_path ? `<img src="https://image.tmdb.org/t/p/w92${movie.poster_path}" class="dropdown-poster">` : `<div class="dropdown-poster" style="background:#0c0e12;"></div>`;
            div.innerHTML = `${posterHtml} <span>${movie.title} (${movie.release_date?.split('-')[0]||'N/A'})</span>`;
            div.onclick = () => fetchMovieDetailsAndSelect(movie.id);
            searchResults.appendChild(div);
        });
    },500);
});

async function fetchMovieDetailsAndSelect(movieId){
    const [movie, credits] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=en-US`).then(r=>r.json()),
        fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`).then(r=>r.json())
    ]);
    const dir = credits.crew.find(p=>p.job==='Director')?.name||'Unknown';
    currentSelectedMovieExtras = {
        year: movie.release_date?.split('-')[0]||'N/A',
        director: dir,
        genres: movie.genres.map(g=>g.name).join(', '),
        backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : '',
        runtime: movie.runtime ? `${movie.runtime} min` : 'N/A'
    };
    document.getElementById('tmdbTitle').value = movie.title;
    document.getElementById('tmdbPlot').value = movie.overview;
    document.getElementById('tmdbPoster').value = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
    document.getElementById('previewTitle').innerText = movie.title;
    document.getElementById('previewPlot').innerText = movie.overview.substring(0,200)+'...';
    document.getElementById('previewPoster').src = document.getElementById('tmdbPoster').value;
    document.getElementById('moviePreview').style.display = 'flex';
    searchResults.innerHTML = '';
}

// --- SAVE & FORM LOGIC ---
function closeForm(){ 
    modal.style.display='none'; 
    document.getElementById('movieForm').reset(); 
    document.getElementById('moviePreview').style.display='none'; 
    currentMovieId=null; 
    currentSelectedMovieExtras = {}; 
}

document.getElementById('addBtn').onclick = () => { closeForm(); modal.style.display='block'; };

document.getElementById('movieForm').onsubmit = async(e)=>{
    e.preventDefault();
    if(!currentUser) return;
    const isWatchlist = document.getElementById('isWatchlist').checked;
    const movieData = {
        title: document.getElementById('tmdbTitle').value,
        plot: document.getElementById('tmdbPlot').value,
        poster: document.getElementById('tmdbPoster').value,
        rating: isWatchlist ? null : parseFloat(document.getElementById('rating').value),
        watchDate: isWatchlist ? null : document.getElementById('watchDate').value,
        isWatchlist,
        awards: isWatchlist ? [] : Array.from(document.querySelectorAll('.seba-award:checked')).map(cb=>cb.value),
        ...currentSelectedMovieExtras,
        updatedAt: serverTimestamp(),
        order: Date.now()   // campo per ordinamento drag & drop
    };
    const fileInput = document.getElementById('reviewFile').files[0];
    if(fileInput){ movieData.fileData = await toBase64(fileInput); movieData.fileType = fileInput.type; }

    try {
        if(currentMovieId){
            await updateDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId), movieData);
        } else {
            movieData.createdAt = serverTimestamp();
            await addDoc(collection(db, "users", currentUser.uid, "movies"), movieData);
        }
        closeForm(); renderGallery();
    } catch(err) { console.error(err); }
};

// --- GALLERY & FILTERS ---
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
    } else if(sort === 'highest_rated') movies.sort((a,b)=>b.rating - a.rating);
    else if(sort === 'year_new') movies.sort((a,b)=>parseInt(b.year)-parseInt(a.year));
    else if(sort === 'year_old') movies.sort((a,b)=>parseInt(a.year)-parseInt(b.year));
    else movies.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    hasMore = offset + limit < movies.length;
    return movies.slice(offset, offset + limit);
}

async function renderGallery(){ 
    const movies = await fetchAllMovies();
    populateFilters(movies);
    updateSpotlightAndCounters(movies);
    showRecommendations(movies);
    resetInfiniteScroll();
}

function resetInfiniteScroll(){ currentOffset = 0; hasMore = true; document.getElementById('gallery').innerHTML=''; loadMoreMovies(); }

async function loadMoreMovies(){
    if(isLoading || !hasMore) return;
    isLoading = true;
    const newMovies = await getFilteredMovies(currentOffset, BATCH_SIZE);
    const gallery = document.getElementById('gallery');
    const isWatchlistMode = document.getElementById('viewMode').value === 'watchlist';

    // Rimuove precedente istanza Sortable se esiste
    if (gallery.sortableInstance) {
        gallery.sortableInstance.destroy();
        gallery.sortableInstance = null;
    }

    newMovies.forEach(m => {
        const card = document.createElement('div');
        card.className = 'movie-card' + (isWatchlistMode ? ' sortable-card' : '');
        card.setAttribute('data-id', m.id);
        card.innerHTML = `
            <div class="poster-container">
                <img src="${m.poster}" loading="lazy">
            </div>
            <div class="card-info">
                <h3>${m.title}</h3>
                <div class="quick-tools">
                    <span style="color:var(--accent);">★ ${m.rating||'-'}</span>
                    <button class="btn-quick vote-btn">VOTE</button>
                </div>
            </div>
        `;

        // Click sull’intera card → apre la modale di recensione
        card.addEventListener('click', () => window.openReview(m.id));

        // Pulsante VOTE (presente su tutti i film)
        const voteBtn = card.querySelector('.vote-btn');
        voteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const newRating = prompt(`Rating for "${m.title}" (0-10):`, m.rating || '');
            if (newRating && !isNaN(parseFloat(newRating))) {
                const rating = parseFloat(newRating);
                if (m.isWatchlist) {
                    await updateDoc(doc(db, "users", currentUser.uid, "movies", m.id), {
                        rating,
                        isWatchlist: false,
                        watchDate: new Date().toISOString().split('T')[0]
                    });
                    // Se siamo nella watchlist, rimuovi la card con animazione
                    if (isWatchlistMode) {
                        card.style.transition = 'opacity 0.3s, transform 0.3s';
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.8)';
                        setTimeout(() => card.remove(), 300);
                    } else {
                        // In archivio aggiorna solo il voto visualizzato
                        const ratingSpan = card.querySelector('.quick-tools span');
                        if (ratingSpan) ratingSpan.textContent = `★ ${rating}`;
                    }
                } else {
                    await updateDoc(doc(db, "users", currentUser.uid, "movies", m.id), { rating });
                    const ratingSpan = card.querySelector('.quick-tools span');
                    if (ratingSpan) ratingSpan.textContent = `★ ${rating}`;
                }
                const movies = await fetchAllMovies();
                updateSpotlightAndCounters(movies);
                showToast('Rating updated!');
            }
        });

        gallery.appendChild(card);
    });

    // Inizializza Sortable solo per la watchlist
    if (isWatchlistMode && typeof Sortable !== 'undefined') {
        gallery.sortableInstance = new Sortable(gallery, {
            animation: 250,
            ghostClass: 'sortable-ghost',
            onEnd: async function(evt) {
                const cards = [...gallery.querySelectorAll('.movie-card[data-id]')];
                for (let i = 0; i < cards.length; i++) {
                    const id = cards[i].getAttribute('data-id');
                    await updateDoc(doc(db, "users", currentUser.uid, "movies", id), { order: i });
                }
                // Non serve renderGallery() per non perdere l'ordine corrente
                showToast('Order saved');
            }
        });
    }

    currentOffset += BATCH_SIZE;
    isLoading = false;
}

// --- REVIEW, EDIT, DELETE ---
async function openReview(id){
    currentMovieId = id;
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", id));
    const m = snap.data();
    document.getElementById('viewTitle').innerText=m.title;
    document.getElementById('viewRating').innerText=m.isWatchlist?"Watchlist":`★ ${m.rating}/10`;
    document.getElementById('viewMetadata').innerHTML=`${m.director} | ${m.year} | ${m.runtime} | ${m.genres}`;
    document.getElementById('viewPlot').innerText=m.plot;
    document.getElementById('dynamicBackdrop').style.backgroundImage = `url('${m.backdrop}')`;
    document.getElementById('viewAwards').innerHTML=(m.awards||[]).map(a=>`<span>${a}</span>`).join('');
    const cont=document.getElementById('reviewContainer');
    if(m.fileData){
        if(m.fileType==='application/pdf') cont.innerHTML=`<embed src="${m.fileData}" type="application/pdf" width="100%" height="500px">`;
        else cont.innerHTML=`<iframe src="${m.fileData}" width="100%" height="500px"></iframe>`;
    } else cont.innerHTML='<p>No written review.</p>';
    reviewModal.style.display='block';
    // Modalità focus
    requestAnimationFrame(() => reviewModal.classList.add('active'));
    showSimilarMovies(id);
}

// Chiusura modale recensione rimuove l'effetto focus
const closeReviewModal = () => {
    reviewModal.classList.remove('active');
    reviewModal.style.display = 'none';
};

document.getElementById('editBtn').onclick = async()=>{
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    const m = snap.data();
    reviewModal.classList.remove('active'); // in caso
    reviewModal.style.display='none'; 
    modal.style.display='block';
    document.getElementById('tmdbTitle').value=m.title;
    document.getElementById('tmdbPlot').value=m.plot;
    document.getElementById('tmdbPoster').value=m.poster;
    document.getElementById('rating').value=m.rating||'';
    document.getElementById('watchDate').value=m.watchDate||'';
    document.getElementById('isWatchlist').checked=!!m.isWatchlist;
    document.querySelectorAll('.seba-award').forEach(cb=>cb.checked=(m.awards||[]).includes(cb.value));
    document.getElementById('previewTitle').innerText=m.title;
    document.getElementById('previewPoster').src=m.poster;
    document.getElementById('moviePreview').style.display='flex';
    currentSelectedMovieExtras={year:m.year, director:m.director, genres:m.genres, backdrop:m.backdrop, runtime:m.runtime};
};

document.getElementById('deleteBtn').onclick = async()=>{ 
    if(confirm("Delete forever?")){ 
        await deleteDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
        reviewModal.classList.remove('active');
        reviewModal.style.display='none'; 
        renderGallery(); 
    } 
};

// --- SIMILAR MOVIES & RECOMMENDATIONS ---
async function showSimilarMovies(id){
    const movies = await fetchAllMovies();
    const current = movies.find(m => m.id === id);
    const scored = movies.filter(m => !m.isWatchlist && m.id !== id).map(m => {
        let s=0; if(m.director === current.director) s+=5; 
        if(m.genres?.split(', ').some(g => current.genres?.includes(g))) s+=3;
        return {movie:m, score:s};
    }).sort((a,b)=>b.score-a.score).slice(0,4);
    const grid = document.getElementById('similarGrid');
    grid.innerHTML = '';
    scored.forEach(({movie})=> grid.appendChild(createSmallCard(movie)));
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
    div.innerHTML = `<div class="poster-container"><img src="${m.poster}"></div><div class="card-info"><h3>${m.title}</h3></div>`;
    return div;
}

// --- STATS ---
async function updateAdvancedStats(){
    const movies = await fetchAllMovies();
    const watched = movies.filter(m=>!m.isWatchlist);
    if(!watched.length) return;
    const ratings = watched.map(m=>m.rating||0);
    const mins = watched.reduce((sum, m) => sum + getRuntimeMinutes(m.runtime), 0);
    
    document.getElementById('statTotalMovies').innerText = watched.length;
    document.getElementById('statTotalHours').innerText = Math.round(mins/60)+"h";
    document.getElementById('statReviewsCount').innerText = watched.filter(m=>m.fileData).length;
    document.getElementById('statAvgRating').innerText = (ratings.reduce((a,b)=>a+b)/ratings.length).toFixed(2);
    document.getElementById('statMedian').innerText = getMedian(ratings).toFixed(1);
    document.getElementById('statStdDev').innerText = getStdDev(ratings).toFixed(2);

    const dirMap = new Map();
    watched.forEach(m => {
        if(m.director && m.director!=='Unknown') {
            if(!dirMap.has(m.director)) dirMap.set(m.director, {count:0, time:0});
            dirMap.get(m.director).count++;
            dirMap.get(m.director).time += getRuntimeMinutes(m.runtime);
        }
    });

    const topDirs = Array.from(dirMap.entries()).sort((a,b)=>b[1].count - a[1].count).slice(0,5);
    document.getElementById('topDirectorsList').innerHTML = topDirs.map(([n,d])=>`<div class="stat-badge">${n} · ${d.count} films</div>`).join('');
    const dirTime = Array.from(dirMap.entries()).sort((a,b)=>b[1].time - a[1].time).slice(0,5);
    document.getElementById('directorTimeList').innerHTML = dirTime.map(([n,d])=>`<div class="stat-badge">${n} · ${Math.round(d.time/60)}h</div>`).join('');

    const genreStats = new Map();
    watched.forEach(m => {
        if(m.genres) {
            m.genres.split(', ').forEach(g => {
                if(!genreStats.has(g)) genreStats.set(g, {sum: 0, count: 0});
                genreStats.get(g).sum += m.rating || 0;
                genreStats.get(g).count++;
            });
        }
    });
    const topGenres = Array.from(genreStats.entries())
        .map(([name, data]) => ({ name, avg: data.sum / data.count, count: data.count }))
        .filter(g => g.count >= 2) 
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 5);
    document.getElementById('topGenresList').innerHTML = topGenres.length 
        ? topGenres.map(g => `<div class="stat-badge">${g.name} · ⭐ ${g.avg.toFixed(1)} (${g.count} film)</div>`).join('')
        : '<p style="color: var(--text-muted); margin: 0;">Add more films to see top rated genres.</p>';

    if(ratingChartInstance) ratingChartInstance.destroy();
    const labels=[], counts=new Array(21).fill(0);
    for(let i=0;i<=10;i+=0.5) labels.push(i.toFixed(1));
    watched.forEach(m=>{ const idx=Math.round((m.rating||0)*2); if(idx>=0 && idx<21) counts[idx]++; });
    ratingChartInstance = new Chart(document.getElementById('ratingChart'), {type:'bar', data:{labels, datasets:[{data:counts, backgroundColor:'rgba(196,48,43,0.7)'}]}, options:{plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, grid:{color:'#2d3748'}, ticks:{color:'#fff'}}, x:{ticks:{color:'#fff'}}}} });
}

document.getElementById('statsBtn').onclick = () => { updateAdvancedStats(); statsModal.style.display='block'; };

// --- SPOTLIGHT ---
function startDynamicSpotlight() {
    if (spotlightInterval) clearInterval(spotlightInterval);
    spotlightInterval = setInterval(async () => {
        const movies = await fetchAllMovies();
        updateSpotlightAndCounters(movies);
    }, 20000);
}

function updateSpotlightAndCounters(movies){
    document.getElementById('globalCounters').innerText = `${movies.filter(m=>!m.isWatchlist).length} Watched | ${movies.filter(m=>m.isWatchlist).length} To Watch`;
    const viewMode = document.getElementById('viewMode').value;
    const list = movies.filter(m => !!m.isWatchlist === (viewMode==='watchlist') && m.backdrop);
    if(list.length){
        const rand = list[Math.floor(Math.random()*list.length)];
        document.getElementById('spotlightTitle').innerText = rand.title;
        document.getElementById('spotlightDirector').innerText = `Directed by ${rand.director}`;
        document.getElementById('spotlightBackdrop').style.backgroundImage = `url('${rand.backdrop}')`;
        document.getElementById('spotlightHeader').style.display='flex';
    }
}

// --- LISTENERS & IMPORT ---
document.getElementById('viewMode').onchange = () => {
    // Distruggi Sortable prima di cambiare vista
    const gallery = document.getElementById('gallery');
    if (gallery.sortableInstance) {
        gallery.sortableInstance.destroy();
        gallery.sortableInstance = null;
    }
    renderGallery();
    startDynamicSpotlight();
};
document.getElementById('sortOrder').onchange = (e) => { currentFilters.sort = e.target.value; renderGallery(); };
document.getElementById('mainSearch').oninput = (e) => { currentFilters.search = e.target.value; renderGallery(); };
document.getElementById('filterYear').onchange = (e) => { currentFilters.year = e.target.value; renderGallery(); };
document.getElementById('filterGenre').onchange = (e) => { currentFilters.genre = e.target.value; renderGallery(); };
document.getElementById('filterRating').onchange = (e) => { currentFilters.rating = e.target.value; renderGallery(); };
document.getElementById('filterAward').onchange = (e) => { currentFilters.award = e.target.value; renderGallery(); };
document.getElementById('filterHasReview').onchange = (e) => { currentFilters.hasReview = e.target.checked; renderGallery(); };
document.getElementById('filterDirector').oninput = (e) => { currentFilters.director = e.target.value; renderGallery(); };

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
    showToast('Archive cleared!');
    document.getElementById('statsModal').style.display = 'none';
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
document.querySelector('.close-modal').onclick = () => modal.style.display = 'none';
document.querySelector('.close-review').onclick = closeReviewModal;
document.querySelector('.close-stats').onclick = () => statsModal.style.display = 'none';
document.querySelector('.close-trailer').onclick = () => document.getElementById('trailerModal').style.display = 'none';

window.onclick = (event) => {
    if (event.target == modal) modal.style.display = "none";
    if (event.target == reviewModal) closeReviewModal();
    if (event.target == statsModal) statsModal.style.display = "none";
    if (event.target == document.getElementById('trailerModal')) document.getElementById('trailerModal').style.display = "none";
};

// --- TRAILER ---
document.getElementById('trailerBtn')?.addEventListener('click', async ()=>{
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    const m = snap.data();
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(m.title)}&year=${m.year}`);
    const data = await res.json();
    if(data.results?.length){
        const vRes = await fetch(`https://api.themoviedb.org/3/movie/${data.results[0].id}/videos?api_key=${TMDB_API_KEY}`);
        const vData = await vRes.json();
        const t = vData.results.find(v=>v.type==='Trailer' && v.site==='YouTube');
        if(t) {
            document.getElementById('trailerIframe').src = `https://www.youtube.com/embed/${t.key}`;
            document.getElementById('trailerModal').style.display = 'block';
        }
    }
});

// --- IMPORT CSV (completo, recupera regista, generi, runtime) ---
document.getElementById('importCsvBtn').onclick = () => document.getElementById('csvFileInput').click();
document.getElementById('csvFileInput').onchange = (e) => {
    const file = e.target.files[0];
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
                    const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(row.Name)}&year=${row.Year}`);
                    const sData = await res.json();
                    if (sData.results?.length) {
                        const tmdb = sData.results[0];
                        // Ottieni dettagli completi e crediti
                        const [detRes, credRes] = await Promise.all([
                            fetch(`https://api.themoviedb.org/3/movie/${tmdb.id}?api_key=${TMDB_API_KEY}&language=en-US`).then(r => r.json()),
                            fetch(`https://api.themoviedb.org/3/movie/${tmdb.id}/credits?api_key=${TMDB_API_KEY}`).then(r => r.json())
                        ]);
                        const director = credRes.crew?.find(p => p.job === 'Director')?.name || 'Unknown';
                        const genres = detRes.genres?.map(g => g.name).join(', ') || '';
                        const runtime = detRes.runtime ? `${detRes.runtime} min` : 'N/A';
                        const year = detRes.release_date?.split('-')[0] || tmdb.release_date?.split('-')[0] || row.Year;

                        await addDoc(collection(db, "users", currentUser.uid, "movies"), {
                            title: tmdb.title,
                            poster: `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`,
                            backdrop: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}` : '',
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
            showToast('Import complete!');
            renderGallery();
        }
    });
};

// Esponi funzioni globali per onclick inline
window.quickEdit = async (id) => { /* non più usato ma mantenuto */ };
window.moveToArchive = async (id) => { /* non più usato */ };
window.openReview = openReview;

function populateFilters(movies) {
    const years = [...new Set(movies.map(m => m.year))].filter(y => y && y !== 'N/A').sort().reverse();
    const dirs = [...new Set(movies.map(m => m.director))].filter(d => d && d !== 'Unknown').sort();
    const genresSet = new Set();
    movies.forEach(m => m.genres?.split(', ').forEach(g => genresSet.add(g)));
    document.getElementById('filterYear').innerHTML = '<option value="">All Years</option>' + years.map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('filterGenre').innerHTML = '<option value="">All Genres</option>' + Array.from(genresSet).sort().map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('directorOptions').innerHTML = dirs.map(v => `<option value="${v}">`).join('');
}

const observer = new IntersectionObserver(entries => { if(entries[0].isIntersecting) loadMoreMovies(); }, { threshold:0.1 });
observer.observe(document.getElementById('sentinel'));
