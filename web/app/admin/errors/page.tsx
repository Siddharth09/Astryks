"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const getClientErrorsFn = httpsCallable(functions, "getClientErrors");
const resolveClientErrorFn = httpsCallable(functions, "resolveClientError");

const PLATFORM_LABELS: Record<string, string> = { web: "Web", ios: "iOS", android: "Android" };

function timeAgo(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminErrorsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [errors, setErrors] = useState<any[] | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setErrors(null);
    try {
      const result = await getClientErrorsFn({ includeResolved });
      setErrors((result.data as any).errors);
    } catch (err: any) {
      setLoadError(err.message ?? "Couldn't load crash reports.");
    }
  }

  useEffect(() => {
    if (user && isAdmin(user.email)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, includeResolved]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleResolve(errorId: string) {
    setResolvingId(errorId);
    try {
      await resolveClientErrorFn({ errorId });
      setErrors((prev) => (prev ? prev.filter((e) => e.id !== errorId) : prev));
    } catch (err: any) {
      setLoadError(err.message ?? "Couldn't mark that resolved.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl font-semibold">Crash reports</h1>
        <label className="flex items-center gap-2 text-xs text-ink/50">
          <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      <p className="text-sm text-ink/60 mb-6">
        Unhandled errors reported automatically from the web app and the iOS/Android app — including
        ones that happen before someone's even logged in. Most recent first, capped at 200.
      </p>

      {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}

      {errors === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : errors.length === 0 ? (
        <p className="text-ink/50 text-sm">
          {includeResolved ? "No crash reports at all. Nice and quiet." : "No unresolved crash reports. Nice and quiet."}
        </p>
      ) : (
        <div className="space-y-3">
          {errors.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-ink/50 mb-1.5">
                <span className="font-medium text-ink/70">{PLATFORM_LABELS[e.platform] ?? e.platform}</span>
                <span>·</span>
                <span>{timeAgo(e.createdAt)}</span>
                {e.screen && (
                  <>
                    <span>·</span>
                    <span className="truncate">{e.screen}</span>
                  </>
                )}
                {e.userEmail && (
                  <>
                    <span>·</span>
                    <span className="truncate">{e.userEmail}</span>
                  </>
                )}
              </div>
              <p className="text-sm font-medium mb-1">{e.message}</p>
              {e.stack && (
                <button
                  onClick={() => setExpandedId((prev) => (prev === e.id ? null : e.id))}
                  className="text-xs text-ink/40 underline mb-2"
                >
                  {expandedId === e.id ? "Hide stack trace" : "Show stack trace"}
                </button>
              )}
              {expandedId === e.id && e.stack && (
                <pre className="text-[11px] bg-paper/60 rounded-lg p-3 mb-2 overflow-x-auto whitespace-pre-wrap">
                  {e.stack}
                </pre>
              )}
              {!e.resolved && (
                <button
                  onClick={() => handleResolve(e.id)}
                  disabled={resolvingId === e.id}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  {resolvingId === e.id ? "Marking resolved…" : "Mark resolved"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
