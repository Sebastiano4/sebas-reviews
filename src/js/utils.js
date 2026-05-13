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

// --- Lazy loader per script e stylesheet esterni ---
const scriptPromises = new Map();
const stylesheetPromises = new Map();

export function loadScript(src, integrity) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const p = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        if (integrity) {
            s.integrity = integrity;
            s.crossOrigin = 'anonymous';
        }
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(s);
    });
    scriptPromises.set(src, p);
    return p;
}

export function loadStylesheet(href, integrity) {
    if (stylesheetPromises.has(href)) return stylesheetPromises.get(href);
    const p = new Promise((resolve, reject) => {
        const existing = document.querySelector(`link[href="${href}"]`);
        if (existing) { resolve(); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        if (integrity) {
            link.integrity = integrity;
            link.crossOrigin = 'anonymous';
        }
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
        document.head.appendChild(link);
    });
    stylesheetPromises.set(href, p);
    return p;
}

export const ensureChartJs = () => loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js');
export const ensurePapaParse = () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js');
export const ensureLeaflet = () => Promise.all([
    loadStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='),
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
]);