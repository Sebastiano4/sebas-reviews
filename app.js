const TMDB_API_KEY = '0de9856190bca7ec5acd797969c1d952'; // <-- PUT YOUR NEW KEY HERE

const db = new Dexie("SebasReviewsDB");
db.version(4).stores({ movies: '++id, title, rating, watchDate, plot, poster, backdrop, year, director, genres, runtime, fileType, fileData, isWatchlist, *awards' });

let currentMovieId = null, currentSelectedMovieExtras = {}, ratingChartInstance = null;
let isLoading = false, hasMore = true, currentOffset = 0, BATCH_SIZE = 20;
let currentFilters = { search: '', director: '', year: '', genre: '', award: '', rating: '', hasReview: false, sort: 'newest_added', decade: '' };
let spotlightInterval = null;

// DOM elements
const modal = document.getElementById('modal'), reviewModal = document.getElementById('reviewModal'), statsModal = document.getElementById('statsModal');
const tmdbSearch = document.getElementById('tmdbSearch'), searchResults = document.getElementById('searchResults');
let timeoutId;

// ------ UTILS ------
const getMedian = (arr) => { if (!arr.length) return 0; const sorted = [...arr].sort((a,b)=>a-b); const mid = Math.floor(sorted.length/2); return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; };
const getStdDev = (arr) => { if (!arr.length) return 0; const mean = arr.reduce((a,b)=>a+b)/arr.length; return Math.sqrt(arr.map(x=>Math.pow(x-mean,2)).reduce((a,b)=>a+b)/arr.length); };
const toBase64 = f => new Promise((res,rej)=>{ const r=new FileReader(); r.readAsDataURL(f); r.onload=()=>res(r.result); r.onerror=rej; });

// FIX: Safer calculation with a 105-minute fallback for old database entries
const getRuntimeMinutes = (runtime) => {
    if (!runtime || runtime === 'N/A' || runtime === 'Unknown') return 105; 
    if (typeof runtime === 'number') return runtime;
    const match = String(runtime).match(/\d+/);
    return match ? parseInt(match[0], 10) : 105;
};

// --- POPULATE FILTERS (fix genre) ---
function populateFilters(movies) {
    const years = [...new Set(movies.map(m => m.year))].filter(y => y && y !== 'N/A').sort().reverse();
    const dirs = [...new Set(movies.map(m => m.director))].filter(d => d && d !== 'Unknown').sort();
    const genresSet = new Set();
    movies.forEach(m => {
        if (m.genres && typeof m.genres === 'string' && m.genres !== 'N/A' && m.genres !== '') {
            m.genres.split(', ').forEach(g => genresSet.add(g.trim()));
        }
    });
    document.getElementById('filterYear').innerHTML = '<option value="">All Years</option>' + years.map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('directorOptions').innerHTML = dirs.map(v => `<option value="${v}">`).join('');
    document.getElementById('filterGenre').innerHTML = '<option value="">All Genres</option>' + Array.from(genresSet).sort().map(v => `<option value="${v}">${v}</option>`).join('');
}
async function refreshFilters() {
    const allMovies = await db.movies.toArray();
    populateFilters(allMovies);
}

// --- TOGGLE REVIEW FIELDS ---
document.getElementById('isWatchlist').addEventListener('change', () => { document.getElementById('reviewFields').style.display = document.getElementById('isWatchlist').checked ? 'none' : 'block'; });

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
            
            // Gets a small version of the poster (w92), or leaves it blank if none exists
            const posterHtml = movie.poster_path 
                ? `<img src="https://image.tmdb.org/t/p/w92${movie.poster_path}" class="dropdown-poster">` 
                : `<div class="dropdown-poster" style="background:#0c0e12;"></div>`;

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

