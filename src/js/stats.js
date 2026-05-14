import { getMedian, getStdDev, getRuntimeMinutes, ensureChartJs, ensureLeaflet, escapeHtml, escapeAttr, renderEloSkeleton, renderVaultStatsSkeleton } from './utils.js';
import { fetchDirectorImage, fetchActorImage, getMovieDetails } from './tmdb.js';
import { getEloRanking } from './elo.js';
import { registerPopStateInterceptor } from './modal-manager.js';

export let fetchAllMovies = null;
let saveMovieProductionCountries = null;
let vaultMap = null;
let vaultMapLayer = null;
let vaultGeoJson = null;
let countryFilmMapping = {};
let countryAvgRating = {};
let vaultWatchedCount = 0;
let vaultMaxCountryCount = 1;
let vaultMapDiagnostics = { totalWatched: 0, withCountries: 0, fetched: 0, fetchedOk: 0, fetchFailed: 0, noTmdbId: 0 };

export function setStatsDependencies(deps) {
    ({ fetchAllMovies, saveMovieProductionCountries } = deps);
}

let genreChartInstance = null;
let ratingChartInstance = null;

/**
 * Distrugge le istanze Chart.js attive per liberare memoria.
 * Da chiamare quando il modal delle statistiche viene chiuso.
 */
export function cleanupStats() {
    if (ratingChartInstance) {
        ratingChartInstance.destroy();
        ratingChartInstance = null;
    }
    if (genreChartInstance) {
        genreChartInstance.destroy();
        genreChartInstance = null;
    }
}

// Lo skeleton viene mostrato *sopra* il markup originale (children nascosti con
// display:none) invece di sostituire innerHTML. Riassegnare innerHTML ricrea i
// nodi figli e fa perdere i listener registrati da ui.js a module-load (es. i
// bottoni openDirectorsRankingBtn / openActorsRankingBtn / openGenreChartBtn /
// openEloRankingBtn / openVaultMapBtn).
let _skeletonNode = null;
const _hiddenChildren = [];

export function showVaultSkeleton() {
    const container = document.getElementById('vaultStatsContent');
    if (!container) return;
    if (_skeletonNode && container.contains(_skeletonNode)) return;   // già skeleton attivo

    _hiddenChildren.length = 0;
    Array.from(container.children).forEach(child => {
        _hiddenChildren.push({ el: child, prevDisplay: child.style.display });
        child.style.display = 'none';
    });

    const tmp = document.createElement('div');
    renderVaultStatsSkeleton(tmp);
    _skeletonNode = tmp.firstElementChild;
    if (_skeletonNode) container.appendChild(_skeletonNode);
}

function restoreVaultMarkup() {
    const container = document.getElementById('vaultStatsContent');
    if (!container) return;

    if (_skeletonNode && _skeletonNode.parentNode === container) {
        container.removeChild(_skeletonNode);
    }
    _skeletonNode = null;

    _hiddenChildren.forEach(({ el, prevDisplay }) => {
        el.style.display = prevDisplay || '';
    });
    _hiddenChildren.length = 0;
}

export async function updateAdvancedStats() {
    restoreVaultMarkup();
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
        ? topDirs.map(d => `<div class="stat-badge">${escapeHtml(d.name)} · ⭐ ${d.avg.toFixed(1)} (${d.count} film)</div>`).join('')
        : '<p style="color: var(--text-muted); margin: 0;">Serve almeno 5 film votati per regista.</p>';

    const dirTime = Array.from(dirMap.entries()).sort((a, b) => b[1].time - a[1].time).slice(0, 5);
    document.getElementById('directorTimeList').innerHTML = dirTime.map(([n, d]) => `<div class="stat-badge">${escapeHtml(n)} · ${Math.round(d.time / 60)}h</div>`).join('');

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
        ? topGenres.map(g => `<div class="stat-badge">${escapeHtml(g.name)} · ⭐ ${g.avg.toFixed(1)} (${g.count} film)</div>`).join('')
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
        ? topActors.map(a => `<div class="stat-badge">${escapeHtml(a.name)} · ⭐ ${a.avg.toFixed(1)} (${a.count} film)</div>`).join('')
        : '<p style="color: var(--text-muted); margin: 0;">Guarda e valuta almeno 3 film per attore per vederli qui.</p>';

    updateGoldenDecade(watched);
    updateRecurringCompanions(watched);

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
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const median = getMedian(ratings);
    const meanIdx = Math.round(mean * 2);
    const medianIdx = Math.round(median * 2);
    const ctx = document.getElementById('ratingChart');
    if (ctx) {
        await ensureChartJs();
        const barColors = counts.map((_, i) => {
            if (i === meanIdx) return 'rgba(212, 175, 55, 0.95)';
            if (i === medianIdx) return 'rgba(180, 106, 74, 0.85)';
            return 'rgba(255, 255, 255, 0.18)';
        });
        const barBorders = counts.map((_, i) => {
            if (i === meanIdx) return '#d4af37';
            if (i === medianIdx) return '#b46a4a';
            return 'rgba(255,255,255,0.22)';
        });
        ratingChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: counts,
                    backgroundColor: barColors,
                    borderColor: barBorders,
                    borderWidth: 1,
                    borderRadius: 3
                }]
            },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: (item) => {
                                if (item.dataIndex === meanIdx) return `↑ Media: ${mean.toFixed(2)}`;
                                if (item.dataIndex === medianIdx) return `↑ Mediana: ${median.toFixed(1)}`;
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
                    x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', maxRotation: 0 } }
                }
            }
        });
    }
}

