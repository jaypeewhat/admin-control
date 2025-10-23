import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Read Firebase config from Vite environment variables
const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID,
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID,
  measurementId: (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID,
};

// Basic validation to help during local setup
const missing = Object.entries(firebaseConfig)
  .filter(([k, v]) => k !== 'measurementId' && !v)
  .map(([k]) => k);
if (missing.length) {
  // Note: API key is not a secret for Firebase web apps, but keep it out of git.
  // Provide config via .env.local or your hosting provider's env settings.
  console.warn(
    `Firebase config is missing keys: ${missing.join(', ')}.\n` +
    'Create admin-web/.env.local with VITE_FIREBASE_* variables or configure your host env.'
  );
}

const app = initializeApp(firebaseConfig as any);
export const auth = getAuth(app);
export const db = getFirestore(app);
