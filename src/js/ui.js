/**
 * --- LA GESTIONE DELLA SALA (Interfaccia) ---
 * Questo file decide come appare il sito ai tuoi occhi.
 * Si occupa di:
 * - Cambiare tra tema chiaro e scuro.
 * - Aprire e chiudere le finestre (i modali) quando clicchi su un film.
 * - Gestire i menu in basso e il tuo profilo.
 * In pratica, è quello che gestisce i "bottoni" e il look dell'app.
 */

import { updateAdvancedStats, buildDirectorsRanking, buildActorsRanking, buildGenreChart, buildEloRanking, cleanupStats, showVaultSkeleton } from './stats.js';
import { renderProfileSkeleton, showToast } from './utils.js';
import { auth, db, storage } from './firebase.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { openModal, closeModal } from './modal-manager.js';

// --- UI MODULE: Modal Management and Theme Logic ---

// Global variables for UI state
let profileState = 'main';   // 'main', 'confirm-action'

// --- THEME MANAGEMENT ---
export function initTheme() {
    const toggleBtn = document.getElementById('themeToggle');
    if (!toggleBtn) return;

    const savedTheme = localStorage.getItem('sebas-theme');

    // Default: tema scuro (nessuna classe). Se salvato 'light', attiva il chiaro.
    if (savedTheme === 'light') {
        document.body.classList.add('theme-light');
        toggleBtn.textContent = '☀️';   // sole = modalità chiara attiva
    } else {
        document.body.classList.remove('theme-light');
        toggleBtn.textContent = '🌙';   // luna = modalità scura attiva
    }

    toggleBtn.addEventListener('click', () => {
        if (document.body.classList.contains('theme-light')) {
            // Passa a scuro
            document.body.classList.remove('theme-light');
            localStorage.setItem('sebas-theme', 'dark');
            toggleBtn.textContent = '🌙';
        } else {
            // Passa a chiaro
            document.body.classList.add('theme-light');
            localStorage.setItem('sebas-theme', 'light');
            toggleBtn.textContent = '☀️';
        }
    });
}

// --- BOTTOM NAVIGATION ---
export function initBottomNav() {
    const nav = document.querySelector('.bottom-nav');
    const indicator = nav?.querySelector('.bottom-nav-indicator');
    const items = document.querySelectorAll('.bottom-nav-item[data-view]');
    const viewSelect = document.getElementById('viewMode');

    function positionIndicator() {
        if (!nav || !indicator) return;
        const active = nav.querySelector('.bottom-nav-item.active');
        if (!active) {
            indicator.classList.remove('ready');
            return;
        }
        const navRect = nav.getBoundingClientRect();
        const itemRect = active.getBoundingClientRect();
        const left = itemRect.left - navRect.left;
        indicator.style.width = `${itemRect.width}px`;
        indicator.style.transform = `translateX(${left}px)`;
        indicator.classList.add('ready');
    }

    items.forEach(item => {
        item.addEventListener('click', () => {
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            positionIndicator();

            const view = item.getAttribute('data-view');
            if (view === 'stats') {
                showVaultSkeleton();
                openModal('statsModal');
                updateAdvancedStats();
            } else {
                viewSelect.value = view;
                viewSelect.onchange();
            }
        });
    });

    document.getElementById('bottomAddBtn')?.addEventListener('click', () => {
        closeForm();
        openModal('modal');
    });

    // Initial placement + keep in sync on resize/orientation.
    requestAnimationFrame(positionIndicator);
    window.addEventListener('resize', positionIndicator);
    window.addEventListener('orientationchange', positionIndicator);

    // Re-sync when view changes from the desktop select.
    viewSelect?.addEventListener('change', () => {
        const v = viewSelect.value;
        const target = nav?.querySelector(`.bottom-nav-item[data-view="${v}"]`);
        if (target) {
            items.forEach(i => i.classList.remove('active'));
            target.classList.add('active');
            positionIndicator();
        }
    });
}

// --- SECONDARY FILTERS TOGGLE ---
export function initFiltersToggle() {
    const toggle = document.getElementById('toggleSecondaryFilters');
    const panel = document.getElementById('normalFilters');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        panel.dataset.collapsed = expanded ? 'true' : 'false';
    });
}

// --- MODAL DOM ELEMENTS ---
const modal = document.getElementById('modal'),
      reviewModal = document.getElementById('reviewModal'),
      statsModal = document.getElementById('statsModal');

