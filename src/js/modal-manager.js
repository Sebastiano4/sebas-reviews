/**
 * GLOBAL MODAL MANAGER
 * Centralized system for managing all modals with Hardware Back Button support
 * Uses History API for seamless navigation on mobile
 */

// Track the modal stack (LIFO - Last In, First Out)
let modalStack = [];
let skipHistoryBackOnNextClose = false;

// List of all modal IDs in the app
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
  'voteModal'
];

/**
 * Detect which modal is currently open in the DOM
 */
function detectCurrentlyOpenModals() {
  const openModals = [];
  MODAL_IDS.forEach(id => {
    const elem = document.getElementById(id);
    if (!elem) return;

    const computed = window.getComputedStyle(elem);
    if (computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0') {
      openModals.push(id);
    }
  });
  return openModals;
}

/**
 * Sync internal stack with DOM reality
 */
function syncModalStack() {
  modalStack = detectCurrentlyOpenModals();
}

/**
 * Open a modal and push to history stack
 * @param {string|HTMLElement} modalId - Modal ID or element
 */
export function openModal(modalId) {
  const modalElement = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modalElement) {
    console.warn('Modal element not found:', modalId);
    return;
  }

  const id = typeof modalId === 'string' ? modalId : modalElement.id;

  // Show the modal
  showModalElement(modalElement);

  // Add to stack if not already there
  if (!modalStack.includes(id)) {
    modalStack.push(id);
  }

  // Push to browser history
  history.pushState(
    { modalStack: [...modalStack], modalOpen: true, modalId: id },
    '',
    window.location.href
  );
}

/**
 * Close a modal and clean up history
 * @param {string|boolean|null} modalIdOrSkipHistory - Modal ID to close, or skipHistory boolean when closing top modal
 * @param {boolean} [skipHistory=false] - When closing by ID, skipHistory prevents a duplicate history.back call during popstate handling
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

  const modalElement = document.getElementById(modalId);
  if (modalElement) {
    hideModalElement(modalElement);
  }

  const idx = modalStack.indexOf(modalId);
  if (idx !== -1) {
    modalStack.splice(idx, 1);
  }

  // Clean up browser history if user manually closed
  if (skipHistory) {
    skipHistoryBackOnNextClose = true;
  } else if (history.state && history.state.modalOpen && history.length > 1) {
    history.back();
  }
}

/**
 * Close a specific modal by ID
 */
export function closeModalById(modalId) {
  closeModal(modalId, false);
}

/**
 * Force close all modals
 */
export function closeAllModals() {
  while (modalStack.length > 0) {
    const modalId = modalStack.pop();
    const modalElement = document.getElementById(modalId);
    if (modalElement) {
      hideModalElement(modalElement);
    }
  }
}

/**
 * Get the currently open modal
 */
export function getCurrentModal() {
  syncModalStack();
  if (modalStack.length === 0) return null;
  return modalStack[modalStack.length - 1];
}

/**
 * Check if any modal is open
 */
export function isAnyModalOpen() {
  syncModalStack();
  return modalStack.length > 0;
}

/**
 * Show modal element (handles different display types)
 */
function showModalElement(element) {
  if (!element) return;

  // Determine display type based on class or previous state
  const displayType = element.classList.contains('battle-content') ||
                     element.id === 'battleModal' ? 'flex' : 'block';

  element.style.display = displayType;

  // Ensure modal visibility
  if (element.classList.contains('active')) {
    // Already has active class
  } else {
    element.classList.add('active');
  }
}

const popStateInterceptors = [];

export function registerPopStateInterceptor(interceptor) {
  if (typeof interceptor !== 'function') return () => {};
  popStateInterceptors.push(interceptor);
  return () => {
    const idx = popStateInterceptors.indexOf(interceptor);
    if (idx !== -1) popStateInterceptors.splice(idx, 1);
  };
}

/**
 * Hide modal element
 */
function hideModalElement(element) {
  if (!element) return;
  element.style.display = 'none';
  element.classList.remove('active');
}

/**
 * Global popstate handler for browser/hardware back button
 */
export function initGlobalBackButtonHandler() {
  window.addEventListener('popstate', (event) => {
    // Allow nested app state handlers to intercept back before closing a modal.
    for (const interceptor of popStateInterceptors) {
      try {
        if (interceptor(event)) {
          return;
        }
      } catch (err) {
        console.warn('Popstate interceptor error:', err);
      }
    }

    syncModalStack();
    
    // If any modal is open, close the top-most one
    if (isAnyModalOpen()) {
      const topModalId = modalStack[modalStack.length - 1];
      if (topModalId) {
        const elem = document.getElementById(topModalId);
        if (elem) {
          hideModalElement(elem);
        }
        
        // Remove from stack
        modalStack.pop();
        
        console.log(`🔙 Back button: closed modal "${topModalId}"`);
      }
      return;
    }

    // Otherwise allow normal navigation (browser handles it)
  });
}

/**
 * Attach close handlers to modal close buttons
 * This is called automatically during initialization
 */
export function attachCloseHandlers() {
  // We'll let existing close button handlers work as-is
  // The MutationObserver (watchModalChanges) will detect when modals are hidden
  // and automatically clean up the history
}

/**
 * Watch for modal visibility changes and clean up history
 * This helps when modals are closed without going through our handlers
 */
function watchModalChanges() {
  let previousVisibility = {};
  
  // Initialize previous state
  MODAL_IDS.forEach(id => {
    const elem = document.getElementById(id);
    previousVisibility[id] = elem ? elem.style.display !== 'none' : false;
  });

  const observer = new MutationObserver(() => {
    // Check each modal
    MODAL_IDS.forEach(id => {
      const elem = document.getElementById(id);
      if (!elem) return;
      
      const isNowVisible = elem.style.display !== 'none' && elem.style.display !== '';
      const wasVisible = previousVisibility[id];
      
      // Modal was visible and is now hidden
      if (wasVisible && !isNowVisible) {
        previousVisibility[id] = false;
        
        // Remove from stack
        const idx = modalStack.indexOf(id);
        if (idx !== -1) {
          modalStack.splice(idx, 1);
        }
        
        // Clean up history (a modal was manually closed)
        if (skipHistoryBackOnNextClose) {
          skipHistoryBackOnNextClose = false;
        } else if (history.length > 1) {
          // Only call history.back() if the current state is marked as modal
          const currentState = history.state;
          if (currentState && currentState.modalOpen) {
            history.back();
          }
        }
      }
      // Modal was hidden and is now visible
      else if (!wasVisible && isNowVisible) {
        previousVisibility[id] = true;

        // Add to stack if not already there
        if (!modalStack.includes(id)) {
          modalStack.push(id);
        }

        // openModal already handles history state pushes.
        // This observer only keeps the internal stack synced for external modifications.
      }
    });
  });

  // Watch the entire document for changes
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
    subtree: true,
    attributeOldValue: false,
    characterData: false
  });
}

/**
 * Initialize the global modal system
 * Call this once when the app loads
 */
export function initModalSystem() {
  initGlobalBackButtonHandler();
  watchModalChanges();
  console.log('✓ Global Modal System initialized');
}

/**
 * Re-attach close handlers (call after new modals are added dynamically)
 */
export function refreshCloseHandlers() {
  attachCloseHandlers();
}

/**
 * Debug: Log current modal stack
 */
export function debugModalStack() {
  syncModalStack();
  console.log('Current Modal Stack:', modalStack);
}

