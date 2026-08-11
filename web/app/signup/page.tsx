"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProfile(uid: string, displayName: string) {
    await setDoc(doc(db, "profiles", uid), {
      displayName,
      createdAt: serverTimestamp(),
    });
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      setError("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await createProfile(cred.user.uid, name);
      // AuthContext's own onAuthStateChanged listener fires the instant createUserWithEmailAndPassword
      // resolves, with the auth user's displayName still null at that point (updateProfile above
      // hasn't landed yet) — so without this, it writes users/{uid}.displayName as the fallback
      // "Member" and that's what shows up in search/profile pages until the next full login,
      // since profile edits don't re-fire onAuthStateChanged. Set the real name here too so it's
      // correct immediately.
      await setDoc(doc(db, "users", cred.user.uid), { displayName: name }, { merge: true });
      router.push("/home");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (!agreed) {
      setError("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    setError(null);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await createProfile(cred.user.uid, cred.user.displayName ?? "New member");
      router.push("/home");
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8">
      <h1 className="font-display text-2xl font-semibold mb-6 text-center">Create your account</h1>

      <button onClick={handleGoogle} className="btn-secondary w-full mb-4">
        Continue with Google
      </button>

      <div className="flex items-center gap-3 my-4 text-xs text-ink/40">
        <div className="h-px flex-1 bg-line/15" />
        or
        <div className="h-px flex-1 bg-line/15" />
      </div>

      <form onSubmit={handleSignup} className="space-y-3">
        <input
          className="input"
          type="text"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <label className="flex items-start gap-2 text-xs text-ink/60">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to Astryks's{" "}
            <Link href="/terms" target="_blank" className="link-accent">Terms of Service</Link> and{" "}
            <Link href="/privacy" target="_blank" className="link-accent">Privacy Policy</Link>.
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Creating account…" : "Sign up"}
        </button>
      </form>

      <p className="text-center text-sm text-ink/50 mt-6">
        Already have an account?{" "}
        <Link href="/login" className="link-accent">
          Log in
        </Link>
      </p>
    </div>
  );
}