// --- ADD/EDIT MODAL LOGIC ---
export function closeForm(){
    closeModal('modal');
    document.getElementById('movieForm').reset();
    document.getElementById('moviePreview').style.display='none';
    setCurrentMovieId(null);
    setCurrentSelectedMovieExtras({});
}

// --- REVIEW MODAL LOGIC ---
export const closeReviewModal = () => {
    closeModal('reviewModal');
};

// --- PROFILE MODAL LOGIC ---
export function openProfileModal() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    // Mostra skeleton subito, apri il modal, poi monta la vista reale al prossimo tick
    // così l'utente vede una struttura coerente invece di un flash bianco.
    const container = document.getElementById('profileDynamicContent');
    if (container) renderProfileSkeleton(container);
    openModal('profileModal');
    requestAnimationFrame(() => showProfileMainView());
}

function getCacheBustedUrl(url) {
    return `${url}#cb=${Date.now()}`;
}

function setProfileButtonAvatar(profilePic) {
    const profileBtn = document.getElementById('profileBtn');
    if (!profileBtn) return;
    if (profilePic) {
        profileBtn.innerHTML = `<img src="${getCacheBustedUrl(profilePic)}" alt="Avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover;display:block;">`;
        profileBtn.style.padding = '0.25rem';
    } else {
        profileBtn.innerText = '👤';
        profileBtn.style.padding = '0.5rem 1rem';
    }
}

