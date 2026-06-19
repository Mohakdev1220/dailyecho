/**
 * firebase.js — Daily Echo
 * Firebase initialization, Auth, and Firestore exports.
 *
 * IMPORTANT: Replace the firebaseConfig values below with your own
 * project credentials from the Firebase Console before deploying.
 *
 * Console → Project Settings → Your apps → Firebase SDK snippet → Config
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------------------
// 🔑  FIREBASE CONFIG
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey:            "AIzaSyDJANDEn9IdMFNEvKClOofHTmX64IsSyqw",
  authDomain:        "dailymemo-92398.firebaseapp.com",
  projectId:         "dailymemo-92398",
  storageBucket:     "dailymemo-92398.firebasestorage.app",
  messagingSenderId: "707078957755",
  appId:             "1:707078957755:web:5027f3cac6a4590059579e",
  measurementId:     "G-21EY99C4ZK"
};
// ---------------------------------------------------------------------------

// Initialise app
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Initialise Firestore with persistent cache (no deprecation warning)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// ---------------------------------------------------------------------------
// Exports — everything script.js needs
// ---------------------------------------------------------------------------
export {
  // App
  app,

  // Auth
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,

  // Firestore
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
};
