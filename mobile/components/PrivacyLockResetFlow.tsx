import { useState } from "react";
import { View, Text, TouchableOpacity, Modal } from "react-native";
import { colors } from "@/lib/styles";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";

type Step = "code" | "create" | "confirm";

// "Forgot PIN?" — emails a one-time 6-digit code to the account's own registered address
// (requestPrivacyLockReset/verifyPrivacyLockReset in functions/index.js), then lets the caller
// set a brand new PIN once that code checks out. Shared by PrivacyLockScreen (locked out of
// Home/Messages entirely) and PrivacyLockSettings' disable flow (Me tab), since both need the
// exact same recovery path.
export default function PrivacyLockResetFlow({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { requestReset, verifyReset, setup } = usePrivacyLock();
  const [step, setStep] = useState<Step>("code");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(true);

  async function sendCode() {
    setSending(true);
    setError(null);
    const result = await requestReset();
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't send a reset code — please try again.");
      return;
    }
    setCodeSentTo(result.email ?? null);
  }

  function handleShow() {
    setStep("code");
    setFirstPin("");
    setError(null);
    setResetKey((k) => k + 1);
    sendCode();
  }

  async function handleCode(code: string) {
    const valid = await verifyReset(code);
    if (!valid) {
      setError("That code is incorrect or expired");
      setResetKey((k) => k + 1);
      return;
    }
    setError(null);
    setStep("create");
    setResetKey((k) => k + 1);
  }

  async function handleNewPin(pin: string) {
    if (step === "create") {
      setFirstPin(pin);
      setStep("confirm");
      setError(null);
      setResetKey((k) => k + 1);
      return;
    }
    if (pin !== firstPin) {
      setError("PINs didn't match — let's try again");
      setStep("create");
      setFirstPin("");
      setResetKey((k) => k + 1);
      return;
    }
    await setup(pin);
    onClose();
  }

  const title =
    step === "code" ? "Enter your reset code" : step === "create" ? "Create a new PIN" : "Confirm your new PIN";
  const subtitle =
    step === "code"
      ? sending
        ? "Sending a code to your email…"
        : `We sent a 6-digit code to ${codeSentTo ?? "your email"}`
      : step === "create"
      ? "Choose a new 4-digit PIN"
      : "Enter the same PIN again";

  return (
    <Modal visible={visible} transparent animationType="fade" onShow={handleShow} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(23,19,15,0.5)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, alignItems: "center" }}>
          <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink, marginBottom: 6, textAlign: "center" }}>
            {title}
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginBottom: error ? 8 : 20, textAlign: "center" }}>
            {subtitle}
          </Text>
          {error && <Text style={{ color: "#B3261E", fontSize: 14, marginBottom: 18, textAlign: "center" }}>{error}</Text>}

          {!sending &&
            (step === "code" ? (
              <PinPad length={6} error={!!error} resetKey={resetKey} onComplete={handleCode} />
            ) : (
              <PinPad error={!!error} resetKey={resetKey} onComplete={handleNewPin} />
            ))}

          {step === "code" && !sending && (
            <TouchableOpacity onPress={sendCode} style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 14, color: colors.ink, textDecorationLine: "underline" }}>Resend code</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 14, color: colors.muted, textDecorationLine: "underline" }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