const PROFILE_ICONS = {
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    importExport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    cache: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.121 2.121 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

export function showProfileMainView() {
    profileState = 'main';
    const container = document.getElementById('profileDynamicContent');
    container.innerHTML = `
        <div id="profileMainView">
            <div class="profile-banner">
                <label class="profile-avatar-wrap" for="profilePicInput" title="Change avatar">
                    <img id="profilePicPreview" class="profile-avatar" src="" alt="Avatar">
                    <span class="profile-avatar-edit" aria-hidden="true">${PROFILE_ICONS.pencil}</span>
                </label>
                <input type="file" id="profilePicInput" accept="image/*" style="display:none;">
                <div class="profile-identity">
                    <h3 class="profile-nickname">
                        <span id="profileNickname"></span>
                        <button class="profile-nickname-edit" id="editNicknameBtn" title="Edit nickname" aria-label="Edit nickname">${PROFILE_ICONS.pencil}</button>
                    </h3>
                    <p class="profile-email" id="profileEmail"></p>
                </div>
            </div>

            <div class="profile-group">
                <p class="profile-group-label">Preferences</p>
                <button class="profile-row" id="themeToggleProfile">
                    <span class="profile-row-icon">${PROFILE_ICONS.theme}</span>
                    <span class="profile-row-label">Theme</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
                <button class="profile-row" id="openImportExportBtn">
                    <span class="profile-row-icon">${PROFILE_ICONS.importExport}</span>
                    <span class="profile-row-label">Import / Export</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
                <button class="profile-row" id="repairFromProfileBtn">
                    <span class="profile-row-icon">${PROFILE_ICONS.wrench}</span>
                    <span class="profile-row-label">Repair Metadata</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
                <button class="profile-row" id="clearCacheBtn">
                    <span class="profile-row-icon">${PROFILE_ICONS.cache}</span>
                    <span class="profile-row-label">Clear Cache</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
            </div>

            <div class="profile-group">
                <p class="profile-group-label">Account</p>
                <button class="profile-row" id="logoutFromProfileBtn">
                    <span class="profile-row-icon">${PROFILE_ICONS.logout}</span>
                    <span class="profile-row-label">Logout</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
                <button class="profile-row danger" id="deleteArchiveBtn">
                    <span class="profile-row-icon">${PROFILE_ICONS.alert}</span>
                    <span class="profile-row-label">Delete Entire Archive</span>
                    <span class="profile-row-chevron">${PROFILE_ICONS.chevron}</span>
                </button>
            </div>

            <p class="profile-footer">Seba's Reviews v2.0 · Firebase · TMDB · OMDb</p>
        </div>
    `;

    attachProfileListeners();

    const currentUser = getCurrentUser();
    const savedNick = localStorage.getItem('sebas-nickname');
    document.getElementById('profileNickname').innerText = savedNick || currentUser?.displayName || 'User';
    document.getElementById('profileEmail').innerText = currentUser?.email || '';

    const profilePic = localStorage.getItem('sebas-profile-pic') || currentUser?.photoURL || 'https://via.placeholder.com/60';
    document.getElementById('profilePicPreview').src = getCacheBustedUrl(profilePic);
    setProfileButtonAvatar(profilePic);
}

export function attachProfileListeners() {
    // Edit Nickname
    document.getElementById('editNicknameBtn')?.addEventListener('click', () => {
        const current = document.getElementById('profileNickname').innerText;
        const input = document.getElementById('nicknameInput');
        if (input) input.value = current;
        openModal('nicknameModal');
    });

    document.getElementById('nicknameCancelBtn')?.addEventListener('click', () => {
        closeModal('nicknameModal');
    });

    document.querySelector('#nicknameModal .close-nickname')?.addEventListener('click', () => {
        closeModal('nicknameModal');
    });

    document.getElementById('nicknameConfirmBtn')?.addEventListener('click', async () => {
        const input = document.getElementById('nicknameInput');
        const trimmedNick = input?.value?.trim();
        if (!trimmedNick) return;

        localStorage.setItem('sebas-nickname', trimmedNick);
        document.getElementById('profileNickname').innerText = trimmedNick;
        closeModal('nicknameModal');
        showToast('Saving nickname...', 2000);

        const currentUser = getCurrentUser();
        if (currentUser) {
            try {
                const userDocRef = doc(db, "users", currentUser.uid);
                await setDoc(userDocRef, { nickname: trimmedNick }, { merge: true });
                showToast('Nickname saved!', 3000);
            } catch (error) {
                console.error('Nickname save failed:', error);
                showToast('Failed to save nickname to Firestore.', 4000);
            }
        }
    });

    document.getElementById('nicknameInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('nicknameConfirmBtn')?.click();
        if (e.key === 'Escape') closeModal('nicknameModal');
    });

    // Caricamento foto profilo con Firebase Storage e salvataggio URL su Firestore
    document.getElementById('profilePicInput')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) {
            showToast('No file selected.', 4000);
            return;
        }
        const currentUser = getCurrentUser();
        if (!currentUser) {
            showToast('You must be logged in to upload a profile picture.', 4000);
            return;
        }

        showToast('⏳ Uploading picture...', 4000);

        const storageRef = ref(storage, `users/${currentUser.uid}/profile-pic`);
        try {
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            // SALVA L'URL IN FIRESTORE (così è accessibile da ogni dispositivo)
            const userDocRef = doc(db, "users", currentUser.uid);
            await setDoc(userDocRef, { profilePic: downloadURL }, { merge: true });

            const previewUrl = getCacheBustedUrl(downloadURL);
            document.getElementById('profilePicPreview').src = previewUrl;
            localStorage.setItem('sebas-profile-pic', downloadURL);
            setProfileButtonAvatar(downloadURL);
            e.target.value = '';

            showToast('Profile picture uploaded successfully!', 4000);
        } catch (error) {
            console.error('Upload failed:', error);
            showToast(`Upload failed: ${error?.message || 'unknown error'}`, 6000);
        }
    });

    // Tema
    document.getElementById('themeToggleProfile')?.addEventListener('click', () => {
        if (document.body.classList.contains('theme-light')) {
            document.body.classList.remove('theme-light');
            localStorage.setItem('sebas-theme', 'dark');
        } else {
            document.body.classList.add('theme-light');
            localStorage.setItem('sebas-theme', 'light');
        }
    });

    // Import / Export
    document.getElementById('openImportExportBtn')?.addEventListener('click', () => {
        closeModal('profileModal', true);
        openModal('importExportModal');
    });

    // Clear cache → pagina di conferma
    document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
        showProfileConfirmPage(
            'Clear Cache',
            'This will clear all locally stored data (cached images, theme settings, profile picture). You will remain logged in. Continue?',
            () => {
                caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
                localStorage.clear();
                showToast('Cache cleared!');
                showProfileMainView();
            }
        );
    });

    // Repair Metadata → pagina di conferma, poi progresso
    document.getElementById('repairFromProfileBtn')?.addEventListener('click', () => {
        showProfileConfirmPage(
            'Repair Metadata',
            'This will update missing director, genres, runtime, and cast for all movies in your archive. It may take a few minutes. Continue?',
            startRepairWithProgress
        );
    });

    // Delete Archive → conferma doppia
    document.getElementById('deleteArchiveBtn')?.addEventListener('click', () => {
        showProfileConfirmPage(
            'Delete Entire Archive',
            'This will permanently delete ALL your movies. This cannot be undone. Are you sure you want to proceed?',
            async () => {
                const currentUser = getCurrentUser();
                if (!currentUser) return;
                // Seconda conferma
                if (!confirm('Are you REALLY sure? All your data will be lost.')) return;
                const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
                await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "users", currentUser.uid, "movies", d.id))));
                window.invalidateMoviesCache?.();
                showToast('Archive deleted.');
                showProfileMainView();
                renderGallery();
            }
        );
    });

    // Logout
    document.getElementById('logoutFromProfileBtn')?.addEventListener('click', () => {
        closeModal('profileModal');
        signOut(auth);
    });
}

