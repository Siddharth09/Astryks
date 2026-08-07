"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import ReferralCodeEntry from "@/components/ReferralCodeEntry";
import TrailersSection from "@/components/TrailersSection";

const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
    });
  }, [user]);

  async function handleSubscribe() {
    setLoading(true);
    const referralCode = localStorage.getItem("astryks_referral_code") || undefined;
    const result = await createCheckoutSession({
      referralCode,
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
          <p className="text-xs text-ink/60">$5/week · cancel anytime</p>
        </div>
        <button onClick={handleSubscribe} disabled={loading} className="btn-primary text-xs px-4 py-2">
          {loading ? "Loading…" : status === "canceled" ? "Resubscribe" : "Subscribe"}
        </button>
      </div>
      <TrailersSection compact />
      <p className="text-[11px] text-ink/50 mt-2">
        Free refunds, no questions asked — unless you used a promo code.
      </p>
      <ReferralCodeEntry />
    </div>
  );
}
