import { useState } from "react";
import { View, Text, TouchableOpacity, Modal } from "react-native";
import { colors } from "@/lib/styles";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";

type SetupStep = "create" | "confirm";

// Lets anyone hand their phone to someone else (a kid, a friend, a colleague) without that
// person seeing the Home feed or Messages — a generic device-local screen lock, not a "parental
// control" (see lib/privacyLock.ts for why that framing matters). Setup requires entering the
// PIN twice (typo protection); turning it off requires the current PIN, so someone locked out
// can't just come here and switch it off themselves.
export default function PrivacyLockSettings() {
  const { enabled, setup, disable, loading } = usePrivacyLock();
  const [modal, setModal] = useState<"setup" | "disable" | null>(null);
  const [step, setStep] = useState<SetupStep>("create");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  function openSetup() {
    setStep("create");
    setFirstPin("");
    setError(null);
    setResetKey((k) => k + 1);
    setModal("setup");
  }

  function openDisable() {
    setError(null);
    setResetKey((k) => k + 1);
    setModal("disable");
  }

  function close() {
    setModal(null);
  }

  async function handleSetupPin(pin: string) {
    if (step === "create") {
      setFirstPin(pin);
      setStep("confirm");
      setError(null);
      setResetKey((k) => k + 1);
      return;
    }
    // step === "confirm"
    if (pin !== firstPin) {
      setError("PINs didn't match — let's try again");
      setStep("create");
      setFirstPin("");
      setResetKey((k) => k + 1);
      return;
    }
    await setup(pin);
    close();
  }

  async function handleDisablePin(pin: string) {
    const ok = await disable(pin);
    if (!ok) {
      setError("Incorrect PIN");
      setResetKey((k) => k + 1);
      return;
    }
    close();
  }

  if (loading) return null;

  return (
    <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14, marginBottom: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "600" }}>Privacy Lock</Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 2 }}>
            {enabled
              ? "On — Home and Messages need your PIN"
              : "Hide Home and Messages behind a PIN before handing your phone to someone else"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={enabled ? openDisable : openSetup}
          style={{
            borderWidth: 1,
            borderColor: colors.line + "1A",
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 15, color: colors.ink }}>{enabled ? "Turn Off" : "Set Up"}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: "rgba(23,19,15,0.5)", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, alignItems: "center" }}>
            <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink, marginBottom: 6, textAlign: "center" }}>
              {modal === "setup" ? (step === "create" ? "Create a PIN" : "Confirm your PIN") : "Enter your PIN to turn off"}
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted, marginBottom: error ? 8 : 20, textAlign: "center" }}>
              {modal === "setup"
                ? step === "create"
                  ? "Choose a 4-digit PIN for Privacy Lock"
                  : "Enter the same PIN again"
                : "This turns off Privacy Lock for Home and Messages"}
            </Text>
            {error && <Text style={{ color: "#B3261E", fontSize: 14, marginBottom: 18 }}>{error}</Text>}
            <PinPad
              error={!!error}
              resetKey={resetKey}
              onComplete={modal === "setup" ? handleSetupPin : handleDisablePin}
            />
            <TouchableOpacity onPress={close} style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 14, color: colors.muted, textDecorationLine: "underline" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
