"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const getReportsFn = httpsCallable(functions, "getReports");
const resolveReportFn = httpsCallable(functions, "resolveReport");
const backfillLessonPlaybackFn = httpsCallable(functions, "backfillLessonPlayback");
const backfillYoutubeLinkPreviewsFn = httpsCallable(functions, "backfillYoutubeLinkPreviews");
const sendTestWelcomeEmailFn = httpsCallable(functions, "sendTestWelcomeEmail");
const sendTestNewLifecycleEmailsFn = httpsCallable(functions, "sendTestNewLifecycleEmails");

const TARGET_LABELS: Record<string, string> = { post: "Post", comment: "Comment", user: "User" };

// Matches the 24-hour response commitment in terms/page.tsx §10 — flags a report as overdue
// once it's been pending longer than that, so it's visible at a glance rather than something an
// admin has to work out by eye from a raw timestamp.
function reportAge(ms: number | null): { label: string; overdue: boolean } {
  if (!ms) return { label: "", overdue: false };
  const diff = Date.now() - ms;
  const hours = diff / 3600000;
  const mins = Math.floor(diff / 60000);
  const label = hours < 1 ? `${Math.max(mins, 1)}m ago` : hours < 24 ? `${Math.floor(hours)}h ago` : `${Math.floor(hours / 24)}d ago`;
  return { label, overdue: hours >= 24 };
}