// Mostra una pagina di conferma all'interno del profilo
export function showProfileConfirmPage(title, message, onConfirm) {
    profileState = 'confirm';
    const container = document.getElementById('profileDynamicContent');
    container.innerHTML = `
        <div style="text-align:center;">
            <h3 style="font-family:'Cinzel',serif; color:var(--accent); margin-bottom:1rem;">${title}</h3>
            <p style="color:var(--text-muted); margin-bottom:2rem; line-height:1.6;">${message}</p>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button class="btn-primary" style="background:#1e293b;" id="profileCancelBtn">Cancel</button>
                <button class="btn-primary" id="profileConfirmBtn">Confirm</button>
            </div>
        </div>
    `;

    document.getElementById('profileCancelBtn').addEventListener('click', () => {
        showProfileMainView();
    });

    document.getElementById('profileConfirmBtn').addEventListener('click', () => {
        onConfirm();
    });
}

// Avvia il repair con barra di progresso nel profilo
export async function startRepairWithProgress() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    const container = document.getElementById('profileDynamicContent');
    container.innerHTML = `
        <div style="text-align:center;">
            <h3 style="font-family:'Cinzel',serif; color:var(--accent); margin-bottom:1rem;">🛠️ Repairing Metadata</h3>
            <p id="repairStatus" style="color:var(--text-muted); margin-bottom:1rem;">Starting…</p>
            <div style="background:#000; border-radius:8px; overflow:hidden; margin-bottom:1rem;">
                <div id="repairProgressBar" style="width:0%; height:6px; background:var(--accent); transition: width 0.2s;"></div>
            </div>
            <button class="btn-primary" style="background:#1e293b;" id="repairCancelBtn" disabled>Cancel</button>
        </div>
    `;

    const statusEl = document.getElementById('repairStatus');
    const barEl = document.getElementById('repairProgressBar');
    const cancelBtn = document.getElementById('repairCancelBtn');

    const movies = await fetchAllMovies();
    const toRepair = movies.filter(m => !m.director || m.director === 'Unknown' || !m.genres || m.runtime === 'N/A' || !m.cast || m.cast.length === 0);
    const total = toRepair.length;
    let completed = 0;

    if (total === 0) {
        statusEl.innerText = 'All movies already up to date!';
        barEl.style.width = '100%';
        cancelBtn.disabled = false;
        cancelBtn.innerText = 'Back to Profile';
        cancelBtn.addEventListener('click', () => showProfileMainView());
        return;
    }

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
                    director, genres, runtime, year, cast
                });
                window.updateMovieInCache?.(movie.id, { director, genres, runtime, year, cast });
            }
        } catch (err) {
            console.error(`Error repairing ${movie.title}:`, err);
        }
        completed++;
        await new Promise(r => setTimeout(r, 250));
    }
    barEl.style.width = '100%';
    statusEl.innerText = `Repair completed: ${total} movies updated.`;
    cancelBtn.disabled = false;
    cancelBtn.innerText = 'Back to Profile';
    cancelBtn.addEventListener('click', () => showProfileMainView());
    showToast('Metadata repaired!');
    renderGallery();
}

// --- MODAL EVENT LISTENERS ---

// Profile modal
document.getElementById('profileBtn')?.addEventListener('click', openProfileModal);
document.querySelector('.close-profile')?.addEventListener('click', () => {
    closeModal('profileModal');
});
window.addEventListener('click', (event) => {
    const pModal = document.getElementById('profileModal');
    if (event.target === pModal) closeModal('profileModal');
});

// Add/Edit modal
document.querySelector('.close-modal').addEventListener('click', () => closeModal('modal'));
document.getElementById('addBtn').onclick = () => { closeForm(); openModal('modal'); };
window.addEventListener('click', (event) => {
    if (event.target == modal) closeModal('modal');
});