// --- SAVE / UPDATE ---
document.getElementById('movieForm').onsubmit = async(e)=>{
    e.preventDefault();
    const isWatchlist = document.getElementById('isWatchlist').checked;
    const awards = isWatchlist ? [] : Array.from(document.querySelectorAll('.seba-award:checked')).map(cb=>cb.value);
    const rating = isWatchlist ? null : parseFloat(document.getElementById('rating').value);
    const watchDate = isWatchlist ? null : document.getElementById('watchDate').value;
    const fileInput = document.getElementById('reviewFile').files[0];
    let fileData=null, fileType=null;
    if(fileInput){ fileData=await toBase64(fileInput); fileType=fileInput.type; }
    let movieData = {
        title: document.getElementById('tmdbTitle').value,
        plot: document.getElementById('tmdbPlot').value,
        poster: document.getElementById('tmdbPoster').value,
        rating, watchDate, isWatchlist, awards,
        ...currentSelectedMovieExtras
    };
    if(fileData) { movieData.fileData = fileData; movieData.fileType = fileType; }
    if(currentMovieId){
        const old = await db.movies.get(currentMovieId);
        if(!currentSelectedMovieExtras.director){
            movieData.year=old.year; movieData.director=old.director;
            movieData.genres=old.genres; movieData.backdrop=old.backdrop;
            movieData.runtime=old.runtime;
        }
        if(!fileData) { movieData.fileData=old.fileData; movieData.fileType=old.fileType; }
        await db.movies.update(currentMovieId, movieData);
    } else {
        await db.movies.add(movieData);
    }
    closeForm(); resetInfiniteScroll(); renderGallery(); refreshFilters(); startDynamicSpotlight();
};

// --- INFINITE SCROLL & BATCH LOADING ---
async function getFilteredMovies(offset, limit){
    let movies = await db.movies.toArray();
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
    if(sort === 'highest_rated') movies.sort((a,b)=>b.rating - a.rating);
    else if(sort === 'year_new') movies.sort((a,b)=>parseInt(b.year)-parseInt(a.year));
    else if(sort === 'year_old') movies.sort((a,b)=>parseInt(a.year)-parseInt(b.year));
    else movies.reverse();
    hasMore = offset+limit < movies.length;
    return movies.slice(offset, offset+limit);
}
async function loadMoreMovies(){
    if(isLoading || !hasMore) return;
    isLoading = true;
    const skeletonContainer = document.getElementById('gallery');
    for(let i=0; i<BATCH_SIZE; i++){
        const skel = document.createElement('div'); skel.className = 'skeleton-card'; skeletonContainer.appendChild(skel);
    }
    const newMovies = await getFilteredMovies(currentOffset, BATCH_SIZE);
    document.querySelectorAll('.skeleton-card').forEach(s=>s.remove());
    appendMovies(newMovies);
    currentOffset += BATCH_SIZE;
    isLoading = false;
    if(!hasMore && observer) observer.disconnect();
}
function appendMovies(movies){
    const gallery = document.getElementById('gallery');
    movies.forEach(m => {
        const card = createMovieCard(m);
        gallery.appendChild(card);
    });
}
function createMovieCard(m){
    const card = document.createElement('div'); card.className='movie-card';
    card.innerHTML = `<div class="poster-container" onclick="openReview(${m.id})"><img src="${m.poster}" loading="lazy"></div>
    <div class="card-info"><h3>${m.title}</h3><div class="quick-tools"><span style="color:var(--accent);">★ ${m.rating||'-'}</span>
    ${m.isWatchlist ? `<button class="btn-quick" onclick="moveToArchive(${m.id})">DONE</button>` : `<button class="btn-quick" onclick="quickEdit(${m.id})">VOTE</button>`}</div></div>`;
    return card;
}
function resetInfiniteScroll(){ currentOffset=0; hasMore=true; document.getElementById('gallery').innerHTML=''; loadMoreMovies(); }
let observer;
function initInfiniteScroll(){ 
    if(observer) observer.disconnect();
    const sentinel = document.getElementById('sentinel');
    observer = new IntersectionObserver(entries => { if(entries[0].isIntersecting) loadMoreMovies(); }, { threshold:0.1 });
    observer.observe(sentinel);
}
function updateFiltersAndReset(){
    currentFilters = {
        search: document.getElementById('mainSearch').value,
        director: document.getElementById('filterDirector').value,
        year: document.getElementById('filterYear').value,
        genre: document.getElementById('filterGenre').value,
        award: document.getElementById('filterAward').value,
        rating: document.getElementById('filterRating').value,
        hasReview: document.getElementById('filterHasReview').checked,
        sort: document.getElementById('sortOrder').value,
        decade: document.querySelector('.decade-btn.active')?.dataset.decade || ''
    };
    resetInfiniteScroll();
    updateSpotlightAndCounters();
}
async function updateSpotlightAndCounters(){
    const movies = await db.movies.toArray();
    const totalWatched = movies.filter(m=>!m.isWatchlist).length;
    const totalWatchlist = movies.filter(m=>m.isWatchlist).length;
    document.getElementById('globalCounters').innerText = `${totalWatched} Watched | ${totalWatchlist} To Watch`;
    const viewMode = document.getElementById('viewMode').value;
    const list = movies.filter(m => !!m.isWatchlist === (viewMode==='watchlist') && m.backdrop);
    const spotlight = document.getElementById('spotlightHeader');
    if(list.length){
        const rand = list[Math.floor(Math.random()*list.length)];
        document.getElementById('spotlightTitle').innerText = rand.title;
        document.getElementById('spotlightDirector').innerText = `Directed by ${rand.director}`;
        document.getElementById('spotlightBackdrop').style.backgroundImage = `url('${rand.backdrop}')`;
        spotlight.style.display='flex';
    } else spotlight.style.display='none';
}
async function renderGallery(){ updateFiltersAndReset(); await refreshFilters(); }

