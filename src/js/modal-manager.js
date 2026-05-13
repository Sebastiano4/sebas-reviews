/**
 * GLOBAL MODAL MANAGER
 * Centralized system for managing all modals with Hardware Back Button support.
 * Uses History API for seamless navigation on mobile.
 *
 * Architettura deterministica: lo stato dello stack è aggiornato esclusivamente
 * tramite le chiamate esplicite a openModal() e closeModal(). Non esiste alcun
 * osservatore passivo del DOM (MutationObserver rimosso per performance).
 */

let modalStack = [];

const MODAL_IDS = [
  'modal',
  'reviewModal',
  'statsModal',
  'exploreMovieModal',
  'movieDetailsModal',
  'battleModal',
  'profileModal',
  'importExportModal',
  'trailerModal',
  'directorsRankingModal',
  'actorsRankingModal',
  'genreChartModal',
  'eloRankingModal',
  'voteModal',
  'confirmModal'
];

function syncModalStack() {
  const open = [];
  MODAL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const s = window.getComputedStyle(el);
    if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') {
      open.push(id);
    }
  });
  modalStack = open;
}

/**
 * Apre un modal e lo aggiunge allo stack history.
 * @param {string|HTMLElement} modalId
 */
export function openModal(modalId) {
  const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!el) {
    console.warn('Modal element not found:', modalId);
    return;
  }

  const id = typeof modalId === 'string' ? modalId : el.id;

  showModalElement(el);

  if (!modalStack.includes(id)) {
    modalStack.push(id);
  }

  history.pushState(
    { modalStack: [...modalStack], modalOpen: true, modalId: id },
    '',
    window.location.href
  );
}

/**
 * Chiude un modal. Se viene passato un ID lo chiude direttamente,
 * altrimenti chiude il modal in cima allo stack.
 * @param {string|boolean} [modalIdOrSkipHistory=false]
 * @param {boolean} [skipHistory=false]
 */
export function closeModal(modalIdOrSkipHistory = false, skipHistory = false) {
  syncModalStack();

  let modalId;
  if (typeof modalIdOrSkipHistory === 'string') {
    modalId = modalIdOrSkipHistory;
  } else {
    skipHistory = modalIdOrSkipHistory === true ? true : skipHistory;
    modalId = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
  }

  if (!modalId) return;

  const el = document.getElementById(modalId);
  if (el) hideModalElement(el);

  const idx = modalStack.indexOf(modalId);
  if (idx !== -1) modalStack.splice(idx, 1);

  if (!skipHistory && history.state && history.state.modalOpen && history.length > 1) {
    history.back();
  }
}

export function closeModalById(modalId) {
  closeModal(modalId, false);
}

export function closeAllModals() {
  while (modalStack.length > 0) {
    const id = modalStack.pop();
    const el = document.getElementById(id);
    if (el) hideModalElement(el);
  }
}

export function getCurrentModal() {
  syncModalStack();
  return modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
}

export function isAnyModalOpen() {
  syncModalStack();
  return modalStack.length > 0;
}

function showModalElement(el) {
  if (!el) return;
  const displayType = el.id === 'battleModal' ? 'flex' : 'block';
  el.style.display = displayType;
  el.classList.add('active');
}

function hideModalElement(el) {
  if (!el) return;
  el.style.display = 'none';
  el.classList.remove('active');
}

// ---- POPSTATE INTERCEPTORS ----

const popStateInterceptors = [];

export function registerPopStateInterceptor(interceptor) {
  if (typeof interceptor !== 'function') return () => {};
  popStateInterceptors.push(interceptor);
  return () => {
    const idx = popStateInterceptors.indexOf(interceptor);
    if (idx !== -1) popStateInterceptors.splice(idx, 1);
  };
}

export function initGlobalBackButtonHandler() {
  window.addEventListener('popstate', (event) => {
    for (const interceptor of popStateInterceptors) {
      try {
        if (interceptor(event)) return;
      } catch (err) {
        console.warn('Popstate interceptor error:', err);
      }
    }

    syncModalStack();

    if (isAnyModalOpen()) {
      const topId = modalStack[modalStack.length - 1];
      if (topId) {
        const el = document.getElementById(topId);
        if (el) hideModalElement(el);
        modalStack.pop();
      }
    }
  });
}

/**
 * Inizializza il sistema modale globale.
 * Chiamare una sola volta all'avvio dell'app.
 */
export function initModalSystem() {
  initGlobalBackButtonHandler();
  console.log('✓ Global Modal System initialized');
}

export function debugModalStack() {
  syncModalStack();
  console.log('Current Modal Stack:', modalStack);
}