function updateGoldenDecade(watched) {
    const card = document.getElementById('vaultGoldenDecadeCard');
    if (!card) return;

    const decadeMap = new Map();
    watched.forEach(m => {
        const year = parseInt(m.year, 10);
        if (!Number.isFinite(year) || m.rating == null || isNaN(m.rating)) return;
        const decade = Math.floor(year / 10) * 10;
        if (!decadeMap.has(decade)) decadeMap.set(decade, { sum: 0, count: 0 });
        const d = decadeMap.get(decade);
        d.sum += m.rating;
        d.count++;
    });

    const qualified = Array.from(decadeMap.entries())
        .filter(([_, d]) => d.count >= 3)
        .map(([dec, d]) => ({ dec, avg: d.sum / d.count, count: d.count }))
        .sort((a, b) => b.avg - a.avg);

    if (!qualified.length) {
        card.hidden = true;
        return;
    }
    const top = qualified[0];
    card.hidden = false;
    document.getElementById('vaultDecadeValue').textContent = `Anni ${top.dec}`;
    document.getElementById('vaultDecadeAvg').textContent = `⭐ ${top.avg.toFixed(2)}`;
    document.getElementById('vaultDecadeCount').textContent = `${top.count} film`;
}

function updateRecurringCompanions(watched) {
    const container = document.getElementById('vaultCompanionsList');
    if (!container) return;

    const pairs = new Map();
    watched.forEach(m => {
        if (!m.director || m.director === 'Unknown') return;
        if (!Array.isArray(m.cast)) return;
        m.cast.slice(0, 8).forEach(actor => {
            if (!actor) return;
            const key = `${m.director}|||${actor}`;
            if (!pairs.has(key)) pairs.set(key, { director: m.director, actor, count: 0, sum: 0, rated: 0 });
            const p = pairs.get(key);
            p.count++;
            if (m.rating != null && !isNaN(m.rating)) { p.sum += m.rating; p.rated++; }
        });
    });

    const top = Array.from(pairs.values())
        .filter(p => p.count >= 2)
        .sort((a, b) => (b.count - a.count) || ((b.rated ? b.sum / b.rated : 0) - (a.rated ? a.sum / a.rated : 0)))
        .slice(0, 5);

    if (!top.length) {
        container.innerHTML = '<p style="color: var(--text-muted); margin: 0; font-size: 0.82rem;">Servono almeno 2 film con la stessa coppia regista–attore.</p>';
        return;
    }

    container.innerHTML = top.map(p => {
        const avg = p.rated ? (p.sum / p.rated).toFixed(1) : '—';
        return `
            <div class="vault-companion-row">
                <div class="vault-companion-pair">${escapeHtml(p.director)}<span class="sep">×</span>${escapeHtml(p.actor)}</div>
                <div class="vault-companion-stat">${p.count} film<small>⭐ ${avg}</small></div>
            </div>
        `;
    }).join('');
}