// --- DYNAMIC SPOTLIGHT ---
function startDynamicSpotlight() {
    if (spotlightInterval) clearInterval(spotlightInterval);
    spotlightInterval = setInterval(async () => {
        const movies = await db.movies.toArray();
        const viewMode = document.getElementById('viewMode').value;
        const list = movies.filter(m => !!m.isWatchlist === (viewMode === 'watchlist') && m.backdrop);
        if (list.length > 1) {
            let newIndex = Math.floor(Math.random() * list.length);
            const currentTitle = document.getElementById('spotlightTitle').innerText;
            while (list[newIndex].title === currentTitle && list.length > 1) {
                newIndex = Math.floor(Math.random() * list.length);
            }
            const rand = list[newIndex];
            document.getElementById('spotlightTitle').innerText = rand.title;
            document.getElementById('spotlightDirector').innerText = `Directed by ${rand.director}`;
            document.getElementById('spotlightBackdrop').style.backgroundImage = `url('${rand.backdrop}')`;
        }
    }, 20000);
}

// --- DECADE FILTER ---
document.querySelectorAll('.decade-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.decade-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        updateFiltersAndReset();
    };
});

// --- STATS ---
async function updateAdvancedStats(){
    const watched = await db.movies.filter(m=>!m.isWatchlist).toArray();
    if(!watched.length) return;
    const dirMap = new Map();
    watched.forEach(m => {
        if(!m.director || m.director==='Unknown') return;
        if(!dirMap.has(m.director)) dirMap.set(m.director, {count:0, sumRatings:0, runtime:0});
        const d = dirMap.get(m.director);
        d.count++; d.sumRatings += m.rating||0; d.runtime += getRuntimeMinutes(m.runtime);
    });
    const topDirectors = Array.from(dirMap.entries()).map(([name,data])=>({name, count:data.count, avg:data.sumRatings/data.count, time:data.runtime})).sort((a,b)=>b.count - a.count).slice(0,5);
    document.getElementById('topDirectorsList').innerHTML = topDirectors.map(d=>`<div class="stat-badge"><strong>${d.name}</strong> · ${d.count} films · avg ${d.avg.toFixed(1)}</div>`).join('') || '—';
    const genreMap = new Map();
    watched.forEach(m => {
        if(!m.genres || m.genres==='N/A') return;
        m.genres.split(', ').forEach(g => {
            if(!genreMap.has(g)) genreMap.set(g, {sum:0, count:0});
            const data = genreMap.get(g);
            data.sum += m.rating||0; data.count++;
        });
    });
    const topGenres = Array.from(genreMap.entries()).map(([name,data])=>({name, avg:data.sum/data.count, count:data.count})).filter(g=>g.count>=2).sort((a,b)=>b.avg - a.avg).slice(0,5);
    document.getElementById('topGenresList').innerHTML = topGenres.map(g=>`<div class="stat-badge">${g.name} · ⭐ ${g.avg.toFixed(1)} (${g.count} films)</div>`).join('') || '—';
    const dirTime = Array.from(dirMap.entries()).map(([name,data])=>({name, hours: Math.round(data.runtime/60)})).sort((a,b)=>b.hours - a.hours).slice(0,5);
    document.getElementById('directorTimeList').innerHTML = dirTime.map(d=>`<div class="stat-badge">${d.name} · ${d.hours} hours</div>`).join('') || '—';
}

