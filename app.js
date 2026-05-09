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

// --- GLOBALI ---
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

// Helper per scaricare tutti i film dal cloud
async function fetchAllMovies() {
    if (!currentUser) return [];
    const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// --- TMDB SEARCH (Ripristinato Regista e Crediti) ---
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

// --- SALVATAGGIO ---
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
        updatedAt: serverTimestamp()
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

// --- GALLERIA E FILTRI ---
async function getFilteredMovies(){
    let movies = await fetchAllMovies();
    const isWatchlistMode = document.getElementById('viewMode').value === 'watchlist';
    const searchTerm = currentFilters.search.toLowerCase();
    const decade = currentFilters.decade;

    movies = movies.filter(m => {
        if(!!m.isWatchlist !== isWatchlistMode) return false;
        if(searchTerm && !m.title.toLowerCase().includes(searchTerm)) return false;
        if(currentFilters.director && m.director && !m.director.toLowerCase().includes(currentFilters.director.toLowerCase())) return false;
        if(currentFilters.year && m.year !== currentFilters.year) return false;
        if(currentFilters.genre && !(m.genres||'').includes(currentFilters.genre)) return false;
        if(currentFilters.rating && m.rating < parseFloat(currentFilters.rating)) return false;
        if(decade){ const y = parseInt(m.year); if(isNaN(y) || y < parseInt(decade) || y > parseInt(decade)+9) return false; }
        return true;
    });

    const sort = currentFilters.sort;
    if(sort === 'highest_rated') movies.sort((a,b)=>b.rating - a.rating);
    else if(sort === 'year_new') movies.sort((a,b)=>parseInt(b.year)-parseInt(a.year));
    else if(sort === 'year_old') movies.sort((a,b)=>parseInt(a.year)-parseInt(b.year));
    else movies.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    return movies;
}

async function renderGallery(){ 
    const movies = await fetchAllMovies();
    populateFilters(movies);
    updateSpotlightAndCounters(movies);
    showRecommendations(movies);
    resetInfiniteScroll();
}

function resetInfiniteScroll(){ document.getElementById('gallery').innerHTML=''; loadMoreMovies(); }

async function loadMoreMovies(){
    if(isLoading) return;
    isLoading = true;
    const newMovies = await getFilteredMovies();
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = '';
    newMovies.forEach(m => {
        const card = document.createElement('div'); card.className='movie-card';
        card.innerHTML = `<div class="poster-container" onclick="openReview('${m.id}')"><img src="${m.poster}" loading="lazy"></div>
        <div class="card-info"><h3>${m.title}</h3><div class="quick-tools"><span style="color:var(--accent);">★ ${m.rating||'-'}</span>
        ${m.isWatchlist ? `<button class="btn-quick" onclick="moveToArchive('${m.id}')">DONE</button>` : `<button class="btn-quick" onclick="quickEdit('${m.id}')">VOTE</button>`}</div></div>`;
        gallery.appendChild(card);
    });
    isLoading = false;
}

// --- REVIEW E EDIT ---
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
    showSimilarMovies(id);
}

document.getElementById('editBtn').onclick = async()=>{
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    const m = snap.data();
    reviewModal.style.display='none'; modal.style.display='block';
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
        reviewModal.style.display='none'; renderGallery(); 
    } 
};

// --- STATISTICHE AVANZATE (Ripristinate) ---
async function updateAdvancedStats(){
    const movies = await fetchAllMovies();
    const watched = movies.filter(m=>!m.isWatchlist);
    if(!watched.length) return;
    
    // Director Stats
    const dirMap = new Map();
    watched.forEach(m => {
        if(!m.director || m.director==='Unknown') return;
        if(!dirMap.has(m.director)) dirMap.set(m.director, {count:0, sumRatings:0, runtime:0});
        const d = dirMap.get(m.director);
        d.count++; d.sumRatings += m.rating||0; d.runtime += getRuntimeMinutes(m.runtime);
    });
    const topDirs = Array.from(dirMap.entries()).map(([name,data])=>({name, count:data.count, avg:data.sumRatings/data.count, time:data.runtime})).sort((a,b)=>b.count - a.count).slice(0,5);
    document.getElementById('topDirectorsList').innerHTML = topDirs.map(d=>`<div class="stat-badge"><strong>${d.name}</strong> · ${d.count} films · avg ${d.avg.toFixed(1)}</div>`).join('');
    
    // Rating Chart
    const ratings = watched.map(m=>m.rating||0);
    document.getElementById('statTotalMovies').innerText = watched.length;
    document.getElementById('statAvgRating').innerText = (ratings.reduce((a,b)=>a+b)/ratings.length).toFixed(2);
    if(ratingChartInstance) ratingChartInstance.destroy();
    const labels=[], counts=new Array(21).fill(0);
    for(let i=0;i<=10;i+=0.5) labels.push(i.toFixed(1));
    watched.forEach(m=>{ const idx=Math.round((m.rating||0)*2); if(idx>=0 && idx<21) counts[idx]++; });
    ratingChartInstance = new Chart(document.getElementById('ratingChart'), {type:'bar', data:{labels, datasets:[{data:counts, backgroundColor:'rgba(196,48,43,0.7)'}]}, options:{plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, grid:{color:'#2d3748'}, ticks:{color:'#fff'}}, x:{ticks:{color:'#fff'}}}} });
}

