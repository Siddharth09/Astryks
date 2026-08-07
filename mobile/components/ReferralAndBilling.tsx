import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Share } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

const getOrCreateReferralCode = httpsCallable(functions, "getOrCreateReferralCode");
const createBillingPortalSession = httpsCallable(functions, "createBillingPortalSession");
const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

const SUPPORT_UID = "astryks-support";
const SUPPORT_NAME = "Astryks Support";

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [payoutOwed, setPayoutOwed] = useState(0);

  useEffect(() => {
    if (!user) return;
    getOrCreateReferralCode().then((r) => setCode((r.data as { code: string }).code));
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setPayoutOwed(snap.data()?.payoutOwed ?? 0);
    });
  }, [user]);

  async function shareLink() {
    if (!code) return;
    await Share.share({ message: `Join me on Astryks: https://astryks.com/signup?ref=${code}` });
  }

  async function messageSupport() {
    if (!user) return;
    const conversationId = [user.uid, SUPPORT_UID].sort().join("_");
    const ref = doc(db, "conversations", conversationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [user.uid, SUPPORT_UID].sort(),
        participantNames: [user.uid, SUPPORT_UID]
          .sort()
          .map((id) => (id === SUPPORT_UID ? SUPPORT_NAME : user.displayName ?? "You")),
        lastMessage: "",
        lastMessageAt: new Date(),
      });
    }
    router.push(`/messages/${conversationId}`);
  }

  async function manageSubscription() {
    const result = await createBillingPortalSession({ returnUrl: "astryks://me" });
    await WebBrowser.openBrowserAsync((result.data as { url: string }).url);
  }

  async function subscribe() {
    const result = await createCheckoutSession({ successUrl: "astryks://me", cancelUrl: "astryks://me" });
    await WebBrowser.openBrowserAsync((result.data as { url: string }).url);
  }

  return (
    <View style={{ gap: 10, marginBottom: 20 }}>
      <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", marginBottom: 4 }}>Refer a friend, earn $50</Text>
        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10, lineHeight: 16 }}>
          Share your code below. When a friend enters it at checkout, they get 20% off — $4/week instead of
          $5 — for their first 3 months, then it goes back to normal. Once they've stayed subscribed 3 months,
          you earn $50.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View style={{ flex: 1, backgroundColor: "#F5F3EF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontSize: 13 }}>{code ?? "…"}</Text>
          </View>
          <TouchableOpacity onPress={shareLink} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontSize: 12 }}>Share</Text>
          </TouchableOpacity>
        </View>
        {payoutOwed > 0 && (
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
            ${payoutOwed} owed to you —{" "}
            <Text onPress={messageSupport} style={{ color: colors.brand, fontWeight: "600" }}>
              message us here
            </Text>{" "}
            and we&apos;ll send it your way.
          </Text>
        )}
      </View>

      <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600" }}>Subscription</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            {status === "active" ? "Active — $5/week" : status === "canceled" ? "Canceled" : "Not subscribed"}
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

      <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", marginBottom: 8 }}>How referrals work</Text>
        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6, lineHeight: 15 }}>
          Your code's ready above — just share it. Your friend gets 20% off ($4/week) for 3 months, then $5/week
          like everyone else. Once they've stuck around 3 months, we'll let you know you've earned $50. To claim it,{" "}
          <Text onPress={messageSupport} style={{ color: colors.brand, fontWeight: "600" }}>
            message us here
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}
