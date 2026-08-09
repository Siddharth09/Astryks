"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const createBillingPortalSession = httpsCallable(functions, "createBillingPortalSession");
const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
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

  return (
    <div className="space-y-3 mb-6">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Subscription</p>
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
    </div>
  );
}
