"use client";

import { useEffect, useState } from "react";
import { collection, doc, getCountFromServer, getDoc, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { annualFullPriceDisplay, detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const createBillingPortalSession = httpsCallable(functions, "createBillingPortalSession");
const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");
const requestRefundFn = httpsCallable(functions, "requestRefund");
const getMyRefundStatusFn = httpsCallable(functions, "getMyRefundStatus");
const getMyBillingHistoryFn = httpsCallable(functions, "getMyBillingHistory");
const cancelMySubscriptionFn = httpsCallable(functions, "cancelMySubscription");

type Charge = { id: string; amountDisplay: string; date: number; refunded: boolean; fullyRefunded: boolean };

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));
  const [hasStripeAccount, setHasStripeAccount] = useState(false);
  const [refundStatus, setRefundStatus] = useState<string | null>(null);
  const [refundTotal, setRefundTotal] = useState<string | null>(null);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<number | null>(null);
  const [showBilling, setShowBilling] = useState(false);
  const [canceling, setCanceling] = useState(false);
  // Which plan is currently mid-checkout, or null. Previously this page used radio buttons to
  // pick a plan and a separate "Subscribe" button to act on it — same two-step flow that got
  // reported as "clicking Weekly/Annual doesn't do anything" on the home/learn banner. Fixed the
  // same way here: each plan button starts checkout for itself directly.
  const [loadingPlan, setLoadingPlan] = useState<"weekly" | "annual" | null>(null);
  const [progress, setProgress] = useState<{ streakCount: number; xp: number; masteredSubjects: string[]; lessonsCompleted: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const data = snap.data();
      setStatus(data?.subscriptionStatus ?? "none");
      setHasStripeAccount(!!data?.stripeCustomerId);
      setPricing(getLocalizedPricing(data?.countryCode ?? detectCountryCode()));
      setProgress({
        streakCount: data?.streakCount || 0,
        xp: data?.xp || 0,
        masteredSubjects: data?.masteredSubjects || [],
        lessonsCompleted: 0,
      });
    });
    getCountFromServer(query(collection(db, "lessonProgress"), where("uid", "==", user.uid)))
      .then((countSnap) => {
        setProgress((prev) => (prev ? { ...prev, lessonsCompleted: countSnap.data().count } : prev));
      })
      .catch(() => {
        // Not fatal — the progress card just won't show a lesson count.
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
    getMyBillingHistoryFn()
      .then((result) => {
        const data = result.data as { charges: Charge[]; cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null };
        setCharges(data.charges);
        setCancelAtPeriodEnd(data.cancelAtPeriodEnd);
        setCurrentPeriodEnd(data.currentPeriodEnd);
      })
      .catch(() => {
        // Not fatal — the billing history list just won't show.
      });
  }, [user]);

  useEffect(() => {
    // Both "Subscribe" and "Manage" redirect away via `location.href` (to Stripe Checkout or the
    // Billing Portal) — on success there's no chance to reset the loading state, since the page
    // is navigating away. Hitting Back afterward doesn't reload this page fresh: the browser
    // restores it from the back-forward cache exactly as frozen, buttons stuck on "Loading…"
    // included. `pageshow` with `event.persisted` fires specifically on that bfcache restore.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setLoading(false);
        setLoadingPlan(null);
        setBillingError(null);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Both of these used to have no error handling at all — if the callable ever threw (missing
  // Stripe secret, a network blip, an expired auth token), the button just sat there spinning
  // forever with the "disabled" state never clearing and nothing visible to the user, which is
  // indistinguishable from "the button doesn't work." Now any failure surfaces a message and
  // re-enables the button so it can be retried.
  async function manageSubscription() {
    setLoading(true);
    setBillingError(null);
    try {
      const result = await createBillingPortalSession({ returnUrl: `${location.origin}/me` });
      location.href = (result.data as { url: string }).url;
    } catch (err: any) {
      setBillingError(err.message ?? "Couldn't open billing management — please try again.");
      setLoading(false);
    }
  }

  async function subscribe(plan: "weekly" | "annual") {
    if (loadingPlan) return; // already mid-checkout for one plan — ignore taps on the other
    setLoadingPlan(plan);
    setBillingError(null);
    try {
      // Same fix as SubscriptionBanner.tsx: the stored referral code was never actually being
      // sent to createCheckoutSession, so referrerUid was always null and the referrer's $50
      // payout never fired for anyone.
      const referralCode = localStorage.getItem("astryks_referral_code") || undefined;
      const result = await createCheckoutSession({
        plan,
        referralCode,
        successUrl: `${location.origin}/me`,
        cancelUrl: `${location.origin}/me`,
      });
      location.href = (result.data as { url: string }).url;
    } catch (err: any) {
      setBillingError(err.message ?? "Couldn't start checkout — please try again.");
      setLoadingPlan(null);
    }
  }

  // A direct in-app cancel, so it doesn't take a detour through the separate Stripe billing
  // portal just to stop paying. Cancels at the end of the current period (you keep what you
  // already paid for) — a full-refund-and-cancel-immediately is a different, more drastic
  // action, handled by the "Request a refund" flow below instead.
  async function cancelSubscription() {
    if (
      !confirm(
        "Cancel your subscription? You'll keep lesson access until the end of your current billing period, and " +
          "you won't be charged again after that."
      )
    ) {
      return;
    }
    setCanceling(true);
    setBillingError(null);
    try {
      const result = await cancelMySubscriptionFn();
      const data = result.data as { currentPeriodEnd: number | null };
      setCancelAtPeriodEnd(true);
      setCurrentPeriodEnd(data.currentPeriodEnd);
    } catch (err: any) {
      setBillingError(err.message ?? "Couldn't cancel your subscription — please try again.");
    } finally {
      setCanceling(false);
    }
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
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Your plan</p>
            <p className="text-xs text-ink/60">
              {status === "active"
                ? cancelAtPeriodEnd
                  ? `Active until ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "period end"} — ${pricing.display}`
                  : `Active — ${pricing.display}`
                : status === "canceled"
                ? "Canceled — resubscribe any time"
                : "Not subscribed — 10 min free preview in Learn"}
            </p>
          </div>
          {status === "active" && (
            <div className="flex items-center gap-2">
              <button onClick={manageSubscription} disabled={loading} className="btn-secondary text-xs px-3 py-2">
                Manage
              </button>
              {!cancelAtPeriodEnd && (
                <button
                  onClick={cancelSubscription}
                  disabled={canceling}
                  className="text-xs px-3 py-2 text-ink/50 hover:text-ink/80 underline"
                >
                  {canceling ? "Canceling…" : "Cancel"}
                </button>
              )}
            </div>
          )}
        </div>
        {/* Each plan button starts checkout for itself directly — no separate select-then-submit
            step (see loadingPlan comment above for why that flow got reported as broken). */}
        {status !== "active" && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ink/10">
            <button
              onClick={() => subscribe("weekly")}
              disabled={loadingPlan !== null}
              className="btn-primary text-xs px-3 py-2"
            >
              {loadingPlan === "weekly" ? "Loading…" : `${status === "canceled" ? "Resubscribe" : "Subscribe"} Weekly · ${pricing.display}`}
            </button>
            <button
              onClick={() => subscribe("annual")}
              disabled={loadingPlan !== null}
              className="btn-secondary text-xs px-3 py-2"
            >
              {loadingPlan === "annual" ? (
                "Loading…"
              ) : (
                <>
                  {status === "canceled" ? "Resubscribe" : "Subscribe"} Annual ·{" "}
                  <span className="line-through opacity-50">{annualFullPriceDisplay(pricing)}</span> {pricing.annualDisplay}
                </>
              )}
            </button>
          </div>
        )}
        {billingError && <p className="text-xs text-red-600 mt-2">{billingError}</p>}
        {cancelAtPeriodEnd && (
          <p className="text-xs text-ink/40 mt-2">
            Your subscription is set to cancel and won't renew — you'll keep access until then. Changed your
            mind? Use "Manage" to resume it.
          </p>
        )}
      </div>

      {status === "active" && (
        <p className="text-xs text-ink/40 px-1">
          "Manage" opens Stripe's secure billing page to update your card. "Cancel" stops future billing right
          here — either way, you keep access until the end of what you've already paid for.
        </p>
      )}

      {progress && (progress.lessonsCompleted > 0 || progress.streakCount > 0 || progress.masteredSubjects.length > 0) && (
        <div className="card p-4">
          <p className="text-sm font-medium mb-2">Your progress</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-display text-2xl font-black">{progress.lessonsCompleted}</p>
              <p className="text-[11px] text-ink/50">lessons done</p>
            </div>
            <div>
              <p className="font-display text-2xl font-black">{progress.streakCount}</p>
              <p className="text-[11px] text-ink/50">day streak</p>
            </div>
            <div>
              <p className="font-display text-2xl font-black">{progress.masteredSubjects.length}</p>
              <p className="text-[11px] text-ink/50">subjects mastered</p>
            </div>
          </div>
        </div>
      )}

      {hasStripeAccount && charges && charges.length > 0 && (
        <div className="card p-4">
          <button
            onClick={() => setShowBilling((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <p className="text-sm font-medium">Billing history</p>
            <span className="text-ink/40 text-xs">{showBilling ? "Hide" : "Show"}</span>
          </button>
          {showBilling && (
            <div className="mt-3 space-y-2">
              {charges.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-ink/60">{new Date(c.date).toLocaleDateString()}</span>
                  <span className={c.fullyRefunded ? "text-ink/40 line-through" : "text-ink/80"}>
                    {c.amountDisplay}
                  </span>
                  <span className="text-ink/40">
                    {c.fullyRefunded ? "Refunded" : c.refunded ? "Partially refunded" : "Paid"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card p-4">
        <p className="text-sm font-medium mb-1">Refunds</p>
        <p className="text-xs text-ink/40 mb-2">
          90-day money-back guarantee — a full refund, no questions asked, any time within 90 days of
          subscribing.
        </p>
        {!hasStripeAccount ? (
          <p className="text-xs text-ink/60">
            Not subscribed yet, so there's nothing to refund — once you do subscribe, this guarantee kicks in
            automatically.
          </p>
        ) : refundStatus === "pending" ? (
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
            Changed your mind? Within 90 days of subscribing, you can request a full refund of everything
            you've paid — we review every request personally, no need to explain why.
          </p>
        )}
        {hasStripeAccount && refundStatus !== "pending" && (
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
    </div>
  );
}
