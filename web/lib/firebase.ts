"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Firebase App Check: proves a request to Firestore/Storage/Functions is genuinely coming from
// this web app (via a Google reCAPTCHA v3 challenge) rather than a scripted client someone wrote
// against the same public Firebase config — none of Firebase's public config values (apiKey
// included) are secret, so without App Check anyone can call the same backend directly.
//
// This is entirely a no-op until NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set — see
// .env.local.example for the exact console steps. That's deliberate: App Check must never be
// switched to "Enforce" in the Firebase console for Firestore/Storage/Functions until the mobile
// app also sends App Check tokens (it doesn't yet — that needs a separate App Attest/Play
// Integrity setup and an app-store rebuild), or every mobile request would start failing.
// Enabling it here in "monitor only" mode first lets the metrics in the App Check console confirm
// real traffic is verified before that switch is ever flipped.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY) {
  try {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    // Force the first reCAPTCHA v3 challenge to run right away, on page load, instead of
    // waiting for it to happen lazily on whatever the first Firestore/Storage/Functions call
    // turns out to be — which was very often "click Subscribe," making that specific button
    // feel slow. This runs the challenge in the background while someone is still reading the
    // page, so by the time they click, App Check already has a cached token ready to attach.
    getToken(appCheck).catch(() => {});
  } catch {
    // Never let a misconfigured site key break the app for real users — App Check is a defense
    // in depth measure, not something login/posting/checkout should depend on.
  }
}
