import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import TrailersSection from "@/components/TrailersSection";
import { colors } from "@/lib/styles";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";
import { purchaseSubscription } from "@/lib/purchases";

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setPricing(getLocalizedPricing(snap.data()?.countryCode ?? detectCountryCode()));
    });
  }, [user]);

  // Mobile subscriptions go through Apple/Google in-app purchases (via Qonversion), not
  // Stripe — App Store/Play Store rules require digital subscriptions to use their own
  // billing. The `qonversionWebhook` Cloud Function flips subscriptionStatus to "active" once
  // the purchase completes; we also optimistically set it here so the banner updates instantly.
  async function handleSubscribe() {
    if (!user) return;
    setLoading(true);
    setError(null);
    const result = await purchaseSubscription();
    if (result.success) {
      setStatus("active");
      await setDoc(doc(db, "users", user.uid), { subscriptionStatus: "active" }, { merge: true }).catch(() => {});
    } else if (result.error) {
      setError(result.error);
    }
    setLoading(false);
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
          <Text style={{ fontSize: 15, color: "#8A8A8D" }}>{pricing.display} · cancel anytime</Text>
        </View>
        <TouchableOpacity onPress={handleSubscribe} disabled={loading} style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            {loading ? "Loading…" : status === "canceled" ? "Resubscribe" : "Subscribe"}
          </Text>
        </TouchableOpacity>
      </View>
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