// Review modal
document.querySelector('.close-review').addEventListener('click', () => closeModal('reviewModal'));
window.addEventListener('click', (event) => {
    if (event.target == reviewModal) closeModal('reviewModal');
});

// Stats modal — cleanup delle chart instances alla chiusura
document.querySelector('.close-stats').addEventListener('click', () => {
    cleanupStats();
    closeModal('statsModal');
});
window.addEventListener('click', (event) => {
    if (event.target == statsModal) {
        cleanupStats();
        closeModal('statsModal');
    }
});

// Trailer modal
document.querySelector('.close-trailer').addEventListener('click', () => closeModal('trailerModal'));
window.addEventListener('click', (event) => {
    if (event.target == document.getElementById('trailerModal')) closeModal('trailerModal');
});

// Import/Export modal
document.querySelector('.close-import-export').addEventListener('click', () => {
    closeModal('importExportModal');
});
window.addEventListener('click', (event) => {
    if (event.target == document.getElementById('importExportModal')) closeModal('importExportModal');
});

// Explore movie modal
document.querySelector('.close-explore-movie')?.addEventListener('click', () => {
    closeModal('exploreMovieModal');
});
window.addEventListener('click', (event) => {
    const modalExplore = document.getElementById('exploreMovieModal');
    if (event.target === modalExplore) {
        closeModal('exploreMovieModal');
    }
});

// Directors ranking modal
const openDirectorsRankingBtn = document.getElementById('openDirectorsRankingBtn');
if (openDirectorsRankingBtn) {
    openDirectorsRankingBtn.addEventListener('click', () => {
        openModal('directorsRankingModal');
        buildDirectorsRanking();
    });
}
document.querySelector('.close-ranking')?.addEventListener('click', () => {
    closeModal('directorsRankingModal');
});
window.addEventListener('click', (event) => {
    const rankingModal = document.getElementById('directorsRankingModal');
    if (event.target === rankingModal) {
        closeModal('directorsRankingModal');
    }
});

// Actors ranking modal
const openActorsRankingBtn = document.getElementById('openActorsRankingBtn');
if (openActorsRankingBtn) {
    openActorsRankingBtn.addEventListener('click', () => {
        openModal('actorsRankingModal');
        buildActorsRanking();
    });
}
document.querySelector('.close-actors-ranking')?.addEventListener('click', () => {
    closeModal('actorsRankingModal');
});
window.addEventListener('click', (event) => {
    const actorsModal = document.getElementById('actorsRankingModal');
    if (event.target === actorsModal) closeModal('actorsRankingModal');
});

// Genre chart modal
const openGenreChartBtn = document.getElementById('openGenreChartBtn');
if (openGenreChartBtn) {
    openGenreChartBtn.addEventListener('click', () => {
        openModal('genreChartModal');
        buildGenreChart();
    });
}
document.querySelector('.close-genre-chart')?.addEventListener('click', () => {
    closeModal('genreChartModal');
});
window.addEventListener('click', (event) => {
    const genreModal = document.getElementById('genreChartModal');
    if (event.target === genreModal) closeModal('genreChartModal');
});

// Elo ranking modal
document.getElementById('openEloRankingBtn').addEventListener('click', () => {
    openModal('eloRankingModal');
    buildEloRanking();
});
document.querySelector('.close-elo-ranking').addEventListener('click', () => {
    closeModal('eloRankingModal');
});
window.addEventListener('click', (event) => {
    const eloModal = document.getElementById('eloRankingModal');
    if (event.target === eloModal) closeModal('eloRankingModal');
});

// Movie details modal
document.querySelector('.close-movie-details')?.addEventListener('click', () => {
    closeModal('movieDetailsModal');
});
window.addEventListener('click', (event) => {
    const modal = document.getElementById('movieDetailsModal');
    if (event.target === modal) closeModal('movieDetailsModal');
});

// Stats button
const statsBtn = document.getElementById('statsBtn');
if (statsBtn) {
    statsBtn.addEventListener('click', () => { showVaultSkeleton(); openModal('statsModal'); updateAdvancedStats(); });
}

