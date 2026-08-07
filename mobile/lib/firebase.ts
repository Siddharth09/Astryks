import { initializeApp, getApps, getApp } from "firebase/app";
// @ts-expect-error — getReactNativePersistence only exists in the "react-native"
// build of firebase/auth, which Metro resolves at bundle time via package.json's
// "react-native" export condition. Plain `tsc` uses Node resolution and doesn't
// see it, so this is a real, safe runtime export despite the type error here.
import { initializeAuth, getReactNativePersistence, getAuth, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

// Values come from app.config extra (see EXPO_PUBLIC_ env vars below,
// read automatically by Expo — no extra wiring needed).
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth throws if called twice (e.g. fast refresh) — fall back to getAuth.
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

export { app, auth };
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
