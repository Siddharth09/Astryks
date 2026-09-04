"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { isPrivacyLockEnabled, verifyPrivacyLockPin, setPrivacyLockPin, clearPrivacyLockPin } from "@/lib/privacyLock";

const requestPrivacyLockResetFn = httpsCallable(functions, "requestPrivacyLockReset");
const verifyPrivacyLockResetFn = httpsCallable(functions, "verifyPrivacyLockReset");
const setPrivacyLockStatusFn = httpsCallable(functions, "setPrivacyLockStatus");

type PrivacyLockContextValue = {
  // Whether a PIN has been set up at all (i.e. the feature is turned on).
  enabled: boolean;
  // Whether Home/Messages should currently show the lock screen. Unlocking only covers this tab
  // for as long as the page stays open — a fresh page load (new tab, reload, or the browser
  // reopening) always starts locked again if `enabled`, since there's no equivalent of a mobile
  // app's "foreground session" to key off of on the web.
  locked: boolean;
  // True until the localStorage check has resolved for the CURRENT signed-in user. Consumers
  // must treat `loading` as "don't render protected content yet."
  loading: boolean;
  unlock: (pin: string) => Promise<boolean>;
  setup: (pin: string) => Promise<void>;
  disable: (pin: string) => Promise<boolean>;
  // "Forgot PIN" flow — the PIN itself is browser-local (see lib/privacyLock.ts), so resetting it
  // doesn't touch the old PIN at all: requestReset emails a one-time code to the account's own
  // registered address (the same requestPrivacyLockReset/verifyPrivacyLockReset Cloud Functions
  // the mobile app uses), and on success the caller collects a new PIN and calls `setup`.
  requestReset: () => Promise<{ ok: boolean; email?: string; error?: string }>;
  verifyReset: (code: string) => Promise<boolean>;
};

const PrivacyLockContext = createContext<PrivacyLockContextValue | null>(null);

export function PrivacyLockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);

  // Re-runs whenever the signed-in account changes — the PIN is stored per-uid (see
  // lib/privacyLock.ts), so switching accounts on the same browser must re-check THAT account's
  // own lock state, not carry over whichever account was previously signed in here.
  useEffect(() => {
    if (!uid) {
      setEnabled(false);
      setLocked(false);
      setLoading(false);
      return;
    }
    const isEnabled = isPrivacyLockEnabled(uid);
    setEnabled(isEnabled);
    setLocked(isEnabled);
    setLoading(false);
  }, [uid]);

  // Re-lock whenever this tab is hidden (switched away from, or the browser/computer is put
  // aside) — an unlock only ever covers the current visible session. Without this, unlocking
  // once would leave Home/Messages open indefinitely on a shared computer, which defeats the
  // point: the whole scenario this protects against is someone else coming back to the browser
  // later, not just the moment it was last used.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && enabled) {
        setLocked(true);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled]);

  async function unlock(pin: string): Promise<boolean> {
    if (!uid) return false;
    const correct = await verifyPrivacyLockPin(uid, pin);
    if (correct) setLocked(false);
    return correct;
  }

  async function setup(pin: string): Promise<void> {
    if (!uid) return;
    await setPrivacyLockPin(uid, pin);
    setEnabled(true);
    setLocked(false);
    // Best-effort: this flag is what lets getLessonPlayback close the free-preview loophole for
    // a non-subscriber while Privacy Lock is on (see functions/index.js) — the PIN itself still
    // never leaves the browser either way, so a failed call here just means that extra Learn
    // restriction doesn't kick in yet, not that the lock itself is broken.
    setPrivacyLockStatusFn({ enabled: true }).catch(() => {});
  }

  async function disable(pin: string): Promise<boolean> {
    if (!uid) return false;
    const correct = await verifyPrivacyLockPin(uid, pin);
    if (!correct) return false;
    clearPrivacyLockPin(uid);
    setEnabled(false);
    setLocked(false);
    setPrivacyLockStatusFn({ enabled: false }).catch(() => {});
    return true;
  }

  async function requestReset(): Promise<{ ok: boolean; email?: string; error?: string }> {
    try {
      const result = await requestPrivacyLockResetFn();
      const data = result.data as { ok: boolean; email?: string };
      return data;
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Couldn't send the reset code — please try again." };
    }
  }

  async function verifyReset(code: string): Promise<boolean> {
    try {
      const result = await verifyPrivacyLockResetFn({ code });
      return !!(result.data as { valid: boolean }).valid;
    } catch {
      return false;
    }
  }

  return (
    <PrivacyLockContext.Provider value={{ enabled, locked, loading, unlock, setup, disable, requestReset, verifyReset }}>
      {children}
    </PrivacyLockContext.Provider>
  );
}

export function usePrivacyLock() {
  const ctx = useContext(PrivacyLockContext);
  if (!ctx) throw new Error("usePrivacyLock must be used within a PrivacyLockProvider");
  return ctx;
}