const ISO2_TO_ISO3 = {
    AF:'AFG',AL:'ALB',DZ:'DZA',AS:'ASM',AD:'AND',AO:'AGO',AI:'AIA',AQ:'ATA',AG:'ATG',AR:'ARG',AM:'ARM',AW:'ABW',AU:'AUS',AT:'AUT',AZ:'AZE',
    BS:'BHS',BH:'BHR',BD:'BGD',BB:'BRB',BY:'BLR',BE:'BEL',BZ:'BLZ',BJ:'BEN',BM:'BMU',BT:'BTN',BO:'BOL',BA:'BIH',BW:'BWA',BR:'BRA',IO:'IOT',
    VG:'VGB',BN:'BRN',BG:'BGR',BF:'BFA',BI:'BDI',KH:'KHM',CM:'CMR',CA:'CAN',CV:'CPV',KY:'CYM',CF:'CAF',TD:'TCD',CL:'CHL',CN:'CHN',CX:'CXR',
    CC:'CCK',CO:'COL',KM:'COM',CK:'COK',CR:'CRI',HR:'HRV',CU:'CUB',CW:'CUW',CY:'CYP',CZ:'CZE',CD:'COD',DK:'DNK',DJ:'DJI',DM:'DMA',DO:'DOM',
    EC:'ECU',EG:'EGY',SV:'SLV',GQ:'GNQ',ER:'ERI',EE:'EST',ET:'ETH',FK:'FLK',FO:'FRO',FJ:'FJI',FI:'FIN',FR:'FRA',PF:'PYF',GA:'GAB',GM:'GMB',
    GE:'GEO',DE:'DEU',GH:'GHA',GI:'GIB',GR:'GRC',GL:'GRL',GD:'GRD',GU:'GUM',GT:'GTM',GG:'GGY',GN:'GIN',GW:'GNB',GY:'GUY',HT:'HTI',HN:'HND',
    HK:'HKG',HU:'HUN',IS:'ISL',IN:'IND',ID:'IDN',IR:'IRN',IQ:'IRQ',IE:'IRL',IM:'IMN',IL:'ISR',IT:'ITA',CI:'CIV',JM:'JAM',JP:'JPN',JE:'JEY',
    JO:'JOR',KZ:'KAZ',KE:'KEN',KI:'KIR',XK:'KOS',KW:'KWT',KG:'KGZ',LA:'LAO',LV:'LVA',LB:'LBN',LS:'LSO',LR:'LBR',LY:'LBY',LI:'LIE',LT:'LTU',
    LU:'LUX',MO:'MAC',MK:'MKD',MG:'MDG',MW:'MWI',MY:'MYS',MV:'MDV',ML:'MLI',MT:'MLT',MH:'MHL',MR:'MRT',MU:'MUS',YT:'MYT',MX:'MEX',FM:'FSM',
    MD:'MDA',MC:'MCO',MN:'MNG',ME:'MNE',MS:'MSR',MA:'MAR',MZ:'MOZ',MM:'MMR',NA:'NAM',NR:'NRU',NP:'NPL',NL:'NLD',NC:'NCL',NZ:'NZL',NI:'NIC',
    NE:'NER',NG:'NGA',NU:'NIU',KP:'PRK',MP:'MNP',NO:'NOR',OM:'OMN',PK:'PAK',PW:'PLW',PS:'PSE',PA:'PAN',PG:'PNG',PY:'PRY',PE:'PER',PH:'PHL',
    PN:'PCN',PL:'POL',PT:'PRT',PR:'PRI',QA:'QAT',CG:'COG',RE:'REU',RO:'ROU',RU:'RUS',RW:'RWA',BL:'BLM',SH:'SHN',KN:'KNA',LC:'LCA',MF:'MAF',
    PM:'SPM',VC:'VCT',WS:'WSM',SM:'SMR',ST:'STP',SA:'SAU',SN:'SEN',RS:'SRB',SC:'SYC',SL:'SLE',SG:'SGP',SX:'SXM',SK:'SVK',SI:'SVN',SB:'SLB',
    SO:'SOM',ZA:'ZAF',KR:'KOR',SS:'SSD',ES:'ESP',LK:'LKA',SD:'SDN',SR:'SUR',SJ:'SJM',SZ:'SWZ',SE:'SWE',CH:'CHE',SY:'SYR',TW:'TWN',TJ:'TJK',
    TZ:'TZA',TH:'THA',TL:'TLS',TG:'TGO',TK:'TKL',TO:'TON',TT:'TTO',TN:'TUN',TR:'TUR',TM:'TKM',TC:'TCA',TV:'TUV',VI:'VIR',UG:'UGA',UA:'UKR',
    AE:'ARE',GB:'GBR',US:'USA',UY:'URY',UZ:'UZB',VU:'VUT',VA:'VAT',VE:'VEN',VN:'VNM',WF:'WLF',EH:'ESH',YE:'YEM',ZM:'ZMB',ZW:'ZWE'
};

function normalizeCountryCode(raw) {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    if (code.length === 3) return code;
    if (code.length === 2) return ISO2_TO_ISO3[code] || null;
    return null;
}

function getCountryCodeFromFeature(feature) {
    const props = feature.properties || {};
    const raw = props.iso_a3 || props.ISO_A3 || props.ADM0_A3 || props.iso_a2 || props.ISO_A2
        || props.iso2 || props.iso || props.ISO || props.id || feature.id;
    return normalizeCountryCode(raw);
}

function getMovieCountryCode(country) {
    if (!country) return null;
    const raw = country.iso_3166_1 || country.iso || country.code || country.ISO || country.ISO_A2 || country.ISO_A3;
    return normalizeCountryCode(raw);
}

function getFillColorForCountry(count) {
    if (count >= 5) return '#d4af37';   // gold — top tier
    if (count >= 3) return '#5fb3b3';   // bright teal
    if (count >= 1) return '#3d8a8a';   // map accent
    return '#1a2632';                    // muted slate
}

