/**
 * LISTENER REGISTRY
 * Gestione centralizzata del ciclo di vita dei listener onSnapshot di Firestore.
 * Ogni listener viene registrato con una chiave univoca (es. 'user:profile', 'gallery:uid').
 * Quando una sezione non è più visibile, il listener corrispondente viene chiuso.
 */

const _registry = new Map();

/**
 * Registra un listener. Se esiste già un listener con la stessa chiave, lo chiude prima.
 * @param {string} key - Chiave univoca che identifica il listener (es. 'gallery:uid123')
 * @param {Function} unsubscribeFn - Funzione restituita da onSnapshot
 */
export function registerListener(key, unsubscribeFn) {
    const existing = _registry.get(key);
    if (existing) {
        existing();
    }
    _registry.set(key, unsubscribeFn);
}

/**
 * Chiude e rimuove il listener associato alla chiave data.
 * @param {string} key - Chiave del listener da rimuovere
 */
export function unregisterListener(key) {
    const unsub = _registry.get(key);
    if (unsub) {
        unsub();
        _registry.delete(key);
    }
}

/**
 * Chiude tutti i listener attivi. Chiamare al logout o alla distruzione dell'app.
 */
export function unregisterAll() {
    _registry.forEach(unsub => unsub());
    _registry.clear();
}

/**
 * Restituisce il numero di listener attivi (utile per debug).
 * @returns {number}
 */
export function getActiveListenerCount() {
    return _registry.size;
}
