"use client";

import { useState } from "react";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";
import PrivacyLockResetFlow from "@/components/PrivacyLockResetFlow";

type SetupStep = "create" | "confirm";

// Lets anyone use a shared/public computer without seeing the Home feed or Messages — a generic
// browser-local screen lock, not a "parental control" (see lib/privacyLock.ts for why that
// framing matters). Setup requires entering the PIN twice (typo protection); turning it off
// requires the current PIN, so someone locked out can't just come here and switch it off
// themselves. "Forgot PIN?" hands off to PrivacyLockResetFlow, the shared email-code recovery
// path also used by the lock screen itself. This block is deliberately still reachable on Me
// even while Privacy Lock is active elsewhere — Me itself isn't gated.
export default function PrivacyLockSettings() {
  const { enabled, setup, disable, loading } = usePrivacyLock();
  const [modal, setModal] = useState<"setup" | "disable" | null>(null);
  const [step, setStep] = useState<SetupStep>("create");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [resetFlowOpen, setResetFlowOpen] = useState(false);

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
    <div className="card p-4 mb-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold">Privacy Lock</p>
          <p className="text-xs text-ink/60 mt-0.5">
            {enabled
              ? "On — Home and Messages need your PIN"
              : "Hide Home and Messages behind a PIN on a shared or public computer"}
          </p>
        </div>
        <button onClick={enabled ? openDisable : openSetup} className="btn-secondary text-sm px-3 py-1.5 whitespace-nowrap">
          {enabled ? "Turn Off" : "Set Up"}
        </button>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={close}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-semibold text-lg mb-2">
              {modal === "setup" ? (step === "create" ? "Create a PIN" : "Confirm your PIN") : "Enter your PIN to turn off"}
            </h3>
            <p className="text-sm text-ink/60 mb-4">
              {modal === "setup"
                ? step === "create"
                  ? "Choose a 4-digit PIN for Privacy Lock"
                  : "Enter the same PIN again"
                : "This turns off Privacy Lock for Home and Messages"}
            </p>
            {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
            <PinPad error={!!error} resetKey={resetKey} onComplete={modal === "setup" ? handleSetupPin : handleDisablePin} />
            {modal === "disable" && (
              <button
                onClick={() => {
                  close();
                  setResetFlowOpen(true);
                }}
                className="text-sm text-ink underline mt-4 block mx-auto"
              >
                Forgot PIN?
              </button>
            )}
            <button onClick={close} className="text-sm text-ink/60 underline mt-3 block mx-auto">
              Cancel
            </button>
          </div>
        </div>
      )}

      <PrivacyLockResetFlow open={resetFlowOpen} onClose={() => setResetFlowOpen(false)} />
    </div>
  );
}