async function ensureProductionCountriesForMovies(movies, onProgress) {
    const missingMovies = movies.filter(m => (!Array.isArray(m.production_countries) || m.production_countries.length === 0) && m.tmdbId);
    const skippedNoTmdb = movies.filter(m => (!Array.isArray(m.production_countries) || m.production_countries.length === 0) && !m.tmdbId).length;
    const withCountries = movies.length - missingMovies.length - skippedNoTmdb;

    vaultMapDiagnostics = {
        totalWatched: movies.length,
        withCountries,
        fetched: missingMovies.length,
        fetchedOk: 0,
        fetchFailed: 0,
        noTmdbId: skippedNoTmdb
    };

    console.info(`[Vault Map] Films totali: ${movies.length} · con paesi già salvati: ${withCountries} · da fetchare (TMDB): ${missingMovies.length} · senza tmdbId: ${skippedNoTmdb}`);
    if (skippedNoTmdb > 0) {
        console.warn(`[Vault Map] ${skippedNoTmdb} film non hanno tmdbId — non possono essere mappati. Riaprili una volta per associarli a TMDB.`);
    }

    if (!missingMovies.length) {
        onProgress?.(0, 0);
        return;
    }

    const BATCH = 6;
    let done = 0;
    onProgress?.(0, missingMovies.length);

    for (let i = 0; i < missingMovies.length; i += BATCH) {
        const slice = missingMovies.slice(i, i + BATCH);
        await Promise.all(slice.map(async (movie) => {
            try {
                const details = await getMovieDetails(movie.tmdbId);
                const countries = Array.isArray(details.production_countries) ? details.production_countries : [];
                if (countries.length) {
                    movie.production_countries = countries;
                    vaultMapDiagnostics.fetchedOk++;
                    if (saveMovieProductionCountries) {
                        saveMovieProductionCountries(movie.id, countries).catch(() => {});
                    }
                } else {
                    movie.production_countries = [];
                }
            } catch (err) {
                vaultMapDiagnostics.fetchFailed++;
                console.warn('[Vault Map] fetch fallito per', movie.title, err);
            } finally {
                done++;
                onProgress?.(done, missingMovies.length);
            }
        }));
    }

    console.info(`[Vault Map] Fetch completato: ${vaultMapDiagnostics.fetchedOk} ok · ${vaultMapDiagnostics.fetchFailed} falliti`);
}

function buildMappingFromWatched(watched) {
    const mapping = {};
    const ratings = {};
    watched.forEach(m => {
        const countries = Array.isArray(m.production_countries) ? m.production_countries : [];
        countries.forEach(country => {
            const code = getMovieCountryCode(country);
            if (!code) return;
            if (!mapping[code]) mapping[code] = [];
            if (!mapping[code].includes(m.title)) {
                mapping[code].push(m.title);
            }
            if (m.rating != null && !isNaN(m.rating)) {
                if (!ratings[code]) ratings[code] = { sum: 0, count: 0 };
                ratings[code].sum += m.rating;
                ratings[code].count++;
            }
        });
    });
    countryAvgRating = {};
    Object.entries(ratings).forEach(([code, r]) => {
        countryAvgRating[code] = r.count ? r.sum / r.count : null;
    });
    return mapping;
}

async function buildVaultMovieCountryMap(onProgress) {
    const movies = await fetchAllMovies();
    const watched = movies.filter(m => !m.isWatchlist);
    vaultWatchedCount = watched.length;
    await ensureProductionCountriesForMovies(watched, onProgress);
    return buildMappingFromWatched(watched);
}

function updateVaultMapSummary(progress) {
    const summary = document.getElementById('vaultMapSummary');
    if (!summary) return;
    if (progress && progress.total > 0 && progress.done < progress.total) {
        summary.innerHTML = `Caricamento dati TMDB… ${progress.done}/${progress.total}`;
        return;
    }
    const countryCount = Object.keys(countryFilmMapping).length;
    const filmCount = Object.values(countryFilmMapping).reduce((sum, list) => sum + list.length, 0);

    // Diagnostic mode: zero films mapped → expose why
    if (filmCount === 0 && vaultWatchedCount > 0) {
        const d = vaultMapDiagnostics;
        const lines = [];
        if (d.noTmdbId === d.totalWatched && d.totalWatched > 0) {
            lines.push(`⚠️ Tutti i ${d.totalWatched} film sono senza <code>tmdbId</code>. Vai in <strong>Profilo → Repair Metadata</strong> per associarli automaticamente a TMDB.`);
        } else if (d.fetched > 0 && d.fetchedOk === 0) {
            lines.push(`⚠️ ${d.fetched} fetch tentati su TMDB, <strong>tutti falliti</strong>. Controlla la API key TMDB o la connessione.`);
        } else if (d.fetched > 0 && d.fetchedOk > 0 && filmCount === 0) {
            lines.push(`⚠️ ${d.fetchedOk} film recuperati da TMDB ma nessun codice paese valido — possibile bug di normalizzazione codici.`);
        } else if (d.totalWatched === 0) {
            lines.push(`Nessun film visto nella tua collezione (solo watchlist).`);
        } else {
            lines.push(`0 paesi mappati su ${d.totalWatched} film visti.`);
        }
        if (d.noTmdbId > 0 && d.noTmdbId !== d.totalWatched) {
            lines.push(`<small>${d.noTmdbId} film senza tmdbId · ${d.withCountries} con paesi già salvati · ${d.fetchedOk}/${d.fetched} fetch ok</small>`);
        }
        summary.innerHTML = lines.join('<br>');
        return;
    }

    const diversity = vaultWatchedCount > 0 ? ((countryCount / vaultWatchedCount) * 100).toFixed(0) : 0;
    summary.innerText = `${countryCount} paesi · ${filmCount} film · diversità ${diversity}%`;
}

