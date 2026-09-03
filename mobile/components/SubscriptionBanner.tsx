import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import TrailersSection from "@/components/TrailersSection";
import { colors } from "@/lib/styles";
import { detectCountryCode, getLocalizedPricing, PRICE_CURRENCY_NOTE } from "@/lib/geo";
import { purchaseSubscription, PlanId } from "@/lib/purchases";
import { fallbackDisplayPricing, resolveDisplayPricing, DisplayPricing } from "@/lib/pricing";

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<DisplayPricing>(() => fallbackDisplayPricing(getLocalizedPricing(null)));

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const fallback = getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode());
      setPricing(fallbackDisplayPricing(fallback));
      resolveDisplayPricing(fallback).then(setPricing);
    });
    // A live listener (not a one-time fetch) — subscriptionStatus is server-only (see
    // firestore.rules), written by the qonversionWebhook Cloud Function a few seconds after a
    // purchase completes, not by this screen. Listening means the banner disappears on its own
    // the moment that webhook lands, instead of staying stuck showing "Subscribe" until the user
    // happens to remount this component.
    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
    });
    return unsubscribe;
  }, [user]);

  // Mobile subscriptions go through Apple/Google in-app purchases (via Qonversion), not
  // Stripe — App Store/Play Store rules require digital subscriptions to use their own billing.
  // The purchase itself is confirmed by the store instantly, but our own server-side entitlement
  // (qonversionWebhook writing subscriptionStatus) can lag a few seconds behind — briefly wait
  // for it here rather than declaring success before a subscriber-gated action would actually
  // work yet.
  async function handleSubscribe(planId: PlanId) {
    if (!user || loadingPlan) return;
    setLoadingPlan(planId);
    setError(null);
    const result = await purchaseSubscription(planId);
    if (result.success) {
      setLoadingPlan(null);
      setConfirming(true);
      for (let attempt = 0; attempt < 10; attempt++) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.data()?.subscriptionStatus === "active") break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setConfirming(false);
    }
    if (result.error) {
      setError(result.error);
    }
    setLoadingPlan(null);
  }

  if (status === null || status === "active") return null;

  return (
    <View style={{ backgroundColor: "#FFF6F1", borderRadius: 16, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 20 }}>✨</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "600" }}>
            {status === "canceled" ? "Your subscription has ended" : "Subscribe to unlock all lessons"}
          </Text>
          <Text style={{ fontSize: 15, color: "#8A8A8D" }}>Full access to every Music &amp; Art video lesson · cancel anytime</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <TouchableOpacity
          onPress={() => handleSubscribe("weekly")}
          disabled={loadingPlan !== null || confirming}
          style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: colors.ink, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
            {loadingPlan === "weekly" ? "Loading…" : `${status === "canceled" ? "Resubscribe" : "Subscribe"} Weekly`}
          </Text>
          {loadingPlan !== "weekly" && (
            <Text style={{ color: "white", fontSize: 13, opacity: 0.85, marginTop: 2 }}>{pricing.weeklyDisplay}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleSubscribe("annual")}
          disabled={loadingPlan !== null}
          style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: "white", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.ink, alignItems: "center" }}
        >
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
            {loadingPlan === "annual" ? "Loading…" : `${status === "canceled" ? "Resubscribe" : "Subscribe"} Annual`}
          </Text>
          {loadingPlan !== "annual" && (
            <>
              {/* Billed amount is the most prominent price here per Apple Guideline 3.1.2(c) —
                  the per-week equivalent is informational only and must stay visually subordinate. */}
              <Text style={{ color: colors.ink, fontSize: 13, marginTop: 2 }}>{pricing.annualDisplay} billed yearly</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>({pricing.annualPerWeekDisplay})</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      {!pricing.isExact && <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>{PRICE_CURRENCY_NOTE}</Text>}
      {confirming && (
        <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8 }}>Confirming your subscription…</Text>
      )}
      <TrailersSection compact />
      {error && (
        <Text style={{ fontSize: 14, color: "#B3261E", marginTop: 8 }}>{error}</Text>
      )}
      <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8 }}>
        Billed through your {Platform.OS === "ios" ? "Apple ID" : "Google Play"} account · cancel anytime
      </Text>
    </View>
  );
}