document.getElementById('statsBtn').onclick = () => { updateAdvancedStats(); statsModal.style.display='block'; };

// --- SUGGERIMENTI E SIMILI ---
async function showRecommendations(movies) {
    const favorites = movies.filter(m => !m.isWatchlist && m.rating >= 8);
    const watchlist = movies.filter(m => m.isWatchlist);
    const scored = watchlist.map(w => {
        let s = 0;
        favorites.forEach(f => { if(f.director === w.director) s+=5; if(f.genres === w.genres) s+=3; });
        return { movie: w, score: s };
    }).sort((a,b)=>b.score - a.score).slice(0,4);
    const grid = document.getElementById('recommendGrid');
    grid.innerHTML = '';
    scored.forEach(({movie}) => {
        const div = document.createElement('div'); div.className='movie-card'; div.onclick=()=>openReview(movie.id);
        div.innerHTML = `<div class="poster-container"><img src="${movie.poster}"></div><h3>${movie.title}</h3>`;
        grid.appendChild(div);
    });
}

async function showSimilarMovies(id){
    const movies = await fetchAllMovies();
    const current = movies.find(m => m.id === id);
    const scored = movies.filter(m => !m.isWatchlist && m.id !== id).map(m => {
        let s=0; if(m.director === current.director) s+=5; if(m.genres === current.genres) s+=3;
        return {movie:m, score:s};
    }).sort((a,b)=>b.score-a.score).slice(0,4);
    const grid = document.getElementById('similarGrid');
    grid.innerHTML = '';
    scored.forEach(({movie})=> {
        const div = document.createElement('div'); div.className='movie-card'; div.onclick=()=>openReview(movie.id);
        div.innerHTML = `<div class="poster-container"><img src="${movie.poster}"></div><h3>${movie.title}</h3>`;
        grid.appendChild(div);
    });
}

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
        document.getElementById('spotlightBackdrop').style.backgroundImage = `url('${rand.backdrop}')`;
        document.getElementById('spotlightHeader').style.display='flex';
    }
}

// --- EVENT LISTENERS (Filtri, Modali, ecc.) ---
document.getElementById('viewMode').onchange = renderGallery;
document.getElementById('sortOrder').onchange = renderGallery;
document.getElementById('mainSearch').oninput = (e) => { currentFilters.search = e.target.value; renderGallery(); };
document.getElementById('filterYear').onchange = (e) => { currentFilters.year = e.target.value; renderGallery(); };
document.getElementById('resetFiltersBtn').onclick = () => { location.reload(); };

document.querySelectorAll('.decade-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.decade-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        currentFilters.decade = btn.dataset.decade;
        renderGallery();
    };
});

// Chiusura Modali
document.querySelector('.close-modal').onclick = () => modal.style.display='none';
document.querySelector('.close-review').onclick = () => reviewModal.style.display='none';
document.querySelector('.close-stats').onclick = () => statsModal.style.display='none';
document.querySelector('.close-trailer').onclick = () => document.getElementById('trailerModal').style.display='none';

// --- INITIALIZE ---
const sentinel = document.getElementById('sentinel');
const observer = new IntersectionObserver(entries => { if(entries[0].isIntersecting) loadMoreMovies(); }, { threshold:0.1 });
observer.observe(sentinel);

function populateFilters(movies) {
    const years = [...new Set(movies.map(m => m.year))].filter(y => y && y !== 'N/A').sort().reverse();
    document.getElementById('filterYear').innerHTML = '<option value="">All Years</option>' + years.map(v => `<option value="${v}">${v}</option>`).join('');
}

function closeForm(){ modal.style.display='none'; document.getElementById('movieForm').reset(); document.getElementById('moviePreview').style.display='none'; currentMovieId=null; }
document.getElementById('addBtn').onclick = () => { closeForm(); modal.style.display='block'; };

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
        if(t){
            document.getElementById('trailerIframe').src = `https://www.youtube.com/embed/${t.key}`;
            document.getElementById('trailerModal').style.display = 'block';
        }
    }
});

async function quickEdit(id){ 
    const val=prompt("New rating:"); 
    if(val) await updateDoc(doc(db, "users", currentUser.uid, "movies", id), {rating: parseFloat(val)});
    renderGallery();
}

async function moveToArchive(id){ 
    const val=prompt("Final rating:"); 
    if(val) await updateDoc(doc(db, "users", currentUser.uid, "movies", id), {isWatchlist: false, rating: parseFloat(val), watchDate: new Date().toISOString().split('T')[0]});
    renderGallery();
}

window.quickEdit = quickEdit;
window.moveToArchive = moveToArchive;
