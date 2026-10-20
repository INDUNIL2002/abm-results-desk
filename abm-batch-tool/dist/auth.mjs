/**
 * auth.mjs — Firebase Authentication layer for ABM Results Desk.
 * Handles sign-up, login, logout, password reset, and auth state observation.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, ADMIN_UID } from './firebase-config.mjs';

// ── Initialise Firebase ─────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Helpers ─────────────────────────────────────────────────────────────────
export function isAdmin() {
  return auth.currentUser?.uid === ADMIN_UID;
}

export function currentUser() {
  return auth.currentUser;
}

// ── Auth actions ─────────────────────────────────────────────────────────────
export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  // Create user document in Firestore
  await setDoc(doc(db, 'users', cred.user.uid), {
    displayName,
    email,
    createdAt: serverTimestamp(),
    cgpa: null,
    gpaCredits: 0,
    lastUpdated: null,
  });
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut() {
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── Firestore: results data ──────────────────────────────────────────────────
export async function saveResultsToCloud(uid, stateData, summaryData) {
  const payload = {
    results:       stateData.results,
    customCourses: stateData.customCourses,
    overrides:     stateData.overrides,
    profile:       stateData.profile,
    cgpa:          summaryData.gpa,
    gpaCredits:    summaryData.credits,
    gradedCount:   summaryData.gradedCount,
    lastUpdated:   serverTimestamp(),
  };
  await setDoc(doc(db, 'results', uid), payload, { merge: true });
  // Update leaderboard entry
  await setDoc(doc(db, 'users', uid), {
    cgpa:        summaryData.gpa,
    gpaCredits:  summaryData.credits,
    gradedCount: summaryData.gradedCount,
    lastUpdated: serverTimestamp(),
    displayName: auth.currentUser?.displayName || '',
  }, { merge: true });
}

export async function loadResultsFromCloud(uid) {
  const snap = await getDoc(doc(db, 'results', uid));
  return snap.exists() ? snap.data() : null;
}

// ── Leaderboard (admin only) ──────────────────────────────────────────────────
export async function fetchLeaderboard() {
  const snap = await getDocs(collection(db, 'users'));
  const rows = [];
  snap.forEach(d => {
    const data = d.data();
    rows.push({
      uid:         d.id,
      displayName: data.displayName || 'Unknown',
      email:       data.email || '',
      cgpa:        data.cgpa,
      gpaCredits:  data.gpaCredits || 0,
      gradedCount: data.gradedCount || 0,
      lastUpdated: data.lastUpdated?.toDate?.() || null,
    });
  });
  // Sort by CGPA descending (null at bottom)
  rows.sort((a, b) => {
    if (a.cgpa == null && b.cgpa == null) return 0;
    if (a.cgpa == null) return 1;
    if (b.cgpa == null) return -1;
    return b.cgpa - a.cgpa;
  });
  return rows;
}
