import { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors } from "@/lib/styles";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";
import PrivacyLockResetFlow from "@/components/PrivacyLockResetFlow";

// Shown in place of a tab's real content while Privacy Lock is active for this foreground
// session — see PrivacyLockContext. "Forgot PIN?" hands off to PrivacyLockResetFlow (a one-time
// code emailed to the account's own registered address), the same recovery path also reachable
// from the Me tab's disable flow.
export default function PrivacyLockScreen({ label }: { label: string }) {
  const { unlock } = usePrivacyLock();
  const [error, setError] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [resetFlowOpen, setResetFlowOpen] = useState(false);

  async function handleComplete(pin: string) {
    const ok = await unlock(pin);
    if (!ok) {
      setError(true);
      setResetKey((k) => k + 1);
    } else {
      setError(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 40, marginBottom: 12 }}>🔒</Text>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>{label} is locked</Text>
      <Text style={{ fontSize: 15, color: colors.muted, marginBottom: error ? 10 : 28, textAlign: "center" }}>
        Enter your Privacy Lock PIN to continue
      </Text>
      {error && <Text style={{ color: "#B3261E", fontSize: 14, marginBottom: 18 }}>Incorrect PIN</Text>}
      <PinPad error={error} resetKey={resetKey} onComplete={handleComplete} />
      <TouchableOpacity onPress={() => setResetFlowOpen(true)} style={{ marginTop: 20 }}>
        <Text style={{ fontSize: 14, color: colors.ink, textDecorationLine: "underline" }}>Forgot PIN?</Text>
      </TouchableOpacity>
      <PrivacyLockResetFlow visible={resetFlowOpen} onClose={() => setResetFlowOpen(false)} />
    </View>
  );
}