export default function AdminReportsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [reports, setReports] = useState<any[] | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const [backfillingYoutube, setBackfillingYoutube] = useState(false);
  const [youtubeBackfillResult, setYoutubeBackfillResult] = useState<string | null>(null);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<string | null>(null);
  const [sendingNewLifecycleEmails, setSendingNewLifecycleEmails] = useState(false);
  const [newLifecycleEmailsResult, setNewLifecycleEmailsResult] = useState<string | null>(null);

  // Sends the real welcome-email template to your own inbox, so you can see exactly how it
  // renders in an actual mail client (Gmail/Apple Mail/etc. all render HTML email slightly
  // differently — a browser preview isn't a substitute for the real thing).
  async function handleSendTestEmail() {
    setSendingTestEmail(true);
    setTestEmailResult(null);
    try {
      const result = await sendTestWelcomeEmailFn();
      setTestEmailResult(`Sent to ${(result.data as any)?.sentTo ?? "your inbox"} — check your email.`);
    } catch (err: any) {
      setTestEmailResult(`Error: ${err.message ?? "Something went wrong."}`);
    } finally {
      setSendingTestEmail(false);
    }
  }

  // Previews the prize-nomination and account-deletion emails. Sign-out isn't included since
  // it's already trivially testable for real — just log out.
  async function handleSendNewLifecycleEmails() {
    setSendingNewLifecycleEmails(true);
    setNewLifecycleEmailsResult(null);
    try {
      const result = await sendTestNewLifecycleEmailsFn();
      setNewLifecycleEmailsResult(`Sent ${(result.data as any)?.count ?? 2} emails to ${(result.data as any)?.sentTo ?? "your inbox"}.`);
    } catch (err: any) {
      setNewLifecycleEmailsResult(`Error: ${err.message ?? "Something went wrong."}`);
    } finally {
      setSendingNewLifecycleEmails(false);
    }
  }

  // One-time maintenance action — moves any lesson's Bunny playback credentials that are
  // still sitting on the old public lessons doc into the gated lessonPlayback doc instead.
  // Safe to click more than once (a no-op once everything's already migrated).
  async function handleBackfill() {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const result = await backfillLessonPlaybackFn();
      const migrated = (result.data as any)?.migrated ?? 0;
      setMigrateResult(
        migrated > 0
          ? `Done — moved ${migrated} lesson${migrated === 1 ? "" : "s"} to the gated location.`
          : "Done — nothing needed migrating (already up to date)."
      );
    } catch (err: any) {
      setMigrateResult(`Error: ${err.message ?? "Something went wrong."}`);
    } finally {
      setMigrating(false);
    }
  }

  // One-time maintenance action — refetches thumbnails for YouTube link posts shared before
  // fetchLinkPreview switched to the oEmbed API, which were stuck blank from the old HTML
  // scraper hitting Google's cookie-consent interstitial. Safe to click more than once.
  async function handleBackfillYoutube() {
    setBackfillingYoutube(true);
    setYoutubeBackfillResult(null);
    try {
      const result = await backfillYoutubeLinkPreviewsFn();
      const { checked, fixed } = result.data as any;
      setYoutubeBackfillResult(`Done — checked ${checked} YouTube post${checked === 1 ? "" : "s"}, fixed ${fixed}.`);
    } catch (err: any) {
      setYoutubeBackfillResult(`Error: ${err.message ?? "Something went wrong."}`);
    } finally {
      setBackfillingYoutube(false);
    }
  }

  async function load() {
    const result = await getReportsFn();
    setReports((result.data as any).reports);
  }

  useEffect(() => {
    if (user && isAdmin(user.email)) load();
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleResolve(reportId: string, action: "delete" | "eject" | "dismiss") {
    if (action === "delete" && !confirm("Delete the reported content? This can't be undone.")) return;
    if (action === "eject" && !confirm("Delete the reported content AND permanently delete the responsible member's account? This can't be undone.")) return;
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

      <div className="card p-4 mb-6 bg-paper/60">
        <p className="text-sm font-medium mb-1">One-time maintenance: lesson playback migration</p>
        <p className="text-xs text-ink/50 mb-3">
          Moves any lesson's video credentials off the public lessons doc and into the locked-down
          location, so only subscribers can actually load them. New lessons handle this
          automatically — this button is just for lessons created before this fix. Safe to click
          more than once.
        </p>
        <button onClick={handleBackfill} disabled={migrating} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">
          {migrating ? "Running…" : "Run migration"}
        </button>
        {migrateResult && <p className="text-xs text-ink/60 mt-2">{migrateResult}</p>}
      </div>

      <div className="card p-4 mb-6 bg-paper/60">
        <p className="text-sm font-medium mb-1">One-time maintenance: YouTube link thumbnails</p>
        <p className="text-xs text-ink/50 mb-3">
          Refetches thumbnails for YouTube links shared before we switched to YouTube's oEmbed
          API — those are stuck with a blank placeholder. New links handle this automatically.
          Safe to click more than once.
        </p>
        <button
          onClick={handleBackfillYoutube}
          disabled={backfillingYoutube}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {backfillingYoutube ? "Running…" : "Run migration"}
        </button>
        {youtubeBackfillResult && <p className="text-xs text-ink/60 mt-2">{youtubeBackfillResult}</p>}
      </div>

      <div className="card p-4 mb-6 bg-paper/60">
        <p className="text-sm font-medium mb-1">Preview the welcome email</p>
        <p className="text-xs text-ink/50 mb-3">
          Sends the exact email a new member gets, straight to your own inbox — the fastest way
          to check how it actually renders (fonts/colors/logo can render slightly differently
          across Gmail, Apple Mail, etc.).
        </p>
        <button
          onClick={handleSendTestEmail}
          disabled={sendingTestEmail}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {sendingTestEmail ? "Sending…" : "Send me a test copy"}
        </button>
        {testEmailResult && <p className="text-xs text-ink/60 mt-2">{testEmailResult}</p>}
      </div>

      <div className="card p-4 mb-6 bg-paper/60">
        <p className="text-sm font-medium mb-1">Preview prize-nomination & account-deletion emails</p>
        <p className="text-xs text-ink/50 mb-3">
          Sends both to your own inbox. Sign-out isn't included here — it's already testable for
          real by just logging out and back in.
        </p>
        <button
          onClick={handleSendNewLifecycleEmails}
          disabled={sendingNewLifecycleEmails}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {sendingNewLifecycleEmails ? "Sending…" : "Send me test copies"}
        </button>
        {newLifecycleEmailsResult && <p className="text-xs text-ink/60 mt-2">{newLifecycleEmailsResult}</p>}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {reports === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-ink/50 text-sm">No pending reports. Nice and quiet.</p>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => {
            const age = reportAge(r.createdAt);
            return (
            <div key={r.id} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-ink/50 mb-2 flex-wrap">
                <span className="font-medium text-ink/70">{TARGET_LABELS[r.targetType] ?? r.targetType}</span>
                <span>·</span>
                <span>{r.reason}</span>
                <span>·</span>
                <span>reported by {r.reporterName}</span>
                {age.label && (
                  <>
                    <span>·</span>
                    <span className={age.overdue ? "text-red-600 font-medium" : ""}>
                      {age.overdue ? `overdue — ${age.label}` : age.label}
                    </span>
                  </>
                )}
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
                      <div className="flex gap-3 mt-1">
                        {r.targetType === "post" && (
                          <Link href={`/post/${r.targetId}`} className="text-xs underline">
                            View post
                          </Link>
                        )}
                        {r.preview.ownerId && (
                          <Link href={`/user/${r.preview.ownerId}`} className="text-xs underline">
                            View author's profile
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink/40 mb-3">Content no longer exists.</p>
              )}

              <div className="flex gap-2 flex-wrap">
                {r.targetType !== "user" && (
                  <button
                    onClick={() => handleResolve(r.id, "delete")}
                    disabled={resolvingId === r.id}
                    className="text-xs rounded-lg bg-red-600 text-white font-medium px-3 py-1.5 disabled:opacity-50"
                  >
                    Delete content
                  </button>
                )}
                {r.preview?.ownerId && (
                  <button
                    onClick={() => handleResolve(r.id, "eject")}
                    disabled={resolvingId === r.id}
                    className="text-xs rounded-lg bg-red-800 text-white font-medium px-3 py-1.5 disabled:opacity-50"
                    title="Deletes the content (if any) and permanently deletes this member's account"
                  >
                    {r.targetType === "user" ? "Eject member" : "Delete & eject author"}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