document.getElementById('statsBtn').onclick = async () => {
    const watched = await db.movies.filter(m=>!m.isWatchlist).toArray();
    if(!watched.length) return alert("No watched movies yet.");
    const ratings = watched.map(m=>m.rating||0);
    document.getElementById('statTotalMovies').innerText = watched.length;
    const mins = watched.reduce((sum, m) => sum + getRuntimeMinutes(m.runtime), 0);
    document.getElementById('statTotalHours').innerText = Math.round(mins/60)+"h";
    document.getElementById('statReviewsCount').innerText = watched.filter(m=>m.fileData).length;
    const mean = ratings.reduce((a,b)=>a+b)/ratings.length;
    document.getElementById('statAvgRating').innerText = mean.toFixed(2);
    document.getElementById('statMedian').innerText = getMedian(ratings).toFixed(1);
    document.getElementById('statStdDev').innerText = getStdDev(ratings).toFixed(2);
    if(ratingChartInstance) ratingChartInstance.destroy();
    const labels=[], counts=new Array(21).fill(0);
    for(let i=0;i<=10;i+=0.5) labels.push(i.toFixed(1));
    watched.forEach(m=>{ const idx=Math.round((m.rating||0)*2); if(idx>=0 && idx<21) counts[idx]++; });
    ratingChartInstance = new Chart(document.getElementById('ratingChart'), {type:'bar', data:{labels, datasets:[{data:counts, backgroundColor:'rgba(196,48,43,0.7)'}]}, options:{plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, grid:{color:'#2d3748'}, ticks:{color:'#fff'}}, x:{ticks:{color:'#fff'}}}} });
    await updateAdvancedStats();
    statsModal.style.display='block';
};

// --- RECOMMENDATIONS ---
async function showRecommendations() {
    const all = await db.movies.toArray();
    const favorites = all.filter(m => !m.isWatchlist && m.rating >= 8);
    const watchlist = all.filter(m => m.isWatchlist);
    if (watchlist.length === 0) {
        document.getElementById('recommendationsSection').style.display = 'none';
        return;
    }
    const scored = watchlist.map(w => {
        let score = 0;
        for (const fav of favorites) {
            if (fav.director === w.director) score += 5;
            if (fav.genres === w.genres) score += 3;
            if (fav.awards && w.awards && fav.awards.some(a => w.awards.includes(a))) score += 2;
            if (Math.abs((fav.rating||0) - (w.rating||0)) < 1) score += 1;
        }
        return { movie: w, score };
    });
    const topRecs = scored.sort((a,b) => b.score - a.score).slice(0, 4).map(s => s.movie);
    const container = document.getElementById('recommendGrid');
    container.innerHTML = '';
    if (topRecs.length) {
        topRecs.forEach(m => {
            const card = createSmallMovieCard(m);
            container.appendChild(card);
        });
        document.getElementById('recommendationsSection').style.display = 'block';
    } else {
        document.getElementById('recommendationsSection').style.display = 'none';
    }
}
function createSmallMovieCard(m) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.style.cursor = 'pointer';
    card.onclick = () => openReview(m.id);
    card.innerHTML = `<div class="poster-container"><img src="${m.poster}" loading="lazy" style="aspect-ratio:2/3; width:100%; object-fit:cover;"></div><div class="card-info"><h3 style="font-size:0.8rem;">${m.title}</h3></div>`;
    return card;
}

