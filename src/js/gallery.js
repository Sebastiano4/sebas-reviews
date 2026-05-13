/**
 * --- GALLERY MODULE (Image Management with Firebase) ---
 * Questo modulo gestisce il caricamento e il recupero in tempo reale di immagini
 * per la galleria utente, integrando Firebase Storage e Firestore.
 */

import { auth, db, storage } from './firebase.js';
import { registerListener, unregisterListener } from './listener-registry.js';
import { 
    ref, 
    uploadBytes, 
    getDownloadURL, 
    deleteObject 
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { 
    collection, 
    addDoc, 
    onSnapshot, 
    query, 
    where, 
    orderBy, 
    deleteDoc, 
    doc,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

/**
 * Carica più immagini in Firebase Storage e salva i riferimenti in Firestore
 * @param {FileList|File[]} files - Array o FileList di file da caricare
 * @param {Function} progressCallback - Callback opzionale per monitorare il progresso (index, total)
 * @returns {Promise<Array>} Array di oggetti con i dati delle immagini caricate
 */
export async function uploadUserImages(files, progressCallback = null) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error("User must be logged in to upload images");
    }

    if (!files || files.length === 0) {
        throw new Error("No files provided");
    }

    const filesArray = Array.from(files);
    const uploadedImages = [];

    try {
        for (let i = 0; i < filesArray.length; i++) {
            const file = filesArray[i];
            const timestamp = Date.now();
            const filename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const storagePath = `users/${currentUser.uid}/gallery/${filename}`;
            const storageRef = ref(storage, storagePath);

            // Carica il file
            await uploadBytes(storageRef, file);

            // Recupera il download URL
            const downloadURL = await getDownloadURL(storageRef);

            // Salva il riferimento in Firestore
            const galleryRef = await addDoc(collection(db, "galleries"), {
                uid: currentUser.uid,
                url: downloadURL,
                storagePath: storagePath,
                filename: file.name,
                fileSize: file.size,
                fileType: file.type,
                timestamp: timestamp,
                createdAt: new Date().toISOString()
            });

            uploadedImages.push({
                id: galleryRef.id,
                url: downloadURL,
                filename: file.name,
                timestamp: timestamp
            });

            // Callback per il progresso
            if (progressCallback) {
                progressCallback(i + 1, filesArray.length);
            }

            console.log(`Image ${i + 1}/${filesArray.length} uploaded:`, filename);
        }

        return uploadedImages;
    } catch (error) {
        console.error("Error uploading images:", error);
        throw new Error(`Failed to upload images: ${error.message}`);
    }
}

/**
 * Ascolta in tempo reale le immagini della galleria dell'utente
 * @param {string} uid - UID dell'utente
 * @param {Function} callback - Funzione da chiamare quando i dati cambiano
 * @returns {Function} Funzione per cancellare il listener
 */
export function listenToGallery(uid, callback) {
    if (!uid) {
        throw new Error("UID is required");
    }

    if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
    }

    try {
        const q = query(
            collection(db, "galleries"),
            where("uid", "==", uid),
            orderBy("timestamp", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const images = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback(images);
        }, (error) => {
            console.error("Error listening to gallery:", error);
            callback([], error);
        });

        // Registra nel registry globale: se questa funzione viene richiamata
        // per lo stesso utente, il listener precedente viene chiuso automaticamente.
        registerListener(`gallery:${uid}`, unsubscribe);

        return unsubscribe;
    } catch (error) {
        console.error("Error setting up gallery listener:", error);
        throw new Error(`Failed to listen to gallery: ${error.message}`);
    }
}

/**
 * Chiude il listener della galleria per l'utente specificato.
 * Da chiamare quando la sezione galleria non è più visibile.
 * @param {string} uid - UID dell'utente
 */
export function stopGalleryListener(uid) {
    if (uid) {
        unregisterListener(`gallery:${uid}`);
    }
}

/**
 * Elimina un'immagine dalla galleria (sia da Storage che da Firestore)
 * @param {string} imageId - ID del documento Firestore
 * @param {string} storagePath - Percorso del file in Storage
 * @returns {Promise<void>}
 */
export async function deleteGalleryImage(imageId, storagePath) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error("User must be logged in to delete images");
    }

    if (!imageId || !storagePath) {
        throw new Error("Image ID and storage path are required");
    }

    try {
        // Elimina da Storage
        const fileRef = ref(storage, storagePath);
        await deleteObject(fileRef);

        // Elimina il documento da Firestore
        await deleteDoc(doc(db, "galleries", imageId));

        console.log("Image deleted successfully");
    } catch (error) {
        console.error("Error deleting image:", error);
        throw new Error(`Failed to delete image: ${error.message}`);
    }
}

/**
 * Recupera tutte le immagini della galleria dell'utente (una sola volta, non real-time)
 * @param {string} uid - UID dell'utente
 * @returns {Promise<Array>} Array di immagini
 */
export async function fetchGalleryImages(uid) {
    if (!uid) {
        throw new Error("UID is required");
    }

    try {
        const q = query(
            collection(db, "galleries"),
            where("uid", "==", uid),
            orderBy("timestamp", "desc")
        );

        const snapshot = await getDocs(q);
        const images = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return images;
    } catch (error) {
        console.error("Error fetching gallery images:", error);
        throw new Error(`Failed to fetch gallery images: ${error.message}`);
    }
}

/**
 * Ottiene le statistiche della galleria dell'utente
 * @param {string} uid - UID dell'utente
 * @returns {Promise<Object>} Oggetto con statistiche
 */
export async function getGalleryStats(uid) {
    if (!uid) {
        throw new Error("UID is required");
    }

    try {
        const images = await fetchGalleryImages(uid);
        const totalSize = images.reduce((sum, img) => sum + (img.fileSize || 0), 0);

        return {
            totalImages: images.length,
            totalSize: totalSize,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            averageSize: images.length > 0 ? (totalSize / images.length / 1024).toFixed(2) : 0,
            oldestImage: images.length > 0 ? images[images.length - 1].createdAt : null,
            newestImage: images.length > 0 ? images[0].createdAt : null
        };
    } catch (error) {
        console.error("Error getting gallery stats:", error);
        throw new Error(`Failed to get gallery stats: ${error.message}`);
    }
}

export default {
    uploadUserImages,
    listenToGallery,
    stopGalleryListener,
    deleteGalleryImage,
    fetchGalleryImages,
    getGalleryStats
};
