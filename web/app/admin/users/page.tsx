"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";

const deleteUserAccountFn = httpsCallable(functions, "deleteUserAccount");
const backfillPostVisibilityFn = httpsCallable(functions, "backfillPostVisibility");

// Simple allowlist for who can delete accounts — same as the lesson upload page.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export default function AdminUsersPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!ADMIN_EMAILS.includes(user.email ?? "")) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    if (
      !confirm(
        `Permanently delete the account for ${trimmed}? This removes their posts, follows, saves, lesson progress, and login. This can't be undone.`
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteUserAccountFn({ email: trimmed });
      setSuccess(`Deleted the account for ${trimmed}.`);
      setEmail("");
    } catch (err: any) {
      setError(err.message ?? "Couldn't delete that account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBackfill() {
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const result = await backfillPostVisibilityFn();
      const { updated } = result.data as { updated: number };
      setBackfillResult(
        updated === 0
          ? "Nothing to do — every post already has a public/private setting."
          : `Marked ${updated} older post${updated === 1 ? "" : "s"} as public.`
      );
    } catch (err: any) {
      setBackfillResult(err.message ?? "Couldn't run that.");
    } finally {
      setBackfillLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-semibold mb-2">Delete an account</h1>
      <p className="text-sm text-ink/60 mb-6">
        Admin-only. This permanently deletes a member's posts (and their videos/photos), follows, saved posts,
        lesson progress, and their login itself. There's no undo, so double-check the email before confirming.
      </p>
      <form onSubmit={handleDelete} className="space-y-4">
        <input
          className="input"
          type="email"
          placeholder="member@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}
        <button type="submit" disabled={loading || !email.trim()} className="w-full rounded-xl bg-red-600 text-white font-medium py-3 disabled:opacity-50">
          {loading ? "Deleting…" : "Delete account"}
        </button>
      </form>

      <div className="mt-10 pt-6 border-t border-ink/10">
        <h2 className="font-display text-lg font-semibold mb-2">One-time cleanup</h2>
        <p className="text-sm text-ink/60 mb-4">
          Posts made before the public/private toggle existed don't have that setting stored yet (the app already
          treats them as public everywhere, this just makes it explicit in the data). Safe to run more than once —
          it's a no-op once everything's already tagged.
        </p>
        {backfillResult && <p className="text-sm text-ink/70 mb-3">{backfillResult}</p>}
        <button
          onClick={handleBackfill}
          disabled={backfillLoading}
          className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
        >
          {backfillLoading ? "Running…" : "Tag older posts as public"}
        </button>
      </div>
    </div>
  );
}
