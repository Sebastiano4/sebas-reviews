/**
 * --- GLI ATTREZZI UTILI ---
 * Qui ci sono tutti i piccoli strumenti che servono all'app per funzionare bene.
 * Ad esempio: il calcolatore per fare le medie dei voti, il sistema che fa
 * vibrare il telefono, o i messaggi che appaiono in basso per dirti "Film salvato!".
 * Sono funzioni "tuttofare" che usiamo un po' dappertutto.
 */

export function showSkeletonLoaders(count = 10) {
    const gallery = document.getElementById('gallery');
    let skeletonsHTML = '';
    for (let i = 0; i < count; i++) {
        skeletonsHTML += `
            <div class="skeleton-card">
                <div class="skeleton-poster"></div>
                <div class="skeleton-info">
                    <div class="skeleton-text title"></div>
                    <div class="skeleton-text subtitle"></div>
                </div>
            </div>
        `;
    }
    if (gallery.innerHTML === '') {
        gallery.innerHTML = skeletonsHTML;       // primo caricamento
    } else {
        gallery.insertAdjacentHTML('beforeend', skeletonsHTML); // carica altri
    }
}

export function removeSkeletonLoaders() {
    const skeletons = document.querySelectorAll('.skeleton-card');
    skeletons.forEach(s => s.remove());
}

export function showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export const getMedian = (arr) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const getStdDev = (arr) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

export const toBase64 = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.readAsDataURL(f);
    r.onload = () => res(r.result);
    r.onerror = rej;
});

export function getRuntimeMinutes(runtime) {
    if (!runtime || runtime === 'N/A' || runtime === 'Unknown') return 105;
    if (typeof runtime === 'number') return runtime;
    const match = String(runtime).match(/\d+/);
    return match ? parseInt(match[0], 10) : 105;
}

export function hapticFeedback(style = 'light') {
    if (navigator.vibrate) {
        const patterns = { light: 10, medium: 20, heavy: 30 };
        navigator.vibrate(patterns[style] || 10);
    }
}