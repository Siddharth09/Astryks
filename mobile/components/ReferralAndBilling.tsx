import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform, Linking } from "react-native";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";
import { purchaseSubscription } from "@/lib/purchases";

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
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
    });
  }, [user]);

  async function manageSubscription() {
    await Linking.openURL(MANAGE_SUBSCRIPTION_URL);
  }

  async function subscribe() {
    if (!user) return;
    const result = await purchaseSubscription();
    if (result.success) {
      setStatus("active");
      await setDoc(doc(db, "users", user.uid), { subscriptionStatus: "active" }, { merge: true }).catch(() => {});
    }
  }

  return (
    <View style={{ gap: 10, marginBottom: 20 }}>
      <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600" }}>Subscription</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            {status === "active" ? `Active — ${pricing.display}` : status === "canceled" ? "Canceled" : "Not subscribed"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={status === "active" ? manageSubscription : subscribe}
          style={{ backgroundColor: status === "active" ? "transparent" : colors.ink, borderWidth: status === "active" ? 1 : 0, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <Text style={{ fontSize: 12, color: status === "active" ? colors.ink : "white" }}>
            {status === "active" ? "Manage" : "Subscribe"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
