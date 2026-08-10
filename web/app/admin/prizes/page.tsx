"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { flagEmoji } from "@/lib/geo";

const getPrizeWinnersFn = httpsCallable(functions, "getPrizeWinners");
const markPrizeWinnerPaidFn = httpsCallable(functions, "markPrizeWinnerPaid");
const runPrizeReportNowFn = httpsCallable(functions, "runPrizeReportNow");
const approvePrizeWinnerAnnouncementFn = httpsCallable(functions, "approvePrizeWinnerAnnouncement");

// Simple allowlist for who can review this — same as the other admin pages.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

const METHOD_LABELS: Record<string, string> = { bank: "Bank transfer", payid: "PayID" };

export default function AdminPrizesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [winners, setWinners] = useState<any[] | null>(null);
  const [updatingMonth, setUpdatingMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningReport, setRunningReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);
  const [approvingMonth, setApprovingMonth] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  async function load() {
    const result = await getPrizeWinnersFn();
    setWinners((result.data as any).winners);
  }

  useEffect(() => {
    if (user && ADMIN_EMAILS.includes(user.email ?? "")) load();
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!ADMIN_EMAILS.includes(user.email ?? "")) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function runReportNow() {
    setRunningReport(true);
    setReportResult(null);
    setError(null);
    try {
      const result = await runPrizeReportNowFn();
      const data = result.data as any;
      setReportResult(
        data.count === 0
          ? "No qualifying posts yet this month — emailed you the details."
          : `Emailed you the full ranked list — ${data.count} qualifying post(s) so far, current leader: ${data.leader}. ` +
            `${data.subscriberCount} active subscriber(s) right now — check Stripe/App Store/Play Console for actual revenue.`
      );
    } catch (err: any) {
      setError(err.message ?? "Couldn't run the report.");
    } finally {
      setRunningReport(false);
    }
  }

  // The actual "seeking your approval first" gate — nothing reaches the winner (no email, no
  // in-app message) and the public site never shows them as the winner until you click this.
  // One-way: once sent, there's no un-sending the congratulations email.
  async function approveAndNotify(month: string, ownerName: string) {
    if (
      !confirm(
        `Send ${ownerName} their congratulations email + in-app message now, and show them publicly as this ` +
          `month's winner? This can't be undone.`
      )
    ) {
      return;
    }
    setApprovingMonth(month);
    setApproveError(null);
    try {
      await approvePrizeWinnerAnnouncementFn({ month });
      setWinners((prev) =>
        prev ? prev.map((w) => (w.month === month ? { ...w, announced: true } : w)) : prev
      );
    } catch (err: any) {
      setApproveError(err.message ?? "Couldn't notify the winner.");
    } finally {
      setApprovingMonth(null);
    }
  }

  async function togglePaid(month: string, currentlyPaid: boolean) {
    setUpdatingMonth(month);
    setError(null);
    try {
      await markPrizeWinnerPaidFn({ month, paid: !currentlyPaid });
      setWinners((prev) =>
        prev ? prev.map((w) => (w.month === month ? { ...w, paid: !currentlyPaid } : w)) : prev
      );
    } catch (err: any) {
      setError(err.message ?? "Couldn't update that.");
    } finally {
      setUpdatingMonth(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24 px-4">
      <h1 className="font-display text-2xl font-semibold mb-2">Prize winners</h1>
      <p className="text-sm text-ink/60 mb-1">
        Admin-only. One entry per month, most recent first — the automated monthly job picks the
        winner and drops their payout details here if they've shared them via Messages.
      </p>
      <p className="text-xs text-ink/40 mb-4">
        Reminder: transfers to overseas winners may be subject to market FX rates and international
        transfer fees — check with your bank/provider before sending.
      </p>

      <div className="mb-6">
        <button
          onClick={runReportNow}
          disabled={runningReport}
          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {runningReport ? "Running…" : "Email me this month's leaderboard now"}
        </button>
        {reportResult && <p className="text-xs text-ink/50 mt-2">{reportResult}</p>}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {approveError && <p className="text-sm text-red-600 mb-4">{approveError}</p>}

      {winners === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : winners.length === 0 ? (
        <p className="text-ink/50 text-sm">No winners recorded yet — check back after the 1st of next month.</p>
      ) : (
        <div className="space-y-4">
          {winners.map((w) => (
            <div key={w.month} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-ink/50 mb-2">
                <span className="font-medium text-ink/70">{w.monthLabel}</span>
                <span>·</span>
                <span>{w.likeCount} likes</span>
                <span className="ml-auto flex items-center gap-2">
                  {w.announced && (
                    <span className="text-xs font-medium text-ink/50">✓ Winner notified</span>
                  )}
                  {w.paid && <span className="text-xs font-medium text-brand">✓ Paid</span>}
                </span>
              </div>

              {!w.announced && !w.payoutHeld && (
                <div className="rounded-lg bg-highlight/15 border border-highlight/40 p-3 mb-3 text-xs text-ink/80">
                  <strong>Waiting on your approval.</strong> Nobody has been told about this yet — not the winner,
                  not the public site. Review everything below, then click "Approve & notify winner" when ready.
                </div>
              )}

              {w.payoutHeld && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-3 text-xs text-red-900">
                  <strong>Payout on hold.</strong> PRIZE_PAYOUTS_ENABLED is set to false in the backend, so this
                  winner has not been publicly announced and should not be paid or told they've won yet — review
                  the winner and the current Official Rules before flipping that on.
                </div>
              )}

              <div className="flex items-center gap-3 mb-3">
                {w.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.mediaUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {w.ownerName} {flagEmoji(w.countryCode)}
                  </p>
                  {w.title && <p className="text-xs text-ink/50 truncate">"{w.title}"</p>}
                  <Link href={`/post/${w.postId}`} className="text-xs underline text-ink/50">
                    View post
                  </Link>
                </div>
              </div>

              {w.payout ? (
                <div className="bg-paper/60 rounded-lg p-3 mb-3 text-sm">
                  <p className="text-xs text-ink/50 mb-0.5">{METHOD_LABELS[w.payout.method] ?? w.payout.method}</p>
                  <p className="font-medium">{w.payout.details}</p>
                </div>
              ) : (
                <p className="text-xs text-ink/40 mb-3">
                  No payout details on file yet — ask {w.ownerName} for them via Messages.
                </p>
              )}

              {w.nominees?.length > 1 && (
                <details className="mb-3 text-xs text-ink/50">
                  <summary className="cursor-pointer">
                    {w.nominees.length - 1} other nominee{w.nominees.length - 1 === 1 ? "" : "s"} that month
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {w.nominees.slice(1).map((n: any) => (
                      <li key={n.postId}>
                        {n.ownerName} — {n.likeCount} likes
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex flex-wrap gap-2">
                {!w.announced && !w.payoutHeld && (
                  <button
                    onClick={() => approveAndNotify(w.month, w.ownerName)}
                    disabled={approvingMonth === w.month}
                    className="text-xs rounded-lg bg-brand text-white font-medium px-3 py-1.5 disabled:opacity-50"
                  >
                    {approvingMonth === w.month ? "Sending…" : "Approve & notify winner"}
                  </button>
                )}
                <button
                  onClick={() => togglePaid(w.month, !!w.paid)}
                  disabled={updatingMonth === w.month}
                  className={
                    w.paid
                      ? "btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                      : "text-xs rounded-lg bg-ink text-white font-medium px-3 py-1.5 disabled:opacity-50"
                  }
                >
                  {updatingMonth === w.month ? "Updating…" : w.paid ? "Mark as unpaid" : "Mark as paid"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
