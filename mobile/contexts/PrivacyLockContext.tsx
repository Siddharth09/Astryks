import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { AppState, AppStateStatus } from "react-native";
import { isPrivacyLockEnabled, verifyPrivacyLockPin, setPrivacyLockPin, clearPrivacyLockPin } from "@/lib/privacyLock";

type PrivacyLockContextValue = {
  // Whether a PIN has been set up at all (i.e. the feature is turned on).
  enabled: boolean;
  // Whether Home/Messages should currently show the lock screen. Always false when `enabled` is
  // false. Starts `true` the moment `enabled` becomes true (fresh app open, or right after setup)
  // and only flips to `false` for the current foreground session once the right PIN is entered.
  locked: boolean;
  loading: boolean;
  unlock: (pin: string) => Promise<boolean>;
  setup: (pin: string) => Promise<void>;
  disable: (pin: string) => Promise<boolean>;
};

const PrivacyLockContext = createContext<PrivacyLockContextValue | null>(null);

export function PrivacyLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    isPrivacyLockEnabled().then((isEnabled) => {
      setEnabled(isEnabled);
      setLocked(isEnabled);
      setLoading(false);
    });
  }, []);

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
    const correct = await verifyPrivacyLockPin(pin);
    if (correct) setLocked(false);
    return correct;
  }

  async function setup(pin: string): Promise<void> {
    await setPrivacyLockPin(pin);
    setEnabled(true);
    setLocked(false);
  }

  async function disable(pin: string): Promise<boolean> {
    const correct = await verifyPrivacyLockPin(pin);
    if (!correct) return false;
    await clearPrivacyLockPin();
    setEnabled(false);
    setLocked(false);
    return true;
  }

  return (
    <PrivacyLockContext.Provider value={{ enabled, locked, loading, unlock, setup, disable }}>
      {children}
    </PrivacyLockContext.Provider>
  );
}

export function usePrivacyLock() {
  const ctx = useContext(PrivacyLockContext);
  if (!ctx) throw new Error("usePrivacyLock must be used within a PrivacyLockProvider");
  return ctx;
}