function showVaultMapCountryInfo(feature) {
    const info = document.getElementById('vaultMapCountryInfo');
    if (!info) return;
    const code = getCountryCodeFromFeature(feature);
    const titles = (code && countryFilmMapping[code]) ? countryFilmMapping[code] : [];
    const name = feature.properties?.name || 'Paese';
    const avg = code ? countryAvgRating[code] : null;

    if (titles.length) {
        const avgChip = avg != null
            ? `<span class="vault-map-avg-chip">⭐ ${avg.toFixed(2)}</span>`
            : '';
        info.innerHTML = `
            <div class="vault-map-info-head">
                <h3>${escapeHtml(name)}</h3>
                ${avgChip}
            </div>
            <p style="margin:0 0 10px;">Hai visto ${titles.length} film di questo paese:</p>
            <ul>${titles.map(title => `<li>${escapeHtml(title)}</li>`).join('')}</ul>
        `;
    } else {
        info.innerHTML = `
            <h3>${escapeHtml(name)}</h3>
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

let mapInitialized = false;

export async function openVaultMapView() {
    countryFilmMapping = await buildVaultMovieCountryMap((done, total) => {
        updateVaultMapSummary({ done, total });
    });
    vaultMaxCountryCount = Math.max(1, ...Object.values(countryFilmMapping).map(arr => arr.length));
    updateVaultMapSummary();
    updateVaultMapPodium();

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
    mapInitialized = true;
}

const ISO3_TO_NAME = {
    USA:'Stati Uniti', GBR:'Regno Unito', ITA:'Italia', FRA:'Francia', DEU:'Germania', ESP:'Spagna',
    JPN:'Giappone', KOR:'Corea del Sud', CHN:'Cina', IND:'India', RUS:'Russia', CAN:'Canada',
    AUS:'Australia', NZL:'Nuova Zelanda', BRA:'Brasile', MEX:'Messico', ARG:'Argentina', CHL:'Cile',
    SWE:'Svezia', NOR:'Norvegia', DNK:'Danimarca', FIN:'Finlandia', NLD:'Paesi Bassi', BEL:'Belgio',
    CHE:'Svizzera', AUT:'Austria', POL:'Polonia', CZE:'Cechia', HUN:'Ungheria', GRC:'Grecia',
    PRT:'Portogallo', IRL:'Irlanda', ISL:'Islanda', TUR:'Turchia', IRN:'Iran', ISR:'Israele',
    EGY:'Egitto', ZAF:'Sudafrica', NGA:'Nigeria', KEN:'Kenya', MAR:'Marocco', THA:'Thailandia',
    VNM:'Vietnam', PHL:'Filippine', IDN:'Indonesia', MYS:'Malesia', SGP:'Singapore', TWN:'Taiwan',
    HKG:'Hong Kong', UKR:'Ucraina', ROU:'Romania', SRB:'Serbia', HRV:'Croazia', BGR:'Bulgaria'
};

function getCountryDisplayName(code) {
    return ISO3_TO_NAME[code] || code;
}

function updateVaultMapPodium() {
    const podium = document.getElementById('vaultMapPodium');
    if (!podium) return;

    const ranked = Object.entries(countryFilmMapping)
        .map(([code, films]) => ({ code, count: films.length, avg: countryAvgRating[code] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

    if (!ranked.length) {
        podium.hidden = true;
        return;
    }
    podium.hidden = false;
    podium.innerHTML = ranked.map((c, idx) => {
        const rank = idx + 1;
        const avgStr = c.avg != null ? `⭐ ${c.avg.toFixed(1)}` : '';
        return `
            <div class="vault-podium-card" data-rank="${rank}">
                <span class="vault-podium-rank">${rank}</span>
                <div class="vault-podium-info">
                    <div class="vault-podium-name">${escapeHtml(getCountryDisplayName(c.code))}</div>
                    <div class="vault-podium-meta">${c.count} film${avgStr ? ' · ' + avgStr : ''}</div>
                </div>
            </div>
        `;
    }).join('');
}

export function requestCloseVaultMapView() {
    // Map now lives inside the "Map" tab — closing it means switching back to the
    // Overview tab. Used by the popstate interceptor for browser back button.
    const overviewTab = document.querySelector('.vault-tab[data-tab="overview"]');
    if (overviewTab) activateVaultTab(overviewTab);
}

function vaultMapPopStateHandler() {
    const mapPanel = document.querySelector('.vault-panel[data-panel="map"]');
    if (!mapPanel || !mapPanel.classList.contains('active')) return false;
    requestCloseVaultMapView();
    return true;
}

function moveVaultTabIndicator(activeTab) {
    const indicator = document.querySelector('.vault-tab-indicator');
    if (!indicator || !activeTab) return;
    const tabsContainer = activeTab.parentElement;
    const containerRect = tabsContainer.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${tabRect.left - containerRect.left - 4}px)`;
}

function activateVaultTab(tab) {
    const tabs = document.querySelectorAll('.vault-tab');
    const panels = document.querySelectorAll('.vault-panel');
    const target = tab.dataset.tab;

    const panelsContainer = document.getElementById('vaultStatsContent');
    if (panelsContainer) panelsContainer.dataset.activeSection = target;

    tabs.forEach(t => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    panels.forEach(p => {
        const isActive = p.dataset.panel === target;
        p.classList.toggle('active', isActive);
        if (isActive) {
            p.removeAttribute('hidden');
        } else {
            p.setAttribute('hidden', '');
        }
    });

    requestAnimationFrame(() => moveVaultTabIndicator(tab));

    if (target === 'map') {
        if (!history.state?.vaultMapOpen) {
            history.pushState({ vaultMapOpen: true }, '', window.location.href);
        }
        openVaultMapView().catch(err => console.error('Vault map failed:', err));
    }
}

export function initVaultMap() {
    const tabs = document.querySelectorAll('.vault-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateVaultTab(tab));
    });

    // Position the indicator on first paint and on window resize
    const initIndicator = () => {
        const active = document.querySelector('.vault-tab.active') || tabs[0];
        if (active) moveVaultTabIndicator(active);
        const indicator = document.querySelector('.vault-tab-indicator');
        if (indicator) indicator.classList.add('ready');
    };

    // Reset indicator each time the stats modal opens (tabs may have been hidden)
    const observer = new MutationObserver(() => {
        const modal = document.getElementById('statsModal');
        if (modal?.classList.contains('active')) {
            requestAnimationFrame(initIndicator);
            // Invalidate map size if user re-enters Map tab after open
            if (vaultMap && document.querySelector('.vault-panel[data-panel="map"]')?.classList.contains('active')) {
                vaultMap.invalidateSize();
            }
        }
    });
    const modal = document.getElementById('statsModal');
    if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', () => {
        const active = document.querySelector('.vault-tab.active');
        if (active) moveVaultTabIndicator(active);
    });

    registerPopStateInterceptor(vaultMapPopStateHandler);
    initIndicator();
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
            ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(dir.name)}" class="director-avatar">`
            : `<div class="director-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎬</div>`;

        const postersHTML = dir.allFilms.map(film =>
            `<img src="${escapeAttr(film.poster)}" alt="${escapeAttr(film.title)}" class="director-film-poster" data-movie-id="${escapeAttr(film.id)}" title="${escapeAttr(film.title)} (${escapeAttr(film.rating)})" loading="lazy">`
        ).join('');

        container.insertAdjacentHTML('beforeend', `
      <div class="director-card" data-rank="${rank}">
        <span class="rank-badge" data-rank="${rank}">${rank}</span>
        ${avatarHTML}
        <div class="director-info">
          <p class="director-name">${escapeHtml(dir.name)}</p>
          <p class="director-rating">⭐ ${dir.avg.toFixed(1)} (${dir.count} film)</p>
          <div class="director-posters-grid">${postersHTML}</div>
        </div>
      </div>
    `);
        rank++;
    }

    container.querySelectorAll('.director-film-poster[data-movie-id]').forEach(img => {
        img.addEventListener('click', () => window.openReview(img.dataset.movieId));
    });

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
            ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(actor.name)}" class="actor-avatar">`
            : `<div class="actor-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🎭</div>`;

        const postersHTML = actor.films.map(film =>
            `<img src="${escapeAttr(film.poster)}" alt="${escapeAttr(film.title)}" class="actor-film-poster" data-movie-id="${escapeAttr(film.id)}" title="${escapeAttr(film.title)} (${escapeAttr(film.rating)})" loading="lazy">`
        ).join('');

        container.insertAdjacentHTML('beforeend', `
            <div class="actor-card" data-rank="${rank}">
                <span class="actor-rank-badge" data-rank="${rank}">${rank}</span>
                ${avatarHTML}
                <div class="actor-info">
                    <p class="actor-name">${escapeHtml(actor.name)}</p>
                    <p class="actor-stats">⭐ ${actor.avg.toFixed(1)} (${actor.count} film)</p>
                    <div class="actor-posters-grid">${postersHTML}</div>
                </div>
            </div>
        `);
        rank++;
    }

    container.querySelectorAll('.actor-film-poster[data-movie-id]').forEach(img => {
        img.addEventListener('click', () => window.openReview(img.dataset.movieId));
    });

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
        const minutes = getRuntimeMinutes(m.runtime);
        genres.forEach(g => {
            if (!g) return;
            if (!genreMap.has(g)) genreMap.set(g, { sum: 0, count: 0, mins: 0 });
            const data = genreMap.get(g);
            data.sum += m.rating;
            data.count++;
            data.mins += minutes;
        });
    });

    const allGenres = Array.from(genreMap.entries())
        .map(([name, data]) => ({ name, avg: data.sum / data.count, count: data.count, hours: data.mins / 60 }));

    const genreList = allGenres.filter(g => g.count >= 2).sort((a, b) => b.avg - a.avg);

    const canvas = document.getElementById('genreRatingChart');
    if (genreChartInstance) genreChartInstance.destroy();

    await ensureChartJs();

    const maxHours = Math.max(1, ...genreList.map(g => g.hours));
    const accent = '#7a9b7a';
    const bubbles = genreList.map(g => ({
        x: g.count,
        y: g.avg,
        r: 6 + Math.sqrt(g.hours / maxHours) * 22,
        label: g.name,
        hours: g.hours
    }));

    genreChartInstance = new Chart(canvas, {
        type: 'bubble',
        data: {
            datasets: [{
                data: bubbles,
                backgroundColor: 'rgba(122, 155, 122, 0.35)',
                borderColor: accent,
                borderWidth: 1.5,
                hoverBackgroundColor: 'rgba(122, 155, 122, 0.6)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => items[0]?.raw?.label || '',
                        label: (item) => {
                            const b = item.raw;
                            return [
                                `Media voto: ${b.y.toFixed(2)}`,
                                `Film visti: ${b.x}`,
                                `Ore totali: ${Math.round(b.hours)}h`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Film visti', color: 'rgba(255,255,255,0.5)' },
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(255,255,255,0.6)', precision: 0 }
                },
                y: {
                    title: { display: true, text: 'Media voto', color: 'rgba(255,255,255,0.5)' },
                    min: 0,
                    max: 10,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(255,255,255,0.6)' }
                }
            }
        },
        plugins: [{
            id: 'bubbleLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                const meta = chart.getDatasetMeta(0);
                ctx.save();
                ctx.font = '600 11px Inter, sans-serif';
                ctx.fillStyle = 'rgba(245, 240, 232, 0.85)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                meta.data.forEach((point, i) => {
                    const b = bubbles[i];
                    if (b.r >= 14) ctx.fillText(b.label, point.x, point.y);
                });
                ctx.restore();
            }
        }]
    });

    container.innerHTML = genreList.map(g => `
    <div class="genre-list-item">
      <span class="genre-name">${escapeHtml(g.name)}</span>
      <span class="genre-stats">⭐ ${g.avg.toFixed(1)} · ${g.count} film · ${Math.round(g.hours)}h</span>
    </div>
  `).join('');

    if (genreList.length === 0) {
        container.innerHTML = '<p style="text-align:center;">Aggiungi almeno 2 film per genere per vedere le statistiche.</p>';
    }

    renderUnderrepresentedGenres(allGenres);
}

