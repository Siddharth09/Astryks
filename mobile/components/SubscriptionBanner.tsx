import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import ReferralCodeEntry from "@/components/ReferralCodeEntry";
import TrailersSection from "@/components/TrailersSection";
import { colors } from "@/lib/styles";

const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => setStatus(snap.data()?.subscriptionStatus ?? "none"));
  }, [user]);

  async function handleSubscribe() {
    setLoading(true);
    const referralCode = (await AsyncStorage.getItem("astryks_referral_code")) || undefined;
    const result = await createCheckoutSession({
      referralCode,
      successUrl: "astryks://home",
      cancelUrl: "astryks://home",
    });
    const { url } = result.data as { url: string };
    await WebBrowser.openBrowserAsync(url);
    setLoading(false);
  }

  if (status === null || status === "active") return null;

  return (
    <View style={{ backgroundColor: "#FFF6F1", borderRadius: 16, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 18 }}>✨</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600" }}>
            {status === "canceled" ? "Your subscription has ended" : "Subscribe to unlock all lessons"}
          </Text>
          <Text style={{ fontSize: 11, color: "#8A8A8D" }}>$5/week · cancel anytime</Text>
        </View>
        <TouchableOpacity onPress={handleSubscribe} disabled={loading} style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: "white", fontSize: 12, fontWeight: "600" }}>
            {loading ? "Loading…" : status === "canceled" ? "Resubscribe" : "Subscribe"}
          </Text>
        </TouchableOpacity>
      </View>
      <TrailersSection compact />
      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 8 }}>
        Free refunds, no questions asked — unless you used a promo code.
      </Text>
      <ReferralCodeEntry />
    </View>
  );
}
