import { useState } from "react";
import { View, Text } from "react-native";
import { colors } from "@/lib/styles";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";

// Shown in place of a tab's real content while Privacy Lock is active for this foreground
// session — see PrivacyLockContext. Deliberately gives no way out except the correct PIN (no
// "forgot PIN" shortcut here, since that would defeat the point of a lock meant to keep someone
// out); the Me tab's disable flow is the only other way back in, and that also requires the PIN.
export default function PrivacyLockScreen({ label }: { label: string }) {
  const { unlock } = usePrivacyLock();
  const [error, setError] = useState(false);
  const [resetKey, setResetKey] = useState(0);

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
    </View>
  );
}
