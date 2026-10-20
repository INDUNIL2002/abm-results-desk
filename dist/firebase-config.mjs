/**
 * Firebase configuration for ABM Results Desk.
 * Replace the placeholder values below with your actual Firebase project config.
 * Get this from: Firebase Console → Project Settings → Your apps → Web app
 */
export const firebaseConfig = {
  apiKey:            "PASTE_YOUR_apiKey_HERE",
  authDomain:        "PASTE_YOUR_authDomain_HERE",
  projectId:         "PASTE_YOUR_projectId_HERE",
  storageBucket:     "PASTE_YOUR_storageBucket_HERE",
  messagingSenderId: "PASTE_YOUR_messagingSenderId_HERE",
  appId:             "PASTE_YOUR_appId_HERE",
};

/**
 * Your Firebase Authentication UID for the admin account.
 * After you log in for the first time, open browser DevTools console and run:
 *   firebase.auth().currentUser.uid
 * Then paste that UID string here and re-save this file.
 */
export const ADMIN_UID = "PASTE_YOUR_ADMIN_UID_HERE";
