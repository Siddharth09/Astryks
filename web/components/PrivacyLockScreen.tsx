"use client";

import { useState } from "react";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PinPad from "@/components/PinPad";
import PrivacyLockResetFlow from "@/components/PrivacyLockResetFlow";

// Shown in place of a page's real content while Privacy Lock is active for this browser tab —
// see PrivacyLockContext. "Forgot PIN?" hands off to PrivacyLockResetFlow (a one-time code
// emailed to the account's own registered address), the same recovery path also reachable from
// the Me page's disable flow.
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
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <p className="text-4xl mb-3">🔒</p>
      <h1 className="font-display text-xl font-bold mb-2">{label} is locked</h1>
      <p className="text-sm text-ink/60 mb-6">Enter your Privacy Lock PIN to continue</p>
      {error && <p className="text-sm text-red-600 mb-4">Incorrect PIN</p>}
      <PinPad error={error} resetKey={resetKey} onComplete={handleComplete} />
      <button
        onClick={() => setResetFlowOpen(true)}
        className="text-sm text-ink underline mt-6"
      >
        Forgot PIN?
      </button>
      <PrivacyLockResetFlow open={resetFlowOpen} onClose={() => setResetFlowOpen(false)} />
    </div>
  );
}