// --- SIMILAR MOVIES ---
async function showSimilarMovies(movieId){
    const current = await db.movies.get(movieId);
    const all = await db.movies.filter(m=>!m.isWatchlist && m.id !== movieId).toArray();
    const scored = all.map(m=>{
        let s=0;
        if(m.director === current.director) s+=5;
        if(m.genres === current.genres) s+=3;
        if(m.awards && current.awards && m.awards.some(a=>current.awards.includes(a))) s+=2;
        if(Math.abs((m.rating||0)-(current.rating||0))<1) s+=1;
        return {movie:m, score:s};
    }).sort((a,b)=>b.score-a.score).slice(0,4);
    const grid = document.getElementById('similarGrid');
    grid.innerHTML = '';
    scored.forEach(({movie})=>{
        const card = createSmallMovieCard(movie);
        grid.appendChild(card);
    });
}

// --- TRAILER (direct call) ---
document.getElementById('trailerBtn')?.addEventListener('click', async ()=>{
    const movie = await db.movies.get(currentMovieId);
    if(!movie) return;
    try{
        const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movie.title)}&year=${movie.year}`);
        const data = await res.json();
        if(data.results && data.results.length){
            const tmdbId = data.results[0].id;
            const videoRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}`);
            const videoData = await videoRes.json();
            const trailer = videoData.results.find(v=>v.type==='Trailer' && v.site==='YouTube');
            if(trailer){
                document.getElementById('trailerIframe').src = `https://www.youtube.com/embed/${trailer.key}`;
                document.getElementById('trailerModal').style.display = 'block';
                return;
            }
        }
        alert('Trailer not found on TMDB.');
    } catch(e){ alert('Error fetching trailer'); }
});

// --- OTHER FUNCTIONS ---
async function quickEdit(id){ const m=await db.movies.get(id); const val=prompt(`Rating for ${m.title}:`,m.rating); if(val && !isNaN(parseFloat(val))){ await db.movies.update(id,{rating:parseFloat(val)}); renderGallery(); refreshFilters(); } }
async function moveToArchive(id){ const val=prompt("Final rating:", "7.0"); if(val && !isNaN(parseFloat(val))){ await db.movies.update(id,{isWatchlist:false, rating:parseFloat(val), watchDate:new Date().toISOString().split('T')[0]}); renderGallery(); refreshFilters(); startDynamicSpotlight(); } }
async function openReview(id){
    currentMovieId=id;
    const m=await db.movies.get(id);
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
    const m=await db.movies.get(currentMovieId);
    reviewModal.style.display='none'; modal.style.display='block';
    document.getElementById('modalTitle').innerText='Edit Entry';
    document.getElementById('tmdbTitle').value=m.title;
    document.getElementById('tmdbPlot').value=m.plot;
    document.getElementById('tmdbPoster').value=m.poster;
    document.getElementById('rating').value=m.rating||'';
    document.getElementById('watchDate').value=m.watchDate||'';
    document.getElementById('isWatchlist').checked=!!m.isWatchlist;
    document.getElementById('reviewFields').style.display=m.isWatchlist?'none':'block';
    document.querySelectorAll('.seba-award').forEach(cb=>cb.checked=(m.awards||[]).includes(cb.value));
    document.getElementById('previewTitle').innerText=m.title;
    document.getElementById('previewPlot').innerText=m.plot.substring(0,150)+'...';
    document.getElementById('previewPoster').src=m.poster;
    document.getElementById('moviePreview').style.display='flex';
    currentSelectedMovieExtras={year:m.year, director:m.director, genres:m.genres, backdrop:m.backdrop, runtime:m.runtime};
};
document.getElementById('deleteBtn').onclick = async()=>{ if(confirm("Delete forever?")){ await db.movies.delete(currentMovieId); reviewModal.style.display='none'; renderGallery(); refreshFilters(); startDynamicSpotlight(); } };

