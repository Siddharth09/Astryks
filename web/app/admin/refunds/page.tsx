"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";

const getRefundRequestsFn = httpsCallable(functions, "getRefundRequests");
const approveRefundFn = httpsCallable(functions, "approveRefund");

// Simple allowlist for who can review this — same as the other admin pages.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

type RefundRequest = {
  id: string;
  uid: string;
  userName: string;
  userEmail: string;
  status: "pending" | "processing" | "approved" | "denied";
  totalDisplay: string;
  refundedDisplay: string | null;
  requestedAt: number | null;
  approvedAt: number | null;
};

export default function AdminRefundsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [requests, setRequests] = useState<RefundRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function load() {
    try {
      const result = await getRefundRequestsFn();
      setRequests((result.data as any).requests);
    } catch (err: any) {
      setError(err.message ?? "Couldn't load refund requests.");
    }
  }

  useEffect(() => {
    if (user && ADMIN_EMAILS.includes(user.email ?? "")) load();
  }, [user]);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!ADMIN_EMAILS.includes(user.email ?? "")) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  // The actual money-moving action — one click, no partial amounts, nothing to type in. It
  // refunds every charge Stripe has on file for this person and cancels their subscription
  // immediately. This can't be undone, so the confirmation spells out exactly what's about to
  // happen before it does.
  async function approve(r: RefundRequest) {
    if (
      !confirm(
        `Refund ${r.userName} their full ${r.totalDisplay} and cancel their subscription now? This actually ` +
          `moves money and can't be undone.`
      )
    ) {
      return;
    }
    setApprovingId(r.id);
    setError(null);
    try {
      const result = await approveRefundFn({ requestId: r.id });
      const refundedTotal = (result.data as any).refundedTotal as string;
      setRequests((prev) =>
        prev
          ? prev.map((req) =>
              req.id === r.id ? { ...req, status: "approved", refundedDisplay: refundedTotal } : req
            )
          : prev
      );
    } catch (err: any) {
      setError(err.message ?? "Couldn't approve that refund.");
    } finally {
      setApprovingId(null);
    }
  }

  const pending = requests?.filter((r) => r.status === "pending") ?? [];
  const past = requests?.filter((r) => r.status !== "pending") ?? [];

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24 px-4">
      <h1 className="font-display text-2xl font-semibold mb-2">Refund requests</h1>
      <p className="text-sm text-ink/60 mb-6">
        Admin-only. Members can only submit a request within the 90-day money-back guarantee window (enforced
        server-side, so nothing shows up here otherwise). Approving a request refunds everything that member has
        ever been billed and cancels their subscription immediately — full amount, no partial refunds, no
        questions asked. Web/Stripe subscribers only; mobile App Store/Google Play subscribers need to request a
        refund from Apple/Google directly.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {requests === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : (
        <>
          <div className="mb-8">
            <h2 className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">
              Waiting on you ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <p className="text-ink/50 text-sm">Nothing pending right now.</p>
            ) : (
              <div className="space-y-3">
                {pending.map((r) => (
                  <div key={r.id} className="card p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.userName}</p>
                        <p className="text-xs text-ink/50 truncate">{r.userEmail}</p>
                      </div>
                      <p className="font-display text-xl font-semibold flex-shrink-0">{r.totalDisplay}</p>
                    </div>
                    {r.requestedAt && (
                      <p className="text-xs text-ink/40 mb-3">
                        Requested {new Date(r.requestedAt).toLocaleString()}
                      </p>
                    )}
                    <button
                      onClick={() => approve(r)}
                      disabled={approvingId === r.id}
                      className="text-xs rounded-lg bg-brand text-white font-medium px-3 py-1.5 disabled:opacity-50"
                    >
                      {approvingId === r.id ? "Refunding…" : `Refund ${r.totalDisplay} & cancel`}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">History</h2>
            {past.length === 0 ? (
              <p className="text-ink/50 text-sm">No past requests yet.</p>
            ) : (
              <div className="space-y-2">
                {past.map((r) => (
                  <div key={r.id} className="card p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.userName}</p>
                      <p className="text-xs text-ink/40 truncate">{r.userEmail}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {/* "processing" means approveRefund started moving money and then threw partway
                          through (see the catch block in functions/index.js) — it's deliberately left
                          in this state instead of reverting to "pending" or "approved", because some
                          charges may already be refunded in Stripe and a retry could double-refund
                          them. It must never be shown as a completed refund: refundedDisplay is only
                          set on the success path, so falling back to totalDisplay here would claim the
                          full amount was refunded when it might be partial or none at all. */}
                      {r.status === "processing" ? (
                        <p className="text-xs font-medium text-red-600">⚠ Refund interrupted — check Stripe</p>
                      ) : r.status === "denied" ? (
                        <p className="text-xs font-medium text-ink/50">✕ Denied</p>
                      ) : (
                        <p className="text-xs font-medium text-brand">
                          ✓ Refunded {r.refundedDisplay ?? r.totalDisplay}
                        </p>
                      )}
                      {r.approvedAt && (
                        <p className="text-xs text-ink/40">{new Date(r.approvedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
