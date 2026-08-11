"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import TrailersSection from "@/components/TrailersSection";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      // Prefer the account's saved country (most reliable once someone's subscribed before,
      // or filled in by the best-effort guess in AuthContext) over a fresh guess.
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
    });
  }, [user]);

  async function handleSubscribe(plan: "weekly" | "annual") {
    setLoading(true);
    const result = await createCheckoutSession({
      plan,
      successUrl: `${location.origin}/home`,
      cancelUrl: `${location.origin}/home`,
    });
    const { url } = result.data as { url: string };
    location.href = url;
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
          <p className="text-xs text-ink/60">7 days free, then {pricing.display} · cancel anytime</p>
        </div>
        <button onClick={() => handleSubscribe("weekly")} disabled={loading} className="btn-primary text-xs px-4 py-2">
          {loading ? "Loading…" : status === "canceled" ? "Resubscribe" : "Start free trial"}
        </button>
      </div>
      <TrailersSection compact />
      <p className="text-[11px] text-ink/50 mt-2">
        or{" "}
        <button onClick={() => handleSubscribe("annual")} disabled={loading} className="underline">
          save with annual — {pricing.annualDisplay}
        </button>{" "}
        (also starts with 7 days free) · full refunds within 90 days, no questions asked
      </p>
    </div>
  );
}
