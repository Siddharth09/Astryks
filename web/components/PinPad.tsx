"use client";

import { useEffect, useRef, useState } from "react";

// A single numeric input for entering a fixed-length code — used for the 4-digit Privacy Lock
// PIN (unlocking, setup, disable) and the 6-digit "forgot PIN" email reset code. Auto-submits
// once `length` digits are entered. Unlike the mobile app's on-screen keypad, web users have a
// physical keyboard, so this is a real (numeric, masked) input rather than a tap-target grid.
export default function PinPad({
  length = 4,
  error,
  resetKey,
  onComplete,
}: {
  length?: number;
  error?: boolean;
  resetKey?: number;
  onComplete: (pin: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue("");
    inputRef.current?.focus();
  }, [resetKey]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, length);
    setValue(digits);
    if (digits.length === length) {
      onComplete(digits);
      setValue("");
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-3 mb-4" aria-hidden>
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 ${error ? "border-red-600" : "border-ink"} ${
              i < value.length ? (error ? "bg-red-600" : "bg-ink") : "bg-transparent"
            }`}
          />
        ))}
      </div>
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        autoFocus
        className="sr-only"
        aria-label={`${length}-digit code`}
      />
      <button type="button" onClick={() => inputRef.current?.focus()} className="text-xs text-ink/40 underline">
        Tap here if the keyboard didn't open
      </button>
    </div>
  );
}
