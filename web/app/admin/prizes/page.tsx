"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { flagEmoji } from "@/lib/geo";
import { isAdmin } from "@/lib/admin";

const getPrizeWinnersFn = httpsCallable(functions, "getPrizeWinners");
const markPrizeWinnerPaidFn = httpsCallable(functions, "markPrizeWinnerPaid");
const runPrizeReportNowFn = httpsCallable(functions, "runPrizeReportNow");
const approvePrizeWinnerAnnouncementFn = httpsCallable(functions, "approvePrizeWinnerAnnouncement");
const sendPayoutReminderFn = httpsCallable(functions, "sendPayoutReminder");
const payWinnerViaStripeFn = httpsCallable(functions, "payWinnerViaStripe");

const METHOD_LABELS: Record<string, string> = { bank: "Bank transfer", payid: "PayID" };

// Matches PRIZE_AUD in functions/index.js — kept as a plain constant here too since this is a
// display-only value (the backend never round-trips it back to the client), not something to
// fetch just to show "AU$1,000".
const PRIZE_AMOUNT = 1000;

function PayField({
  label,
  value,
  fieldKey,
  copiedField,
  onCopy,
}: {
  label: string;
  value: string;
  fieldKey: string;
  copiedField: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-white rounded-md border border-line/10 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] text-ink/40 leading-none mb-0.5">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
      <button
        onClick={() => onCopy(fieldKey, value)}
        className="text-xs rounded-md bg-ink/5 hover:bg-ink/10 text-ink/70 font-medium px-2 py-1 flex-shrink-0"
      >
        {copiedField === fieldKey ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function AdminPrizesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [winners, setWinners] = useState<any[] | null>(null);
  const [updatingMonth, setUpdatingMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningReport, setRunningReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);
  const [approvingMonth, setApprovingMonth] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [remindingPostId, setRemindingPostId] = useState<string | null>(null);
  const [reminderSentFor, setReminderSentFor] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [payingMonth, setPayingMonth] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  async function load() {
    const result = await getPrizeWinnersFn();
    setWinners((result.data as any).winners);
  }

  useEffect(() => {
    if (user && isAdmin(user.email)) load();
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
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

  // Copies straight from the payout doc the winner themselves submitted (see
  // submitPrizePayoutDetails / app/messages/[conversationId]/page.tsx) — never retyped by hand
  // anywhere along the way, so there's no transcription step where a digit could get fat-
  // fingered before it ends up in your bank's transfer form.
  async function copyField(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      alert("Couldn't copy — your browser may be blocking clipboard access. Value:\n\n" + value);
    }
  }

  async function sendReminder(postId: string) {
    setRemindingPostId(postId);
    try {
      await sendPayoutReminderFn({ postId });
      setReminderSentFor((prev) => ({ ...prev, [postId]: true }));
    } catch (err: any) {
      alert(err.message ?? "Couldn't send the reminder.");
    } finally {
      setRemindingPostId(null);
    }
  }

  // The actual money-moving action — one click, no manual bank form. Only ever shown once the
  // winner has finished Stripe's own onboarding (payoutAccount.payoutsEnabled), so there's
  // nothing to accidentally send to an account that isn't ready to receive it.
  async function payViaStripe(month: string, ownerName: string) {
    if (!confirm(`Send AU$${PRIZE_AMOUNT} to ${ownerName} via Stripe right now? This actually moves money.`)) {
      return;
    }
    setPayingMonth(month);
    setPayError(null);
    try {
      await payWinnerViaStripeFn({ month });
      setWinners((prev) => (prev ? prev.map((w) => (w.month === month ? { ...w, paid: true, paidVia: "stripe" } : w)) : prev));
    } catch (err: any) {
      setPayError(err.message ?? "Couldn't send that payment.");
    } finally {
      setPayingMonth(null);
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
      {payError && <p className="text-sm text-red-600 mb-4">{payError}</p>}

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

              {w.payoutAccount?.payoutsEnabled && !w.paid && (
                <div className="rounded-lg bg-brandLight border border-brand/30 p-3 mb-3">
                  <p className="text-xs text-ink/70 mb-2">
                    {w.ownerName} has direct deposit set up via Stripe — this actually sends the money, no manual
                    bank form needed.
                  </p>
                  <button
                    onClick={() => payViaStripe(w.month, w.ownerName)}
                    disabled={payingMonth === w.month}
                    className="text-xs rounded-lg bg-brand text-white font-medium px-3 py-1.5 disabled:opacity-50"
                  >
                    {payingMonth === w.month ? "Sending…" : `Pay AU$${PRIZE_AMOUNT} via Stripe`}
                  </button>
                </div>
              )}

              {w.paidVia === "stripe" && (
                <p className="text-xs text-ink/40 mb-3">Sent via Stripe{w.stripeTransferId ? ` (${w.stripeTransferId})` : ""}.</p>
              )}

              {w.payout ? (
                <div className="bg-paper/60 rounded-lg p-3 mb-3 text-sm">
                  <p className="text-xs text-ink/50 mb-2">
                    {w.payoutAccount?.payoutsEnabled
                      ? "Manual fallback, if you'd rather not use Stripe for this one:"
                      : "Ready to pay — copy each field straight into your bank's transfer form rather than retyping " +
                        "them, so nothing gets mistyped along the way."}
                  </p>
                  <div className="space-y-1.5">
                    <PayField
                      label="Amount"
                      value={`AU$${PRIZE_AMOUNT}`}
                      fieldKey={`${w.month}-amount`}
                      copiedField={copiedField}
                      onCopy={copyField}
                    />
                    <PayField
                      label={METHOD_LABELS[w.payout.method] ?? w.payout.method}
                      value={w.payout.details}
                      fieldKey={`${w.month}-details`}
                      copiedField={copiedField}
                      onCopy={copyField}
                    />
                    <PayField
                      label="Reference"
                      value={`Astryks Prize ${w.monthLabel}`}
                      fieldKey={`${w.month}-reference`}
                      copiedField={copiedField}
                      onCopy={copyField}
                    />
                  </div>
                  <p className="text-xs text-ink/40 mt-2">
                    Overseas? Transfers from Australia may be subject to market FX rates and international
                    transfer fees — check with your bank before sending.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg bg-paper/60 p-3 mb-3">
                  <p className="text-xs text-ink/50 mb-2">
                    No payout details on file yet — {w.ownerName} hasn't shared a bank account or PayID. Nothing
                    to pay until they do.
                  </p>
                  <button
                    onClick={() => sendReminder(w.postId)}
                    disabled={remindingPostId === w.postId || reminderSentFor[w.postId]}
                    className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                  >
                    {remindingPostId === w.postId
                      ? "Sending…"
                      : reminderSentFor[w.postId]
                      ? "Reminder sent"
                      : "Send reminder"}
                  </button>
                </div>
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
