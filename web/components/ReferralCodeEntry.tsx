"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const validateReferralCode = httpsCallable(functions, "validateReferralCode");

export default function ReferralCodeEntry() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  async function apply() {
    if (!input.trim()) return;
    setStatus("checking");
    const result = await validateReferralCode({ code: input });
    const { valid } = result.data as { valid: boolean };
    if (valid) {
      localStorage.setItem("astryks_referral_code", input.toUpperCase().trim());
      setStatus("valid");
    } else {
      setStatus("invalid");
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-ink/50 underline">
        Have a referral code?
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder="Enter code"
          value={input}
          onChange={(e) => {
            setInput(e.target.value.toUpperCase());
            setStatus("idle");
          }}
        />
        <button onClick={apply} className="btn-secondary text-xs px-3">
          Apply
        </button>
      </div>
      {status === "valid" && (
        <p className="text-xs text-green-700">
          Code applied — you'll get 20% off ($4/week) for your first 3 months.
        </p>
      )}
      {status === "invalid" && <p className="text-xs text-red-600">That code doesn't look right — double check it.</p>}
    </div>
  );
}
