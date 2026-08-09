"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";

const getReportsFn = httpsCallable(functions, "getReports");
const resolveReportFn = httpsCallable(functions, "resolveReport");

// Simple allowlist for who can review reports — same as the other admin pages.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

const TARGET_LABELS: Record<string, string> = { post: "Post", comment: "Comment", user: "User" };

export default function AdminReportsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [reports, setReports] = useState<any[] | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await getReportsFn();
    setReports((result.data as any).reports);
  }

  useEffect(() => {
    if (user && ADMIN_EMAILS.includes(user.email ?? "")) load();
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!ADMIN_EMAILS.includes(user.email ?? "")) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleResolve(reportId: string, action: "delete" | "dismiss") {
    if (action === "delete" && !confirm("Delete the reported content? This can't be undone.")) return;
    setResolvingId(reportId);
    setError(null);
    try {
      await resolveReportFn({ reportId, action });
      setReports((prev) => (prev ? prev.filter((r) => r.id !== reportId) : prev));
    } catch (err: any) {
      setError(err.message ?? "Couldn't resolve that report.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-semibold mb-2">Reports</h1>
      <p className="text-sm text-ink/60 mb-6">
        Admin-only. Pending reports from members, most recent first. Deleting removes the content immediately;
        dismissing clears the report without touching anything.
      </p>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {reports === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-ink/50 text-sm">No pending reports. Nice and quiet.</p>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-ink/50 mb-2">
                <span className="font-medium text-ink/70">{TARGET_LABELS[r.targetType] ?? r.targetType}</span>
                <span>·</span>
                <span>{r.reason}</span>
                <span>·</span>
                <span>reported by {r.reporterName}</span>
              </div>

              {r.details && <p className="text-sm text-ink/70 mb-2">"{r.details}"</p>}

              {r.preview ? (
                <div className="bg-paper/60 rounded-lg p-3 mb-3 text-sm">
                  {r.targetType === "user" ? (
                    <>
                      <p className="font-medium">{r.preview.ownerName ?? "Member"}</p>
                      {r.preview.email && <p className="text-ink/50 text-xs">{r.preview.email}</p>}
                      <Link href={`/user/${r.preview.ownerId}`} className="text-xs underline">
                        View profile
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-ink/50 text-xs mb-1">by {r.preview.ownerName ?? "Member"}</p>
                      <p className="truncate">{r.preview.title || r.preview.body || "(media post)"}</p>
                      {r.targetType === "post" && (
                        <Link href={`/post/${r.targetId}`} className="text-xs underline">
                          View post
                        </Link>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink/40 mb-3">Content no longer exists.</p>
              )}

              <div className="flex gap-2">
                {r.targetType !== "user" && (
                  <button
                    onClick={() => handleResolve(r.id, "delete")}
                    disabled={resolvingId === r.id}
                    className="text-xs rounded-lg bg-red-600 text-white font-medium px-3 py-1.5 disabled:opacity-50"
                  >
                    Delete content
                  </button>
                )}
                <button
                  onClick={() => handleResolve(r.id, "dismiss")}
                  disabled={resolvingId === r.id}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
