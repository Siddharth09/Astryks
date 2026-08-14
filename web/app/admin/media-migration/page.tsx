"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const migratePrivatePostMediaFn = httpsCallable(functions, "migratePrivatePostMedia");

type Result = { migrated: number; skipped: number; failed: number };

// One-time (but safe-to-repeat) admin action: moves any private post's media file off the old
// flat posts/{ownerId}/{fileName} Storage path — which storage.rules can't gate by visibility,
// since it has no postId in it — onto the new posts/{ownerId}/{postId}/{fileName} layout, which
// storage.rules DOES check against the post's visibility. Until this has run, a private post
// created before that Storage rules fix shipped still has its media reachable by anyone with
// the raw file URL. Idempotent: anything already on the new layout (already migrated, or
// created after the fix shipped) is skipped, not touched, so running this more than once is
// harmless — it's here as a page instead of a one-off browser-console call so there's no risk
// of a copy/paste mistake against production data.
export default function AdminMediaMigrationPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function run() {
    if (
      !confirm(
        "Move any private post's media off the old public Storage path onto the new gated one? " +
          "Safe to run more than once — already-migrated and public posts are left alone."
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await migratePrivatePostMediaFn();
      setResult(res.data as Result);
    } catch (err: any) {
      setError(err.message ?? "Migration failed — check the Cloud Functions logs for details.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24 px-4">
      <h1 className="font-display text-2xl font-semibold mb-2">Private post media migration</h1>
      <p className="text-sm text-ink/60 mb-6">
        Admin-only, one-time (but safe to repeat) maintenance action. Private posts uploaded before Storage rules
        could check a post's visibility have their media sitting at the old flat{" "}
        <code className="text-xs">posts/{"{ownerId}"}/{"{fileName}"}</code> path — reachable by anyone with the
        file URL, even though the post itself is private. Running this copies each such post's media onto the new{" "}
        <code className="text-xs">posts/{"{ownerId}"}/{"{postId}"}/{"{fileName}"}</code> layout (which the current
        Storage rules do gate by visibility), repoints the post's <code className="text-xs">mediaUrl</code>, and
        deletes the old public copy. Public posts aren't touched — there was never anything to fix there.
      </p>

      <button
        onClick={run}
        disabled={running}
        className="text-sm rounded-lg bg-brand text-white font-medium px-4 py-2.5 disabled:opacity-50"
      >
        {running ? "Migrating…" : "Run migration"}
      </button>

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      {result && (
        <div className="card p-4 mt-6">
          <p className="text-sm font-medium mb-1">Done.</p>
          <p className="text-sm text-ink/70">
            {result.migrated} post{result.migrated === 1 ? "" : "s"} migrated · {result.skipped} already on the new
            layout · {result.failed} failed{result.failed > 0 ? " (check Cloud Functions logs for which ones)" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
