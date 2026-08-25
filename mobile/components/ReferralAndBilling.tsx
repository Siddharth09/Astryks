import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform, Linking } from "react-native";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import { detectCountryCode, getLocalizedPricing, PRICE_CURRENCY_NOTE } from "@/lib/geo";
import { purchaseSubscription, PlanId } from "@/lib/purchases";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      const fallback = getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode());
      setPricing(fallbackDisplayPricing(fallback));
      resolveDisplayPricing(fallback).then(setPricing);
    });
  }, [user]);

  async function manageSubscription() {
    await Linking.openURL(MANAGE_SUBSCRIPTION_URL);
  }

  async function subscribe(planId: PlanId) {
    if (!user || loadingPlan) return;
    setLoadingPlan(planId);
    setError(null);
    const result = await purchaseSubscription(planId);
    if (result.success) {
      setStatus("active");
      await setDoc(doc(db, "users", user.uid), { subscriptionStatus: "active" }, { merge: true }).catch(() => {});
    } else if (result.error) {
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
              {status === "active" ? `Active — ${pricing.weeklyDisplay}` : status === "canceled" ? "Canceled" : "Not subscribed"}
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
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => subscribe("weekly")}
              disabled={loadingPlan !== null}
              style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 15, color: "white", fontWeight: "600" }}>
                {loadingPlan === "weekly" ? "Loading…" : `Weekly · ${pricing.weeklyDisplay}`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => subscribe("annual")}
              disabled={loadingPlan !== null}
              style={{ backgroundColor: "white", borderWidth: 1, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 15, color: colors.ink, fontWeight: "600" }}>
                {loadingPlan === "annual" ? (
                  "Loading…"
                ) : (
                  <>
                    Annual · <Text style={{ textDecorationLine: "line-through", opacity: 0.5 }}>{pricing.weeklyDisplay}</Text>{" "}
                    {pricing.annualPerWeekDisplay}
                  </>
                )}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {status !== "active" && !pricing.isExact && (
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>{PRICE_CURRENCY_NOTE}</Text>
        )}
        {error && <Text style={{ fontSize: 14, color: "#B3261E", marginTop: 8 }}>{error}</Text>}
      </View>
    </View>
  );
}
