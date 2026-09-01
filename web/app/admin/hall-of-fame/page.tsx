"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const getHallOfFameFn = httpsCallable(functions, "getHallOfFame");
const removeFromHallOfFameFn = httpsCallable(functions, "removeFromHallOfFame");

export default function AdminHallOfFamePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [entries, setEntries] = useState<any[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && isAdmin(user.email)) {
      getHallOfFameFn()
        .then((res) => setEntries((res.data as any).entries))
        .catch((err) => setError(err.message ?? "Couldn't load the Hall of Fame."));
    }
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleRemove(postId: string) {
    setRemovingId(postId);
    try {
      await removeFromHallOfFameFn({ postId });
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== postId) : prev));
    } catch (err: any) {
      setError(err.message ?? "Couldn't remove that.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24 px-4">
      <h1 className="font-display text-2xl font-semibold mb-2">Hall of Fame</h1>
      <p className="text-sm text-ink/60 mb-1">
        Admin-only. To feature a new post, browse to it anywhere in the app and tap "🏛️ Add to
        Hall of Fame" — that button only shows up for you, on any photo/video post. This page is
        just for reviewing or removing what's already featured.
      </p>
      <p className="text-xs text-ink/40 mb-6">
        Each month's 5 most-liked eligible posts are added automatically on the 1st — those show
        up here too, tagged "Monthly top 5".
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {entries === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-ink/50 text-sm">Nothing featured yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="card p-3 flex items-center gap-3">
              {entry.mediaUrl && entry.type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.mediaUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-ink flex items-center justify-center text-white flex-shrink-0">
                  ▶
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{entry.ownerName}</p>
                <p className="text-xs text-ink/50">
                  {entry.likeCount} likes ·{" "}
                  {entry.hallOfFameSource === "monthly-top"
                    ? `Monthly top 5${entry.hallOfFameMonth ? ` (${entry.hallOfFameMonth})` : ""}`
                    : "Team pick"}
                </p>
              </div>
              <Link href={`/post/${entry.id}`} className="text-xs underline text-ink/50 hover:text-ink flex-shrink-0">
                View
              </Link>
              <button
                onClick={() => handleRemove(entry.id)}
                disabled={removingId === entry.id}
                className="text-xs text-red-600 hover:underline flex-shrink-0 disabled:opacity-50"
              >
                {removingId === entry.id ? "…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
