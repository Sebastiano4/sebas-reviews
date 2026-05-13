import { getMedian, getStdDev, getRuntimeMinutes, ensureChartJs, ensureLeaflet } from './utils.js';
import { fetchDirectorImage, fetchActorImage, getMovieDetails } from './tmdb.js';
import { getEloRanking } from './elo.js';
import { registerPopStateInterceptor } from './modal-manager.js';

export let fetchAllMovies = null;
let saveMovieProductionCountries = null;
let vaultMap = null;
let vaultMapLayer = null;
let vaultGeoJson = null;
let countryFilmMapping = {};
let vaultMaxCountryCount = 1;

export function setStatsDependencies(deps) {
    ({ fetchAllMovies, saveMovieProductionCountries } = deps);
}

let genreChartInstance = null;
let ratingChartInstance = null;

export async function updateAdvancedStats() {
    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist);
    if (!watched.length) return;
    const ratings = watched.map(m => m.rating || 0);
    const mins = watched.reduce((sum, m) => sum + getRuntimeMinutes(m.runtime), 0);

    document.getElementById('statTotalMovies').innerText = watched.length;
    document.getElementById('statTotalHours').innerText = Math.round(mins / 60) + 'h';
    document.getElementById('statReviewsCount').innerText = watched.filter(m => m.fileData).length;
    document.getElementById('statAvgRating').innerText = (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(2);
    document.getElementById('statMedian').innerText = getMedian(ratings).toFixed(1);
    document.getElementById('statStdDev').innerText = getStdDev(ratings).toFixed(2);

    const dirMap = new Map();
    watched.forEach(m => {
        if (m.director && m.director !== 'Unknown') {
            if (!dirMap.has(m.director)) dirMap.set(m.director, { count: 0, time: 0, sumRating: 0, ratedCount: 0 });
            const d = dirMap.get(m.director);
            d.count++;
            d.time += getRuntimeMinutes(m.runtime);
            if (m.rating != null && !isNaN(m.rating)) {
                d.sumRating += m.rating;
                d.ratedCount++;
            }
        }
    });

    const topDirs = Array.from(dirMap.entries())
        .filter(([_, d]) => d.ratedCount >= 5)
        .map(([name, d]) => ({ name, avg: d.sumRating / d.ratedCount, count: d.ratedCount }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 5);

    document.getElementById('topDirectorsList').innerHTML = topDirs.length
        ? topDirs.map(d => `<div class="stat-badge">${d.name} · ⭐ ${d.avg.toFixed(1)} (${d.count} film)</div>`).join('')
        : '<p style="color: var(--text-muted); margin: 0;">Serve almeno 5 film votati per regista.</p>';

    const dirTime = Array.from(dirMap.entries()).sort((a, b) => b[1].time - a[1].time).slice(0, 5);
    document.getElementById('directorTimeList').innerHTML = dirTime.map(([n, d]) => `<div class="stat-badge">${n} · ${Math.round(d.time / 60)}h</div>`).join('');

    const genreStats = new Map();
    watched.forEach(m => {
        if (m.genres) {
            m.genres.split(', ').forEach(g => {
                if (!genreStats.has(g)) genreStats.set(g, { sum: 0, count: 0 });
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

    const actorMap = new Map();
    watched.forEach(m => {
        if (m.cast && Array.isArray(m.cast)) {
            m.cast.forEach(actor => {
                if (!actorMap.has(actor)) {
                    actorMap.set(actor, { count: 0, sumRating: 0, ratedCount: 0 });
                }
                const a = actorMap.get(actor);
                a.count++;
                if (m.rating != null && !isNaN(m.rating)) {
                    a.sumRating += m.rating;
                    a.ratedCount++;
                }
            });
        }
    });

    const topActors = Array.from(actorMap.entries())
        .filter(([_, data]) => data.count >= 3)
        .map(([name, data]) => ({
            name,
            avg: data.ratedCount > 0 ? data.sumRating / data.ratedCount : 0,
            count: data.count
        }))
        .sort((a, b) => (b.count - a.count) || (b.avg - a.avg))
        .slice(0, 5);

    document.getElementById('topActorsList').innerHTML = topActors.length
        ? topActors.map(a => `<div class="stat-badge">${a.name} · ⭐ ${a.avg.toFixed(1)} (${a.count} film)</div>`).join('')
        : '<p style="color: var(--text-muted); margin: 0;">Guarda e valuta almeno 3 film per attore per vederli qui.</p>';

    if (ratingChartInstance) {
        ratingChartInstance.destroy();
    }
    const labels = [];
    const counts = new Array(21).fill(0);
    for (let i = 0; i <= 10; i += 0.5) labels.push(i.toFixed(1));
    watched.forEach(m => {
        const idx = Math.round((m.rating || 0) * 2);
        if (idx >= 0 && idx < 21) counts[idx]++;
    });
    const ctx = document.getElementById('ratingChart');
    if (ctx) {
        await ensureChartJs();
        ratingChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: counts,
                    backgroundColor: 'rgba(196,48,43,0.7)'
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#2d3748' }, ticks: { color: '#fff' } },
                    x: { ticks: { color: '#fff' } }
                }
            }
        });
    }
}

function getCountryCodeFromFeature(feature) {
    const props = feature.properties || {};
    const code = props.iso_a2 || props.ISO_A2 || props.iso2 || props.iso || props.ISO || props.ADM0_A3 || props.ISO_A3 || props.id;
    return typeof code === 'string' ? code.toUpperCase() : null;
}

function getMovieCountryCode(country) {
    if (!country) return null;
    const code = country.iso_3166_1 || country.iso || country.code || country.ISO || country.ISO_A2;
    return typeof code === 'string' ? code.toUpperCase() : null;
}

function getFillColorForCountry(count) {
    if (count >= 5) return '#fde047';
    if (count >= 3) return '#60a5fa';
    if (count >= 1) return '#3b82f6';
    return '#334155';
}

async function ensureProductionCountriesForMovies(movies) {
    if (!saveMovieProductionCountries) return;
    const missingMovies = movies.filter(m => (!Array.isArray(m.production_countries) || m.production_countries.length === 0) && m.tmdbId);
    if (!missingMovies.length) return;

    for (const movie of missingMovies) {
        try {
            const details = await getMovieDetails(movie.tmdbId);
            const countries = Array.isArray(details.production_countries) ? details.production_countries : [];
            if (countries.length) {
                movie.production_countries = countries;
                await saveMovieProductionCountries(movie.id, countries);
            }
        } catch (err) {
            console.warn('Unable to fetch production countries for', movie.title, err);
        }
    }
}

async function buildVaultMovieCountryMap() {
    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist);
    await ensureProductionCountriesForMovies(watched);

    const mapping = {};
    watched.forEach(m => {
        const countries = Array.isArray(m.production_countries) ? m.production_countries : [];
        countries.forEach(country => {
            const code = getMovieCountryCode(country);
            if (!code) return;
            if (!mapping[code]) mapping[code] = [];
            if (!mapping[code].includes(m.title)) {
                mapping[code].push(m.title);
            }
        });
    });

    return mapping;
}

function updateVaultMapSummary() {
    const summary = document.getElementById('vaultMapSummary');
    if (!summary) return;
    const countryCount = Object.keys(countryFilmMapping).length;
    const filmCount = Object.values(countryFilmMapping).reduce((sum, list) => sum + list.length, 0);
    summary.innerText = `${countryCount} paesi mappati · ${filmCount} film visti`;
}

function showVaultMapCountryInfo(feature) {
    const info = document.getElementById('vaultMapCountryInfo');
    if (!info) return;
    const code = getCountryCodeFromFeature(feature);
    const titles = (code && countryFilmMapping[code]) ? countryFilmMapping[code] : [];
    const name = feature.properties?.name || 'Paese';

    if (titles.length) {
        info.innerHTML = `
            <h3>${name}</h3>
            <p style="margin:0 0 10px;">Hai visto ${titles.length} film di questo paese:</p>
            <ul>${titles.map(title => `<li>${title}</li>`).join('')}</ul>
        `;
    } else {
        info.innerHTML = `
            <h3>${name}</h3>
            <p style="color: var(--text-muted); margin:0;">Nessun film ancora dalla tua Vault. Continua a esplorare!</p>
        `;
    }
}

function getVaultFeatureStyle(feature) {
    const code = getCountryCodeFromFeature(feature);
    const count = (code && countryFilmMapping[code]) ? countryFilmMapping[code].length : 0;
    return {
        fillColor: getFillColorForCountry(count),
        fillOpacity: count > 0 ? 0.85 : 0.2,
        color: '#0f172a',
        weight: 1,
        dashArray: '2'
    };
}

function onEachVaultFeature(feature, layer) {
    layer.on({
        click: () => showVaultMapCountryInfo(feature)
    });
    const name = feature.properties?.name || 'Paese';
    layer.bindTooltip(name, { direction: 'auto', sticky: true });
}

async function loadVaultGeoJson() {
    if (vaultGeoJson) return vaultGeoJson;
    const response = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
    vaultGeoJson = await response.json();
    return vaultGeoJson;
}

async function buildVaultMapLayer() {
    const geoJsonData = await loadVaultGeoJson();
    if (vaultMapLayer) {
        vaultMap.removeLayer(vaultMapLayer);
    }
    vaultMapLayer = L.geoJSON(geoJsonData, {
        style: getVaultFeatureStyle,
        onEachFeature: onEachVaultFeature
    }).addTo(vaultMap);
    vaultMap.fitBounds(vaultMapLayer.getBounds(), { padding: [20, 20] });
}

function isVaultMapVisible() {
    const mapView = document.getElementById('vaultMapView');
    return mapView && mapView.style.display !== 'none';
}

function closeVaultMapViewNow() {
    const mapView = document.getElementById('vaultMapView');
    const statsContent = document.getElementById('vaultStatsContent');
    if (!mapView || mapView.style.display === 'none') return;
    mapView.style.display = 'none';
    if (statsContent) statsContent.style.display = 'block';
}

export async function openVaultMapView() {
    const statsContent = document.getElementById('vaultStatsContent');
    const mapView = document.getElementById('vaultMapView');
    if (!mapView || !statsContent) return;

    statsContent.style.display = 'none';
    mapView.style.display = 'flex';
    countryFilmMapping = await buildVaultMovieCountryMap();
    vaultMaxCountryCount = Math.max(1, ...Object.values(countryFilmMapping).map(arr => arr.length));
    updateVaultMapSummary();

    if (!vaultMap) {
        await ensureLeaflet();
        vaultMap = L.map('vaultMapContainer', {
            worldCopyJump: true,
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([20, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(vaultMap);
    }

    await buildVaultMapLayer();
    vaultMap.invalidateSize();
}

export function requestCloseVaultMapView() {
    if (history.state && history.state.vaultMapOpen) {
        history.back();
    } else {
        closeVaultMapViewNow();
    }
}

function vaultMapPopStateHandler() {
    if (!isVaultMapVisible()) return false;
    closeVaultMapViewNow();
    return true;
}

export function initVaultMap() {
    document.getElementById('openVaultMapBtn')?.addEventListener('click', async () => {
        await openVaultMapView();
        history.pushState({ vaultMapOpen: true }, '', window.location.href);
    });

    document.getElementById('closeVaultMapBtn')?.addEventListener('click', requestCloseVaultMapView);
    registerPopStateInterceptor(vaultMapPopStateHandler);
}

export async function buildDirectorsRanking() {
    const container = document.getElementById('rankingContainer');
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Caricamento classifica...</p>';

    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist && m.rating != null);

    const dirMap = new Map();
    watched.forEach(m => {
        if (!m.director || m.director === 'Unknown') return;
        if (!dirMap.has(m.director)) {
            dirMap.set(m.director, { films: [], sumRating: 0, ratedCount: 0 });
        }
        const d = dirMap.get(m.director);
        d.films.push(m);
        d.sumRating += m.rating;
        d.ratedCount++;
    });

    const directors = Array.from(dirMap.entries())
        .filter(([_, data]) => data.ratedCount >= 3)
        .map(([name, data]) => ({
            name,
            avg: data.sumRating / data.ratedCount,
            count: data.ratedCount,
            allFilms: data.films.sort((a, b) => b.rating - a.rating)
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 25);

    container.innerHTML = '';
    let rank = 1;

    for (const dir of directors) {
        const imageUrl = await fetchDirectorImage(dir.name);
        const avatarHTML = imageUrl
            ? `<img src="${imageUrl}" alt="${dir.name}" class="director-avatar">`
            : `<div class="director-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎬</div>`;

        const postersHTML = dir.allFilms.map(film =>
            `<img src="${film.poster}" alt="${film.title}" class="director-film-poster" onclick="window.openReview('${film.id}')" title="${film.title} (${film.rating})" loading="lazy">`
        ).join('');

        container.innerHTML += `
      <div class="director-card">
        <span class="rank-badge">${rank}</span>
        ${avatarHTML}
        <div class="director-info">
          <p class="director-name">${dir.name}</p>
          <p class="director-rating">⭐ ${dir.avg.toFixed(1)} (${dir.count} film)</p>
          <div class="director-posters-grid">${postersHTML}</div>
        </div>
      </div>
    `;
        rank++;
    }

    if (directors.length === 0) {
        container.innerHTML = '<p style="text-align:center;">Nessun regista con almeno 3 film visti.</p>';
    }
}

export async function buildActorsRanking() {
    const container = document.getElementById('actorsRankingContainer');
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Caricamento classifica...</p>';

    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist && m.rating != null);

    const actorMap = new Map();
    watched.forEach(m => {
        if (m.cast && Array.isArray(m.cast)) {
            m.cast.forEach(actor => {
                if (!actorMap.has(actor)) {
                    actorMap.set(actor, { films: [], sumRating: 0, ratedCount: 0 });
                }
                const aData = actorMap.get(actor);
                aData.films.push(m);
                if (m.rating != null && !isNaN(m.rating)) {
                    aData.sumRating += m.rating;
                    aData.ratedCount++;
                }
            });
        }
    });

    const topActors = Array.from(actorMap.entries())
        .filter(([_, data]) => data.films.length >= 3)
        .map(([name, data]) => ({
            name,
            count: data.films.length,
            avg: data.ratedCount > 0 ? data.sumRating / data.ratedCount : 0,
            films: data.films.sort((a, b) => b.rating - a.rating).slice(0, 10)
        }))
        .sort((a, b) => (b.count - a.count) || (b.avg - a.avg))
        .slice(0, 25);

    container.innerHTML = '';
    let rank = 1;

    for (const actor of topActors) {
        const imageUrl = await fetchActorImage(actor.name);
        const avatarHTML = imageUrl
            ? `<img src="${imageUrl}" alt="${actor.name}" class="actor-avatar">`
            : `<div class="actor-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎭</div>`;

        const postersHTML = actor.films.map(film =>
            `<img src="${film.poster}" alt="${film.title}" class="actor-film-poster" onclick="window.openReview('${film.id}')" title="${film.title} (${film.rating})" loading="lazy">`
        ).join('');

        container.innerHTML += `
            <div class="actor-card">
                <span class="actor-rank-badge">${rank}</span>
                ${avatarHTML}
                <div class="actor-info">
                    <p class="actor-name">${actor.name}</p>
                    <p class="actor-stats">⭐ ${actor.avg.toFixed(1)} (${actor.count} film)</p>
                    <div class="actor-posters-grid">${postersHTML}</div>
                </div>
            </div>
        `;
        rank++;
    }

    if (topActors.length === 0) {
        container.innerHTML = '<p style="text-align:center;">Nessun attore con almeno 3 film visti.</p>';
    }
}

export async function buildGenreChart() {
    const container = document.getElementById('genreChartList');
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Calcolo statistiche…</p>';

    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist && m.rating != null);

    const genreMap = new Map();
    watched.forEach(m => {
        const genres = (m.genres || '').split(', ');
        genres.forEach(g => {
            if (!g) return;
            if (!genreMap.has(g)) genreMap.set(g, { sum: 0, count: 0 });
            const data = genreMap.get(g);
            data.sum += m.rating;
            data.count++;
        });
    });

    const genreList = Array.from(genreMap.entries())
        .map(([name, data]) => ({ name, avg: data.sum / data.count, count: data.count }))
        .filter(g => g.count >= 2)
        .sort((a, b) => b.avg - a.avg);

    const canvas = document.getElementById('genreRatingChart');
    if (genreChartInstance) genreChartInstance.destroy();

    await ensureChartJs();
    genreChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: genreList.map(g => g.name),
            datasets: [{
                label: 'Media voto',
                data: genreList.map(g => g.avg.toFixed(1)),
                backgroundColor: 'rgba(196,48,43,0.7)',
                borderColor: '#c4302b',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, max: 10, grid: { color: '#2d3748' }, ticks: { color: '#fff' } },
                y: { ticks: { color: '#fff' } }
            }
        }
    });

    container.innerHTML = genreList.map(g => `
    <div class="genre-list-item">
      <span class="genre-name">${g.name}</span>
      <span class="genre-stats">⭐ ${g.avg.toFixed(1)} (${g.count} film)</span>
    </div>
  `).join('');

    if (genreList.length === 0) {
        container.innerHTML = '<p style="text-align:center;">Aggiungi almeno 2 film per genere per vedere le statistiche.</p>';
    }
}

function getEloBadgeOptions() {
    return [
        { value: 'all', label: 'Tutti' },
        { value: 'GOATS', label: 'GOATS' },
        { value: 'Absolute Masterpiece', label: 'Absolute Masterpiece' },
        { value: 'The Very Top', label: 'The Very Top' },
        { value: 'Gas', label: 'Gas' },
        { value: 'Solid', label: 'Solid' },
        { value: 'Alright', label: 'Alright' },
        { value: 'NCSP', label: 'NCSP' }
    ];
}

function getEloTier(rank, totalMovies) {
    if (!Number.isFinite(rank) || !Number.isFinite(totalMovies) || totalMovies <= 0) {
        return { label: 'Rookie', class: 'elo-tier-rookie' };
    }

    const top1 = Math.max(1, Math.ceil(totalMovies * 0.01));
    const top5 = Math.max(1, Math.ceil(totalMovies * 0.05));
    const top15 = Math.max(1, Math.ceil(totalMovies * 0.15));
    const top30 = Math.max(1, Math.ceil(totalMovies * 0.30));
    const top45 = Math.max(1, Math.ceil(totalMovies * 0.45));
    const top60 = Math.max(1, Math.ceil(totalMovies * 0.60));

    if (rank <= top1) {
        return { label: 'GOATS', class: 'elo-tier-legendary' };
    }
    if (rank <= top5) {
        return { label: 'Absolute Masterpiece', class: 'elo-tier-grandmaster' };
    }
    if (rank <= top15) {
        return { label: 'The Very Top', class: 'elo-tier-master' };
    }
    if (rank <= top30) {
        return { label: 'Gas', class: 'elo-tier-elite' };
    }
    if (rank <= top45) {
        return { label: 'Solid', class: 'elo-tier-veteran' };
    }
    if (rank <= top60) {
        return { label: 'Alright', class: 'elo-tier-pro' };
    }
    return { label: 'NCSP', class: 'elo-tier-rookie' };
}

export async function buildEloRanking() {
    const container = document.getElementById('eloRankingContainer');
    const searchInput = document.getElementById('eloSearchInput');
    const searchInfo = document.getElementById('eloSearchInfo');

    if (searchInput) {
        searchInput.value = '';
        searchInput.disabled = true;
    }
    if (searchInfo) {
        searchInfo.textContent = '';
    }

    container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Caricamento classifica Elo...</p>';

    try {
        const ranking = await getEloRanking();
        
        if (!ranking || ranking.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Nessun film trovato per la classifica Elo.</p>';
            return;
        }

        const htmlItems = [];
        let rank = 1;
        const totalMovies = ranking.length;

        for (const movie of ranking) {
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}°`;
            const tier = getEloTier(rank, totalMovies);
            const eloText = movie.eloRating ? `Elo: ${movie.eloRating}` : 'Elo: N/A';
            const poster = movie.poster || 'https://via.placeholder.com/70x100?text=No+Image';
            const normalizedTitle = (movie.title || '').toLowerCase();
            const isCompact = rank > 3;

            htmlItems.push(`
                <div class="elo-movie-row ${tier.class} ${isCompact ? 'compact' : 'top-three'}" data-movie-id="${movie.id}" data-elo-index="${rank - 1}" data-title="${normalizedTitle}" data-tier="${tier.label}" onclick="window.openReview('${movie.id}')">
                    <span class="elo-rank-badge">${medal}</span>
                    <img class="elo-poster" src="${poster}" alt="${movie.title}" loading="lazy">
                    <div class="elo-row-content">
                        <div class="elo-row-header">
                            <p class="elo-title">${movie.title}</p>
                            <span class="elo-score">${eloText}</span>
                        </div>
                        <div class="elo-meta-row">
                            <span>⭐ ${movie.rating}/10</span>
                            <span>${movie.year || 'N/A'}</span>
                            <span class="elo-tier-badge ${tier.class}">${tier.label}</span>
                        </div>
                    </div>
                </div>
            `);
            rank++;
        }

        container.innerHTML = htmlItems.join('');

        const startInput = document.getElementById('eloStartIndex');
        const badgeFilter = document.getElementById('eloBadgeFilter');
        const applyFilterButton = document.getElementById('eloApplyFilter');
        const rows = Array.from(container.querySelectorAll('.elo-movie-row'));

        if (badgeFilter) {
            badgeFilter.innerHTML = getEloBadgeOptions()
                .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
                .join('');
        }

        const applyFilters = () => {
            const query = searchInput?.value.trim().toLowerCase() || '';
            const badgeValue = badgeFilter?.value || 'all';
            const startValue = Number(startInput?.value) || 1;
            const rangeStart = Math.max(1, startValue);
            const rangeEnd = rows.length;

            let firstVisible = null;
            let visibleCount = 0;

            rows.forEach((row, index) => {
                const title = row.dataset.title || '';
                const tier = row.dataset.tier || '';
                const rank = index + 1;
                const matchesQuery = !query || title.includes(query);
                const matchesBadge = badgeValue === 'all' || tier === badgeValue;
                const inRange = rank >= rangeStart && rank <= rangeEnd;
                const isVisible = matchesQuery && matchesBadge && inRange;

                row.style.display = isVisible ? 'flex' : 'none';
                if (isVisible) {
                    visibleCount += 1;
                    if (!firstVisible) firstVisible = row;
                }
            });

            if (searchInfo) {
                const badgeLabel = badgeValue === 'all' ? 'Tutti i badge' : badgeValue;
                searchInfo.textContent = `Mostrati ${visibleCount} film · ${badgeLabel}`;
            }
            if (firstVisible) {
                firstVisible.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        if (searchInput) {
            searchInput.disabled = false;
            searchInput.oninput = applyFilters;
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    applyFilters();
                }
            });
        }

        if (startInput) {
            startInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    applyFilters();
                }
            });
        }

        if (applyFilterButton) {
            applyFilterButton.onclick = applyFilters;
        }

        if (badgeFilter) {
            badgeFilter.onchange = applyFilters;
        }

    } catch (error) {
        console.error('Error building Elo ranking:', error);
        container.innerHTML = '<p style="text-align:center; color:red;">Errore nel caricamento della classifica Elo.</p>';
    }
}

document.addEventListener('eloRankingUpdated', async (event) => {
    const eloModal = document.getElementById('eloRankingModal');
    if (eloModal && eloModal.style.display !== 'none') {
        await buildEloRanking();

        const winnerId = event?.detail?.updatedMovieA?.hasOvertaken ? event.detail.updatedMovieA.id :
            event?.detail?.updatedMovieB?.hasOvertaken ? event.detail.updatedMovieB.id : null;

        if (winnerId) {
            const winnerRow = document.querySelector(`.elo-movie-row[data-movie-id="${winnerId}"]`);
            if (winnerRow) {
                winnerRow.classList.add('leapfrog-highlight');
                setTimeout(() => winnerRow.classList.remove('leapfrog-highlight'), 2200);
            }
        }
    }
});
