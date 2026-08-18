import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { detectCountryCode } from "@/lib/geo";
import { initPurchases } from "@/lib/purchases";

const detectCountryFromIpFn = httpsCallable(functions, "detectCountryFromIp");

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // Keep a searchable/public-readable copy of the basics on the users doc, so other
      // people can find this account (New Message search, profile screens).
      if (u) {
        setDoc(
          doc(db, "users", u.uid),
          { displayName: u.displayName ?? "Member", photoURL: u.photoURL ?? null },
          { merge: true }
        ).catch(() => {});

        // Link this device's Qonversion identity to the Firebase uid so App Store/Play Store
        // purchase events can be mapped back to the right users/{uid} doc server-side.
        initPurchases(u.uid);

        // Best-effort only: never overwrites a countryCode that's already there, since Stripe's/
        // Apple's/Google's billing-country capture (set once someone subscribes) is far more
        // reliable than any guess. The server-side callable does an IP lookup (more accurate
        // than a timezone, which can span multiple countries) and is itself a no-op if a
        // country's already on record — the client-side timezone guess only fires as a fallback
        // if that call fails (e.g. a network hiccup).
        detectCountryFromIpFn().catch(() => {
          getDoc(doc(db, "users", u.uid))
            .then((snap) => {
              if (!snap.data()?.countryCode) {
                const guess = detectCountryCode();
                if (guess) {
                  setDoc(doc(db, "users", u.uid), { countryCode: guess }, { merge: true }).catch(() => {});
                }
              }
            })
            .catch(() => {});
        });
      }
    });
    return () => unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
