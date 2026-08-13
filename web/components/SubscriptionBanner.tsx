"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import TrailersSection from "@/components/TrailersSection";
import { annualFullPriceDisplay, detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));
  // Which plan the "Subscribe" button below actually checks out — defaults to weekly, same as
  // before, but now it's an explicit, visible choice instead of a default hidden behind a small
  // "or save with annual" link underneath.
  const [plan, setPlan] = useState<"weekly" | "annual">("weekly");
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      // Prefer the account's saved country (most reliable once someone's subscribed before,
      // or filled in by the best-effort guess in AuthContext) over a fresh guess.
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
    });
  }, [user]);

  async function handleSubscribe() {
    setLoading(true);
    setBillingError(null);
    try {
      // Without this, a referral code entered via ReferralCodeEntry/ReferralCapture just sat in
      // localStorage forever — createCheckoutSession was never actually told about it, so
      // referrerUid was always null and the referrer's $50-after-90-days payout never fired for
      // anyone, ever. This is what actually wires the two halves of the referral feature together.
      const referralCode = localStorage.getItem("astryks_referral_code") || undefined;
      // Firebase attaches an App Check token to this call (see lib/firebase.ts) — on a fresh
      // page load that means a reCAPTCHA v3 challenge has to run first, and if that's slow or
      // gets blocked (flaky network, a privacy extension, reCAPTCHA itself having a bad moment),
      // the whole call can hang far longer than a normal request with nothing to show for it —
      // this is what caused "stuck on Loading… forever" with no error, distinct from the earlier
      // "fails fast with INTERNAL" incident this same catch block was already handling. A race
      // against a timeout guarantees the button always resolves one way or the other instead of
      // hanging indefinitely — if the real request finishes after the timeout anyway, that's
      // harmless, it just won't be shown to this page load.
      const result = await Promise.race([
        createCheckoutSession({
          plan,
          referralCode,
          successUrl: `${location.origin}/home`,
          cancelUrl: `${location.origin}/home`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("That's taking longer than expected — please try again.")), 15000)
        ),
      ]);
      location.href = (result.data as { url: string }).url;
    } catch (err: any) {
      // Without this, a failed checkout call used to leave the button stuck on "Loading…"
      // forever with no explanation — see Aug 2026 incident where a mistyped Stripe price ID
      // did exactly that for every visitor until someone happened to check the browser console.
      setBillingError(err.message ?? "Couldn't start checkout — please try again.");
      setLoading(false);
    }
  }

  if (status === null || status === "active") return null;

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: "#FFF6F1" }}>
      <div className="flex items-center gap-3">
        <span className="text-xl">✨</span>
        <div className="flex-1">
          <p className="text-sm font-medium">
            {status === "canceled" ? "Your subscription has ended" : "Subscribe to unlock all lessons"}
          </p>
          <p className="text-xs text-ink/60">cancel anytime · 15 min free preview in Learn</p>
        </div>
      </div>

      {/* Explicit plan picker — two clearly-priced options instead of one default button plus a
          tiny "or save with annual" link underneath, so the annual option isn't easy to miss. */}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => setPlan("weekly")}
          aria-pressed={plan === "weekly"}
          className={plan === "weekly" ? "btn-primary text-xs px-3 py-1.5 rounded-full" : "btn-secondary text-xs px-3 py-1.5 rounded-full"}
        >
          Weekly · {pricing.display}
        </button>
        <button
          type="button"
          onClick={() => setPlan("annual")}
          aria-pressed={plan === "annual"}
          className={plan === "annual" ? "btn-primary text-xs px-3 py-1.5 rounded-full" : "btn-secondary text-xs px-3 py-1.5 rounded-full"}
        >
          Annual · <span className="line-through opacity-50">{annualFullPriceDisplay(pricing)}</span> {pricing.annualDisplay}
        </button>
      </div>

      <button onClick={handleSubscribe} disabled={loading} className="btn-primary text-xs px-4 py-2 mt-3 w-full sm:w-auto">
        {loading ? "Loading…" : status === "canceled" ? "Resubscribe" : "Subscribe"}
      </button>
      {billingError && <p className="text-xs text-red-600 mt-2">{billingError}</p>}

      <TrailersSection compact />
      <p className="text-[11px] text-ink/50 mt-2">Full refunds within 90 days, no questions asked.</p>
    </div>
  );
}
