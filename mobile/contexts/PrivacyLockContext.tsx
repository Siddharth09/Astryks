import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { AppState, AppStateStatus } from "react-native";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { isPrivacyLockEnabled, verifyPrivacyLockPin, setPrivacyLockPin, clearPrivacyLockPin } from "@/lib/privacyLock";

const requestPrivacyLockResetFn = httpsCallable(functions, "requestPrivacyLockReset");
const verifyPrivacyLockResetFn = httpsCallable(functions, "verifyPrivacyLockReset");

type PrivacyLockContextValue = {
  // Whether a PIN has been set up at all (i.e. the feature is turned on).
  enabled: boolean;
  // Whether Home/Messages should currently show the lock screen. Always false when `enabled` is
  // false. Starts `true` the moment `enabled` becomes true (fresh app open, or right after setup)
  // and only flips to `false` for the current foreground session once the right PIN is entered.
  locked: boolean;
  // True until the on-device check has resolved for the CURRENT signed-in user. Consumers must
  // treat `loading` as "don't render protected content yet" — `locked` alone starts `false` and
  // isn't a safe signal until this flips, since the SecureStore read is async.
  loading: boolean;
  unlock: (pin: string) => Promise<boolean>;
  setup: (pin: string) => Promise<void>;
  disable: (pin: string) => Promise<boolean>;
  // "Forgot PIN" flow — the PIN itself is device-local (see lib/privacyLock.ts), so resetting it
  // doesn't touch the old PIN at all: requestReset emails a one-time code to the account's own
  // registered address, verifyReset checks it server-side, and on success the caller collects a
  // new PIN and calls `setup` as normal to replace whatever was set before.
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
  const appState = useRef(AppState.currentState);

  // Re-runs whenever the signed-in account changes (including sign-out → sign-in as someone
  // else on the same device) — the PIN is stored per-uid (see lib/privacyLock.ts), so switching
  // accounts must re-check THAT account's own lock state, not carry over the previous one.
  useEffect(() => {
    if (!uid) {
      setEnabled(false);
      setLocked(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    isPrivacyLockEnabled(uid).then((isEnabled) => {
      setEnabled(isEnabled);
      setLocked(isEnabled);
      setLoading(false);
    });
  }, [uid]);

  // Re-lock every time the app comes back from the background — an unlock only ever covers the
  // current foreground session. Without this, unlocking once would leave Home/Messages open
  // indefinitely, which defeats the point: the whole scenario this protects against is someone
  // else picking the phone up later, not just the moment it's handed over.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextState !== "active") {
        if (enabled) setLocked(true);
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
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
  }

  async function disable(pin: string): Promise<boolean> {
    if (!uid) return false;
    const correct = await verifyPrivacyLockPin(uid, pin);
    if (!correct) return false;
    await clearPrivacyLockPin(uid);
    setEnabled(false);
    setLocked(false);
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
