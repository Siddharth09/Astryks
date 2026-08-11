"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// useSearchParams() requires a Suspense boundary during static prerendering (Next.js App
// Router) — without this wrapper, `next build` fails on Firebase App Hosting/Vercel with
// "useSearchParams() should be wrapped in a suspense boundary."
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

// The "next" query param is attacker-controllable (it's just part of the URL someone can send
// in a link), so it must never be followed as-is. A bare `router.push(params.get("next"))`
// would let an attacker craft a login link like /login?next=https://evil.example.com and have
// Next.js's router do a real cross-origin navigation right after a victim types their real
// password — a phishing setup, not a redirect bug. Only allow same-app, on-site paths: must
// start with a single "/" and not "//" or "/\" (both of those are browser-interpreted as
// protocol-relative URLs that still leave the site).
function safeNextPath(raw: string | null): string {
  if (!raw) return "/home";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/home";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push(safeNextPath(params.get("next")));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    if (!email) {
      setError("Enter your email above first, then tap \"Forgot password?\" again.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const profileRef = doc(db, "profiles", cred.user.uid);
      const existing = await getDoc(profileRef);
      if (!existing.exists()) {
        await setDoc(profileRef, {
          displayName: cred.user.displayName ?? "New member",
          createdAt: serverTimestamp(),
        });
      }
      router.push(safeNextPath(params.get("next")));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="font-display text-2xl font-semibold mb-6 text-center">Welcome back</h1>

      <button onClick={handleGoogle} className="btn-secondary w-full mb-4">
        Continue with Google
      </button>

      <div className="flex items-center gap-3 my-4 text-xs text-ink/40">
        <div className="h-px flex-1 bg-line/15" />
        or
        <div className="h-px flex-1 bg-line/15" />
      </div>

      <form onSubmit={handleLogin} className="space-y-3">
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="text-right -mt-1">
          {resetSent ? (
            <p className="text-xs text-green-700">
              Check your inbox at {email} for a reset link.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetLoading}
              className="text-xs link-accent"
            >
              {resetLoading ? "Sending…" : "Forgot password?"}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="text-center text-sm text-ink/50 mt-6">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="link-accent">
          Sign up
        </Link>
      </p>
    </div>
  );
}
