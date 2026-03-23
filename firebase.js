import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

// Wklej tutaj konfiguracje projektu Firebase z konsoli Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyA6o2VS1mIy1nDTlub_n2V2SiLIQZluqs8",
  authDomain: "gym-tracker-3e709.firebaseapp.com",
  projectId: "gym-tracker-3e709",
  storageBucket: "gym-tracker-3e709.firebasestorage.app",
  messagingSenderId: "460098827357",
  appId: "1:460098827357:web:9625a0cb321add2833c9b4",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Utrzymanie sesji po odswiezeniu strony.
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Nie udalo sie ustawic persistence:", error);
});

export {
  auth,
  db,
  storage,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};