// --- LETTERBOXD IMPORTER ---
document.getElementById('importCsvBtn').onclick = ()=>document.getElementById('csvFileInput').click();
document.getElementById('csvFileInput').onchange = (e)=>{
    const file = e.target.files[0];
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: async (results) => {
            const data = results.data;
            const hasWatchedData = data[0].hasOwnProperty('Watched Date') || data[0].hasOwnProperty('Rating');
            document.getElementById('importProgress').style.display = 'block';
            for (let i = 0; i < data.length; i++) {
                const row = data[i]; if (!row.Name) continue;
                document.getElementById('importStatus').innerText = `Syncing: ${row.Name}`;
                document.getElementById('importProgressBar').style.width = `${((i+1)/data.length)*100}%`;
                try {
                    const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(row.Name)}&year=${row.Year}`);
                    const sData = await res.json();
                    if (sData.results?.length > 0) {
                        const tmdb = sData.results[0];
                        const detRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdb.id}?api_key=${TMDB_API_KEY}`);
                        const det = await detRes.json();
                        const credRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdb.id}/credits?api_key=${TMDB_API_KEY}`);
                        const cred = await credRes.json();
                        await db.movies.add({
                            title: tmdb.title, year: row.Year || tmdb.release_date?.split('-')[0],
                            poster: `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`,
                            backdrop: `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}`,
                            rating: row.Rating ? parseFloat(row.Rating) * 2 : (hasWatchedData ? 0 : null),
                            watchDate: row['Watched Date'] || row['Date'] || null,
                            isWatchlist: !hasWatchedData,
                            director: cred.crew.find(p => p.job === 'Director')?.name || 'Unknown',
                            genres: det.genres.map(g => g.name).join(', '),
                            runtime: det.runtime ? `${det.runtime} min` : 'N/A',
                            plot: tmdb.overview, awards: []
                        });
                    }
                } catch(err) { console.error(err); }
                await new Promise(r => setTimeout(r, 250));
            }
            alert("Import Complete!"); renderGallery(); refreshFilters(); startDynamicSpotlight();
        }
    });
};

function closeForm(){ modal.style.display='none'; document.getElementById('movieForm').reset(); document.getElementById('moviePreview').style.display='none'; currentMovieId=null; currentSelectedMovieExtras={}; }
document.getElementById('addBtn').onclick = ()=>{ closeForm(); modal.style.display='block'; document.getElementById('modalTitle').innerText='Add to Archive'; document.getElementById('reviewFields').style.display='block'; };
document.querySelector('.close-modal').onclick = closeForm;
document.querySelector('.close-review').onclick = ()=>reviewModal.style.display='none';
document.querySelector('.close-stats').onclick = ()=>statsModal.style.display='none';
document.querySelector('.close-trailer').onclick = ()=>document.getElementById('trailerModal').style.display='none';
document.getElementById('viewMode').onchange = () => { renderGallery(); startDynamicSpotlight(); };
document.getElementById('sortOrder').onchange = renderGallery;
document.getElementById('filterRating').onchange = renderGallery;
document.getElementById('filterYear').onchange = renderGallery;
document.getElementById('filterDirector').oninput = renderGallery;
document.getElementById('filterGenre').onchange = renderGallery;
document.getElementById('filterAward').onchange = renderGallery;
document.getElementById('filterHasReview').onchange = renderGallery;
document.getElementById('mainSearch').oninput = renderGallery;
document.getElementById('resetFiltersBtn').onclick = ()=>{
    document.getElementById('mainSearch').value=''; document.getElementById('filterDirector').value=''; document.getElementById('filterYear').value=''; document.getElementById('filterGenre').value=''; 
    document.getElementById('filterRating').value=''; document.getElementById('filterAward').value=''; document.getElementById('filterHasReview').checked=false; 
    document.getElementById('sortOrder').value='newest_added';
    document.querySelectorAll('.decade-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('.decade-btn[data-decade=""]').classList.add('active');
    renderGallery();
};
// Avvio
initInfiniteScroll();
renderGallery();
startDynamicSpotlight();
setTimeout(showRecommendations, 800);