function renderUnderrepresentedGenres(allGenres) {
    const section = document.getElementById('vaultUnderrepresented');
    const grid = document.getElementById('vaultUnderrepGrid');
    if (!section || !grid) return;

    const under = allGenres
        .filter(g => g.count === 1)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 8);

    if (!under.length) {
        section.hidden = true;
        return;
    }
    section.hidden = false;
    grid.innerHTML = under.map(g => `
        <span class="vault-underrep-chip">${escapeHtml(g.name)}<small>⭐ ${g.avg.toFixed(1)}</small></span>
    `).join('');
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

    renderEloSkeleton(container, 10);

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
                <div class="elo-movie-row ${tier.class} ${isCompact ? 'compact' : 'top-three'}" data-movie-id="${escapeAttr(movie.id)}" data-elo-index="${rank - 1}" data-title="${escapeAttr(normalizedTitle)}" data-tier="${escapeAttr(tier.label)}" role="button" tabindex="0">
                    <span class="elo-rank-badge">${escapeHtml(medal)}</span>
                    <img class="elo-poster" src="${escapeAttr(poster)}" alt="${escapeAttr(movie.title)}" loading="lazy">
                    <div class="elo-row-content">
                        <div class="elo-row-header">
                            <p class="elo-title">${escapeHtml(movie.title)}</p>
                            <span class="elo-score">${escapeHtml(eloText)}</span>
                        </div>
                        <div class="elo-meta-row">
                            <span class="elo-meta-chip elo-meta-rating">⭐ ${escapeHtml(movie.rating)}/10</span>
                            <span class="elo-meta-chip elo-meta-year">${escapeHtml(movie.year || 'N/A')}</span>
                            <span class="elo-tier-badge ${tier.class}">${escapeHtml(tier.label)}</span>
                        </div>
                    </div>
                </div>
            `);
            rank++;
        }

        container.innerHTML = htmlItems.join('');
        renderEloTierDistribution(ranking, totalMovies);
        renderEloTierChips(ranking, totalMovies);
        container.querySelectorAll('.elo-movie-row[data-movie-id]').forEach(row => {
            const openReview = () => window.openReview(row.dataset.movieId);
            row.addEventListener('click', openReview);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openReview();
                }
            });
        });

        const startInput = document.getElementById('eloStartIndex');
        const badgeFilter = document.getElementById('eloBadgeFilter');
        const applyFilterButton = document.getElementById('eloApplyFilter');
        const rows = Array.from(container.querySelectorAll('.elo-movie-row'));

        if (badgeFilter) {
            badgeFilter.innerHTML = getEloBadgeOptions()
                .map(opt => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)
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

function getEloTierDescriptors() {
    return [
        { key: 'GOATS',                cls: 'elo-tier-legendary',    color: '#d4af37' },
        { key: 'Absolute Masterpiece', cls: 'elo-tier-grandmaster',  color: '#c8c8d0' },
        { key: 'The Very Top',         cls: 'elo-tier-master',       color: '#c87a3a' },
        { key: 'Gas',                  cls: 'elo-tier-elite',        color: '#a04449' },
        { key: 'Solid',                cls: 'elo-tier-veteran',      color: '#7a9b7a' },
        { key: 'Alright',              cls: 'elo-tier-pro',          color: '#3d8a8a' },
        { key: 'NCSP',                 cls: 'elo-tier-rookie',       color: '#5a6270' }
    ];
}

function renderEloTierDistribution(ranking, totalMovies) {
    const container = document.getElementById('eloTierDistribution');
    if (!container) return;

    const counts = {};
    ranking.forEach((_, idx) => {
        const tier = getEloTier(idx + 1, totalMovies);
        counts[tier.label] = (counts[tier.label] || 0) + 1;
    });

    const descriptors = getEloTierDescriptors();
    const total = ranking.length || 1;

    container.hidden = false;
    container.innerHTML = `
        <div class="elo-dist-title">Distribuzione tier</div>
        <div class="elo-dist-bar">
            ${descriptors.map(d => {
                const c = counts[d.key] || 0;
                if (!c) return '';
                const pct = (c / total) * 100;
                return `<span class="elo-dist-segment" style="width:${pct.toFixed(2)}%; background:${d.color};" title="${d.key}: ${c} film (${pct.toFixed(0)}%)"></span>`;
            }).join('')}
        </div>
        <div class="elo-dist-legend">
            ${descriptors.map(d => {
                const c = counts[d.key] || 0;
                if (!c) return '';
                return `<span class="elo-dist-legend-item"><span class="elo-dist-dot" style="background:${d.color}"></span>${d.key} · ${c}</span>`;
            }).join('')}
        </div>
    `;
}

function renderEloTierChips(ranking, totalMovies) {
    const container = document.getElementById('eloTierChips');
    const select = document.getElementById('eloBadgeFilter');
    if (!container || !select) return;

    const counts = {};
    ranking.forEach((_, idx) => {
        const tier = getEloTier(idx + 1, totalMovies);
        counts[tier.label] = (counts[tier.label] || 0) + 1;
    });

    const descriptors = getEloTierDescriptors();
    container.hidden = false;
    container.innerHTML = `
        <button type="button" class="elo-tier-chip ${select.value === 'all' ? 'active' : ''}" data-tier-value="all">Tutti<small>${ranking.length}</small></button>
        ${descriptors.map(d => {
            const c = counts[d.key] || 0;
            if (!c) return '';
            const active = select.value === d.key ? 'active' : '';
            return `<button type="button" class="elo-tier-chip ${active}" data-tier-value="${escapeAttr(d.key)}" style="--chip-accent:${d.color}">${escapeHtml(d.key)}<small>${c}</small></button>`;
        }).join('')}
    `;

    container.querySelectorAll('.elo-tier-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            select.value = btn.dataset.tierValue;
            container.querySelectorAll('.elo-tier-chip').forEach(b => b.classList.toggle('active', b === btn));
            select.dispatchEvent(new Event('change'));
        });
    });
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
