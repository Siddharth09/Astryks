"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const createBillingPortalSession = httpsCallable(functions, "createBillingPortalSession");
const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");
const requestRefundFn = httpsCallable(functions, "requestRefund");
const getMyRefundStatusFn = httpsCallable(functions, "getMyRefundStatus");

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));
  const [hasStripeAccount, setHasStripeAccount] = useState(false);
  const [refundStatus, setRefundStatus] = useState<string | null>(null);
  const [refundTotal, setRefundTotal] = useState<string | null>(null);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setHasStripeAccount(!!snap.data()?.stripeCustomerId);
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
    });
    getMyRefundStatusFn()
      .then((result) => {
        const data = result.data as { status: string | null; totalDisplay?: string };
        setRefundStatus(data.status);
        setRefundTotal(data.totalDisplay ?? null);
      })
      .catch(() => {
        // Not fatal — the refund section just won't show a past-request status.
      });
  }, [user]);

  async function manageSubscription() {
    setLoading(true);
    const result = await createBillingPortalSession({ returnUrl: `${location.origin}/me` });
    location.href = (result.data as { url: string }).url;
  }

  async function subscribe() {
    setLoading(true);
    const result = await createCheckoutSession({
      successUrl: `${location.origin}/me`,
      cancelUrl: `${location.origin}/me`,
    });
    location.href = (result.data as { url: string }).url;
  }

  // "No questions asked" on the backend, but still worth a light confirmation here since this
  // immediately alerts the team and, once approved, refunds every charge on file and cancels
  // the subscription — not something to trigger by an accidental tap.
  async function requestRefund() {
    if (
      !confirm(
        "Request a full refund of everything you've ever paid Astryks, and cancel your subscription once it's " +
          "approved? Our team reviews every request personally — you'll hear back soon."
      )
    ) {
      return;
    }
    setRequestingRefund(true);
    setRefundError(null);
    try {
      const result = await requestRefundFn();
      const data = result.data as { totalDisplay: string };
      setRefundStatus("pending");
      setRefundTotal(data.totalDisplay);
    } catch (err: any) {
      setRefundError(err.message ?? "Couldn't submit that request — please try again.");
    } finally {
      setRequestingRefund(false);
    }
  }

  return (
    <div className="space-y-3 mb-6">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Your plan</p>
          <p className="text-xs text-ink/60">
            {status === "active" ? `Active — ${pricing.display}` : status === "canceled" ? "Canceled" : "Not subscribed"}
          </p>
        </div>
        {status === "active" ? (
          <button onClick={manageSubscription} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            Manage
          </button>
        ) : (
          <button onClick={subscribe} disabled={loading} className="btn-primary text-xs px-3 py-2">
            Subscribe
          </button>
        )}
      </div>

      {status === "active" && (
        <p className="text-xs text-ink/40 px-1">
          "Manage" opens Stripe's secure billing page, where you can see every past payment, update your card, or
          cancel any time.
        </p>
      )}

      {hasStripeAccount && (
        <div className="card p-4">
          <p className="text-sm font-medium mb-1">Refunds</p>
          {refundStatus === "pending" ? (
            <p className="text-xs text-ink/60">
              Your refund request{refundTotal ? ` for ${refundTotal}` : ""} is being reviewed — we'll be in touch
              soon, and you'll get a message here once it's approved.
            </p>
          ) : refundStatus === "approved" ? (
            <p className="text-xs text-ink/60">
              Your last refund request was approved{refundTotal ? ` — ${refundTotal} refunded` : ""}. Want to
              request another for anything billed since then? Use the button below.
            </p>
          ) : (
            <p className="text-xs text-ink/60 mb-3">
              Changed your mind? You can request a full refund of everything you've ever paid — we review every
              request personally, no need to explain why.
            </p>
          )}
          {refundStatus !== "pending" && (
            <button
              onClick={requestRefund}
              disabled={requestingRefund}
              className="btn-secondary text-xs px-3 py-2 mt-2"
            >
              {requestingRefund ? "Submitting…" : "Request a refund"}
            </button>
          )}
          {refundError && <p className="text-xs text-red-600 mt-2">{refundError}</p>}
        </div>
      )}
    </div>
  );
}
