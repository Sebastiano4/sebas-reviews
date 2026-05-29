/**
 * --- IL POSTO DEI DATI (Firebase) ---
 * Questo file serve a collegare l'app al tuo database su internet.
 * È come il "centralino" che dà il permesso all'app di salvare i tuoi film 
 * e di farti entrare con il tuo account Google. 
 * Senza questo, l'app non saprebbe dove salvare le tue recensioni.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyC5rtNbMp2GY9myxCiausHBp1c9jUliXbk",
    authDomain: "sebas-reviews.firebaseapp.com",
    projectId: "sebas-reviews",
    storageBucket: "sebas-reviews.appspot.com",
    messagingSenderId: "155619440463",
    appId: "1:155619440463:web:af3382d4ae1f3141edb73a",
    measurementId: "G-6B779X2HJV"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();
export const storage = getStorage(app);
export const functions = getFunctions(app);
