/* =============================================================
   firebase-config.js — Your Firebase project credentials
   =============================================================
   Configured for the "Centry" Firebase project. This is the file
   that turns on multi-device, multi-person live sync across the
   whole app — no other file needs to change.
   ============================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCPmWgrf-Lo_BL06lDdMfduRXHCkY7yNIo",
  authDomain: "centry-a9289.firebaseapp.com",
  projectId: "centry-a9289",
  storageBucket: "centry-a9289.firebasestorage.app",
  messagingSenderId: "773445044652",
  appId: "1:773445044652:web:7b31bec2a66b686745d209",
};

/* -------------------------------------------------------------
   SECURITY NOTE — please do this within 30 days:

   Firestore's "test mode" rules (the default when you first
   created the database) allow anyone with these config values
   above to read AND write your data directly, bypassing this
   app's login screen entirely. Config values are visible in your
   site's source code since this is a static site with no server
   to hide them behind — the same limitation the login passwords
   already have.

   Test mode rules also EXPIRE 30 days after the database was
   created and will silently stop working after that. Before then,
   go to the Firebase console -> Firestore Database -> Rules tab,
   and replace whatever is there with:

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /cmms_data/{document=**} {
           allow read, write: if true;
         }
       }
     }

   Click "Publish". This keeps the same "anyone with the link can
   use it" security level as the rest of this app (not secure
   against a determined technical visitor, but fine for preventing
   casual/accidental access) — and, unlike test mode, it does not
   expire.

   If you ever need real protection (only logged-in staff can read
   or write), that requires adding Firebase Authentication with
   real user accounts and rules that check `request.auth != null`
   — a bigger step up. Let me know if you want that built.
   ------------------------------------------------------------- */
