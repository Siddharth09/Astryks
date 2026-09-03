import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform, Linking, Alert } from "react-native";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import { detectCountryCode, getLocalizedPricing, PRICE_CURRENCY_NOTE } from "@/lib/geo";
import { purchaseSubscription, restorePurchases, PlanId } from "@/lib/purchases";
import { fallbackDisplayPricing, resolveDisplayPricing, DisplayPricing } from "@/lib/pricing";

// Mobile subscriptions are Apple/Google in-app purchases (via Qonversion) rather than Stripe —
// so "managing" a subscription (cancel, change plan, see receipts) happens in the native store
// subscription-management screen, not our Stripe billing portal.
const MANAGE_SUBSCRIPTION_URL =
  Platform.OS === "ios"
    ? "itms-apps://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions";

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [pricing, setPricing] = useState<DisplayPricing>(() => fallbackDisplayPricing(getLocalizedPricing(null)));
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const fallback = getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode());
      setPricing(fallbackDisplayPricing(fallback));
      resolveDisplayPricing(fallback).then(setPricing);
    });
    // Live listener, not a one-time fetch — subscriptionStatus is written server-side by the
    // qonversionWebhook Cloud Function (see firestore.rules), which can land a few seconds after
    // a purchase. Listening means this screen reflects the real entitlement as soon as the
    // webhook lands, without needing to be remounted.
    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
    });
    return unsubscribe;
  }, [user]);

  async function manageSubscription() {
    await Linking.openURL(MANAGE_SUBSCRIPTION_URL);
  }

  // Required by App Store Guideline 3.1.1: any app offering restorable In-App Purchases must
  // give users a distinct way to restore them (not just rely on auto-restore at launch).
  async function handleRestore() {
    if (!user || restoring) return;
    setRestoring(true);
    setError(null);
    const restored = await restorePurchases();
    setRestoring(false);
    if (restored) {
      Alert.alert("Purchases restored", "Your subscription is active again.");
    } else {
      Alert.alert("Nothing to restore", "We couldn't find an active subscription for this Apple ID / Google account.");
    }
  }

  async function subscribe(planId: PlanId) {
    if (!user || loadingPlan) return;
    setLoadingPlan(planId);
    setError(null);
    const result = await purchaseSubscription(planId);
    if (result.success) {
      setLoadingPlan(null);
      setConfirming(true);
      // See SubscriptionBanner.tsx for why this polls rather than optimistically flipping local
      // state — subscriptionStatus is server-only, and getLessonPlayback gates on the real
      // Firestore value, not on anything this screen can set directly.
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

  return (
    <View style={{ gap: 10, marginBottom: 20 }}>
      <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "600" }}>Subscription</Text>
            <Text style={{ fontSize: 15, color: colors.muted }}>
              {status === "active"
                ? `Active — full access to every lesson · ${pricing.weeklyDisplay}`
                : status === "canceled"
                ? "Canceled"
                : "Not subscribed"}
            </Text>
          </View>
          {status === "active" && (
            <TouchableOpacity
              onPress={manageSubscription}
              style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 16, color: colors.ink }}>Manage</Text>
            </TouchableOpacity>
          )}
        </View>
        {status !== "active" && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => subscribe("weekly")}
              disabled={loadingPlan !== null || confirming}
              style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: colors.ink, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" }}
            >
              <Text style={{ fontSize: 15, color: "white", fontWeight: "700" }}>
                {loadingPlan === "weekly" ? "Loading…" : "Weekly"}
              </Text>
              {loadingPlan !== "weekly" && (
                <Text style={{ fontSize: 13, color: "white", opacity: 0.85, marginTop: 2 }}>{pricing.weeklyDisplay}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => subscribe("annual")}
              disabled={loadingPlan !== null || confirming}
              style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: "white", borderWidth: 1, borderColor: colors.ink, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" }}
            >
              <Text style={{ fontSize: 15, color: colors.ink, fontWeight: "700" }}>
                {loadingPlan === "annual" ? "Loading…" : "Annual"}
              </Text>
              {loadingPlan !== "annual" && (
                <>
                  {/* Billed amount must be the most prominent price per Apple Guideline 3.1.2(c). */}
                  <Text style={{ fontSize: 13, color: colors.ink, marginTop: 2 }}>{pricing.annualDisplay} billed yearly</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>({pricing.annualPerWeekDisplay})</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
        {status !== "active" && !pricing.isExact && (
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>{PRICE_CURRENCY_NOTE}</Text>
        )}
        {confirming && (
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8 }}>Confirming your subscription…</Text>
        )}
        {error && <Text style={{ fontSize: 14, color: "#B3261E", marginTop: 8 }}>{error}</Text>}
        <TouchableOpacity onPress={handleRestore} disabled={restoring} style={{ marginTop: 10, alignSelf: "flex-start" }}>
          <Text style={{ fontSize: 14, color: colors.ink, textDecorationLine: "underline" }}>
            {restoring ? "Restoring…" : "Restore Purchases"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
