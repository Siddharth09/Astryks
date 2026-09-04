"use client";

import { useEffect, useState } from "react";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";

type Step = "code" | "create" | "confirm";

// "Forgot PIN?" — emails a one-time 6-digit code to the account's own registered address (the
// same requestPrivacyLockReset/verifyPrivacyLockReset Cloud Functions the mobile app uses), then
// lets the caller set a brand new PIN once that code checks out. Shared by PrivacyLockScreen
// (locked out of Home/Messages entirely) and the Me page's disable flow, since both need the
// exact same recovery path.
export default function PrivacyLockResetFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { requestReset, verifyReset, setup } = usePrivacyLock();
  const [step, setStep] = useState<Step>("code");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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

  // Fires exactly once each time the flow opens (mirrors the mobile version's Modal onShow) —
  // resets to the first step and kicks off the email send.
  useEffect(() => {
    if (!open) return;
    setStep("code");
    setFirstPin("");
    setError(null);
    sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleClose() {
    onClose();
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
    handleClose();
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold text-lg mb-2">{title}</h3>
        <p className="text-sm text-ink/60 mb-4">{subtitle}</p>
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {!sending &&
          (step === "code" ? (
            <PinPad length={6} error={!!error} resetKey={resetKey} onComplete={handleCode} />
          ) : (
            <PinPad error={!!error} resetKey={resetKey} onComplete={handleNewPin} />
          ))}
        {step === "code" && !sending && (
          <button onClick={sendCode} className="text-sm text-ink underline mt-4 block mx-auto">
            Resend code
          </button>
        )}
        <button onClick={handleClose} className="text-sm text-ink/60 underline mt-3 block mx-auto">
          Cancel
        </button>
      </div>
    </div>
  );
}
