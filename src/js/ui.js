/**
 * --- LA GESTIONE DELLA SALA (Interfaccia) ---
 * Questo file decide come appare il sito ai tuoi occhi.
 * Si occupa di:
 * - Cambiare tra tema chiaro e scuro.
 * - Aprire e chiudere le finestre (i modali) quando clicchi su un film.
 * - Gestire i menu in basso e il tuo profilo.
 * In pratica, è quello che gestisce i "bottoni" e il look dell'app.
 */

import { updateAdvancedStats, buildDirectorsRanking, buildActorsRanking, buildGenreChart, buildEloRanking, cleanupStats } from './stats.js';
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
    const items = document.querySelectorAll('.bottom-nav-item[data-view]');
    const viewSelect = document.getElementById('viewMode');

    items.forEach(item => {
        item.addEventListener('click', () => {
            // Rimuovi classe active da tutti
            items.forEach(i => i.classList.remove('active'));
            // Aggiungila al cliccato
            item.classList.add('active');

            const view = item.getAttribute('data-view');
            if (view === 'stats') {
                updateAdvancedStats();
                openModal('statsModal');
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
    showProfileMainView();
    openModal('profileModal');
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

export function showProfileMainView() {
    profileState = 'main';
    const container = document.getElementById('profileDynamicContent');
    // Ripristina l'HTML della vista principale
    container.innerHTML = `
        <div id="profileMainView">
            <div class="detail-section" style="margin-bottom:1.5rem;">
                <h4>📷 Avatar & Name</h4>
                <div style="display:flex; align-items:center; gap:16px;">
                    <label for="profilePicInput" style="cursor:pointer; position:relative;">
                        <img id="profilePicPreview" src="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid var(--accent); background:#1e293b;">
                        <span style="position:absolute; bottom:0; right:0; background:var(--accent); color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:0.7rem;">✎</span>
                    </label>
                    <input type="file" id="profilePicInput" accept="image/*" style="display:none;">
                    <div style="flex:1;">
                        <p id="profileNickname" style="font-weight:700; font-size:1.1rem; margin:0 0 4px 0;"></p>
                        <p id="profileEmail" style="color:var(--text-muted); font-size:0.85rem; margin:0 0 6px 0;"></p>
                        <button class="btn-primary" id="editNicknameBtn" style="padding:0.4rem 1rem; font-size:0.85rem;">✏️ Edit Nickname</button>
                    </div>
                </div>
            </div>

            <div class="detail-section" style="margin-bottom:1.5rem;">
                <h4>⚙️ Quick Actions</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <button class="profile-btn" id="themeToggleProfile">🌙 Theme</button>
                    <button class="profile-btn" id="openImportExportBtn">📁 Import / Export</button>
                    <button class="profile-btn" id="clearCacheBtn">🗑️ Clear Cache</button>
                    <button class="profile-btn" id="repairFromProfileBtn">🛠️ Repair Metadata</button>
                </div>
            </div>

            <div class="detail-section" style="margin-bottom:1.5rem;">
                <h4>🔐 Account</h4>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="profile-btn" id="logoutFromProfileBtn">🚪 Logout</button>
                    <button class="profile-btn danger" id="deleteArchiveBtn">⚠️ Delete Entire Archive</button>
                </div>
            </div>

            <p style="margin-top:0.5rem; font-size:0.75rem; color:var(--text-muted); text-align:center;">
                Seba's Reviews v2.0 · Firebase + TMDB + OMDb
            </p>
        </div>
    `;

    // Ricollega i listener (perché l'HTML è stato rigenerato)
    attachProfileListeners();

    // Carica dati personali
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
    document.getElementById('editNicknameBtn')?.addEventListener('click', async () => {
        const current = document.getElementById('profileNickname').innerText;
        const newNick = prompt('Enter new nickname:', current);
        if (newNick && newNick.trim() !== '') {
            const trimmedNick = newNick.trim();
            localStorage.setItem('sebas-nickname', trimmedNick);
            document.getElementById('profileNickname').innerText = trimmedNick;
            showToast('Saving nickname...', 2000);

            const currentUser = getCurrentUser();
            if (currentUser) {
                try {
                    const userDocRef = doc(db, "users", currentUser.uid);
                    await setDoc(userDocRef, { nickname: trimmedNick }, { merge: true });
                    showToast('Nickname saved to Firestore!', 3000);
                } catch (error) {
                    console.error('Nickname save failed:', error);
                    showToast('Failed to save nickname to Firestore.', 4000);
                }
            }
        }
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
document.getElementById('openDirectorsRankingBtn').addEventListener('click', () => {
    openModal('directorsRankingModal');
    buildDirectorsRanking();
});
document.querySelector('.close-ranking').addEventListener('click', () => {
    closeModal('directorsRankingModal');
});
window.addEventListener('click', (event) => {
    const rankingModal = document.getElementById('directorsRankingModal');
    if (event.target === rankingModal) {
        closeModal('directorsRankingModal');
    }
});

// Actors ranking modal
document.getElementById('openActorsRankingBtn')?.addEventListener('click', () => {
    openModal('actorsRankingModal');
    buildActorsRanking();
});
document.querySelector('.close-actors-ranking').addEventListener('click', () => {
    closeModal('actorsRankingModal');
});
window.addEventListener('click', (event) => {
    const actorsModal = document.getElementById('actorsRankingModal');
    if (event.target === actorsModal) closeModal('actorsRankingModal');
});

// Genre chart modal
document.getElementById('openGenreChartBtn').addEventListener('click', () => {
    openModal('genreChartModal');
    buildGenreChart();
});
document.querySelector('.close-genre-chart').addEventListener('click', () => {
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
document.getElementById('statsBtn').onclick = () => { updateAdvancedStats(); openModal('statsModal'); };

// Trailer button
document.getElementById('trailerBtn')?.addEventListener('click', async ()=>{
    const currentUser = getCurrentUser();
    const currentMovieId = getCurrentMovieId();
    if (!currentUser || !currentMovieId) return;
    const snap = await getDoc(doc(db, "users", currentUser.uid, "movies", currentMovieId));
    const m = snap.data();
    const movieResult = await getFirstMovieByTitleYear(m.title, m.year);
    if(movieResult){
        const vData = await getMovieVideos(movieResult.id);
        const t = vData.results.find(v=>v.type==='Trailer' && v.site==='YouTube');
        if(t) {
            document.getElementById('trailerIframe').src = `https://www.youtube.com/embed/${t.key}`;
            openModal('trailerModal');
        }
    }
});

// Export functionality
document.getElementById('exportDataBtn2')?.addEventListener('click', async () => {
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

// --- DEPENDENCIES FROM OTHER MODULES ---
// Queste funzioni e oggetti vengono "iniettati" da app.js per far funzionare i bottoni.

// Variabili globali che verranno riempite dalla funzione setUIDependencies
let showToast; 
let getCurrentUser, getCurrentMovieId, setCurrentMovieId, getCurrentSelectedMovieExtras, setCurrentSelectedMovieExtras;
let toBase64, searchMoviesWithYear, getMovieDetails, getMovieCredits, getMovieVideos, getFirstMovieByTitleYear;
let signOut, collection, getDocs, deleteDoc, updateDoc, addDoc, doc, getDoc, setDoc, onSnapshot;
let fetchAllMovies, renderGallery;

export function setUIDependencies(deps) {
    ({
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
        getCurrentUser,
        getCurrentMovieId,
        setCurrentMovieId,
        getCurrentSelectedMovieExtras,
        setCurrentSelectedMovieExtras,
        fetchAllMovies,
        renderGallery
    } = deps);
}