// Trailer button
const trailerBtn = document.getElementById('trailerBtn');
if (trailerBtn) {
    trailerBtn.addEventListener('click', async () => {
        try {
            const currentUser = getCurrentUser();
            const currentMovieId = getCurrentMovieId();
            if (!currentUser || !currentMovieId) {
                showToast('Devi essere autenticato e avere un film selezionato per vedere il trailer.', 4000);
                return;
            }
            const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
            const m = snap.data();
            const movieResult = await getFirstMovieByTitleYear(m.title, m.year);
            if (movieResult) {
                const vData = await getMovieVideos(movieResult.id);
                const t = vData.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
                if (t) {
                    document.getElementById('trailerIframe').src = `https://www.youtube.com/embed/${t.key}`;
                    openModal('trailerModal');
                } else {
                    showToast('Trailer non trovato per questo film.', 4000);
                }
            } else {
                showToast('Film non trovato su TMDB.', 4000);
            }
        } catch (err) {
            console.error('Trailer error:', err);
            showToast(`Errore trailer: ${err.message || 'Controlla la connessione'}`, 5000);
        }
    });
}

// Export functionality
const exportDataBtn2 = document.getElementById('exportDataBtn2');
if (exportDataBtn2) {
    exportDataBtn2.addEventListener('click', async () => {
    const currentUser = getCurrentUser();
    if (!currentUser) return alert("You must be logged in to export data.");

    const btn = document.getElementById('exportDataBtn2');
    const originalText = btn.innerText;

    try {
        btn.innerText = '⏳ Compiling Backup...';
        btn.disabled = true;

        const movies = await fetchAllMovies();
        if (movies.length === 0) {
            alert("Your archive is empty. Nothing to export!");
            return;
        }

        const dataStr = JSON.stringify(movies, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `sebas_archive_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Backup exported successfully!');
    } catch (error) {
        console.error("Error exporting data:", error);
        alert("Failed to export data.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// Import functionality
document.getElementById('importDataBtn2')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const currentUser = getCurrentUser();
    if (!file || !currentUser) return;

    // 1. Warn the user that this deletes their current data
    if (!confirm("⚠️ WARNING: This will permanently DELETE and replace your current archive with the backup. Proceed?")) {
        e.target.value = ''; // Reset the input if they cancel
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            showToast('⏳ Importing backup... please wait.', 3000);

            // 2. Parse the JSON file
            const importedMovies = JSON.parse(event.target.result);
            if (!Array.isArray(importedMovies)) throw new Error("Invalid JSON format.");

            // 3. Delete all current movies from Firestore
            const currentUser = getCurrentUser();
            if (!currentUser) throw new Error('User not available');
            const snap = await getDocs(collection(db, "users", currentUser.uid, "movies"));
            const deletePromises = snap.docs.map(d => deleteDoc(doc(db, "users", currentUser.uid, "movies", d.id)));
            await Promise.all(deletePromises);

            // 4. Upload the new movies from the backup
            const importPromises = importedMovies.map(movie => {
                // Remove the old ID so Firebase creates a clean new one
                delete movie.id;
                return addDoc(collection(db, "users", currentUser.uid, "movies"), movie);
            });

            await Promise.all(importPromises);
            window.invalidateMoviesCache?.();

            // 5. Clean up and refresh the UI
            showToast('✅ Archive restored successfully!');
            closeModal('importExportModal');
            e.target.value = ''; // Reset the file input
            renderGallery(); // Refresh the grid

        } catch (err) {
            console.error("Import error:", err);
            alert("Error importing data. The file might be corrupted or invalid.");
        }
    };

    // Read the file as text to trigger the onload function above
    reader.readAsText(file);
    });
}

// --- DEPENDENCIES FROM OTHER MODULES ---
// Queste funzioni e oggetti vengono "iniettati" da app.js per far funzionare i bottoni.

// Variabili globali che verranno riempite dalla funzione setUIDependencies
// (showToast NON è qui: è importato staticamente da utils.js in cima al file)
let getCurrentUser, getCurrentMovieId, setCurrentMovieId, getCurrentSelectedMovieExtras, setCurrentSelectedMovieExtras;
let toBase64, searchMoviesWithYear, getMovieDetails, getMovieCredits, getMovieVideos, getFirstMovieByTitleYear;
let signOut, collection, getDocs, deleteDoc, updateDoc, addDoc, doc, getDoc, setDoc, onSnapshot;
let fetchAllMovies, renderGallery;

export function setUIDependencies(deps) {
    ({
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
        getCurrentUser,
        getCurrentMovieId,
        setCurrentMovieId,
        getCurrentSelectedMovieExtras,
        setCurrentSelectedMovieExtras,
        fetchAllMovies,
        renderGallery
    } = deps);
}