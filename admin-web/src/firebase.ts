import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Duplicate of mobile config for isolation; keep in sync with constants/firebase.ts
const firebaseConfig = {
  apiKey: "AIzaSyAragOHRAprUg78zfyq6cAGHO38TG2uj90",
  authDomain: "slsu-driver-portal.firebaseapp.com",
  projectId: "slsu-driver-portal",
  storageBucket: "slsu-driver-portal.firebasestorage.app",
  messagingSenderId: "342956493367",
  appId: "1:342956493367:web:95fa09cee5a95d966a8db2",
  measurementId: "G-733MMNLM7W"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
