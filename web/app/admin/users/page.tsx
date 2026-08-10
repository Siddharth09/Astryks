"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";

const deleteUserAccountFn = httpsCallable(functions, "deleteUserAccount");
const backfillPostVisibilityFn = httpsCallable(functions, "backfillPostVisibility");
const listAllUsersFn = httpsCallable(functions, "listAllUsers");

// Simple allowlist for who can delete accounts — same as the lesson upload page.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

type ListedUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string;
  subscriptionStatus: string | null;
};

export default function AdminUsersPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<ListedUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  const isAdmin = !!user && ADMIN_EMAILS.includes(user.email ?? "");

  // Loads the full member list once, on mount — this is a straightforward way to see everyone
  // who's signed up (email, name, join date, subscription status) without going into the
  // Firebase console's Authentication tab.
  useEffect(() => {
    if (!isAdmin) return;
    listAllUsersFn()
      .then((result) => setAllUsers((result.data as any).users))
      .catch((err) => setUsersError(err.message ?? "Couldn't load the member list."));
  }, [isAdmin]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin) {
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
    <div className="max-w-3xl mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-semibold mb-2">All members</h1>
      <p className="text-sm text-ink/60 mb-4">
        Every signed-up account, newest first — pulled from Firebase Authentication, so this
        always matches what's really there without you needing to open the Firebase console.
      </p>
      {usersError && <p className="text-sm text-red-600 mb-4">{usersError}</p>}
      {allUsers === null && !usersError ? (
        <p className="text-ink/50 text-sm mb-8">Loading…</p>
      ) : (
        <div className="card overflow-x-auto mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/10">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium">Last active</th>
                <th className="px-4 py-2 font-medium">Subscription</th>
              </tr>
            </thead>
            <tbody>
              {(allUsers ?? []).map((u) => (
                <tr key={u.uid} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">{u.displayName || "—"}</td>
                  <td className="px-4 py-2">{u.email || "—"}</td>
                  <td className="px-4 py-2 text-ink/60">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-ink/60">
                    {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {u.subscriptionStatus === "active" ? (
                      <span className="text-green-700">active</span>
                    ) : (
                      <span className="text-ink/40">{u.subscriptionStatus || "none"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {allUsers && allUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink/40">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="font-display text-2xl font-semibold mb-2">Delete an account</h2>
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
