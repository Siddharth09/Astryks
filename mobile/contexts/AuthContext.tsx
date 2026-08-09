import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { detectCountryCode } from "@/lib/geo";
import { initPurchases } from "@/lib/purchases";

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

        // Best-effort only: never overwrite a countryCode that's already there, since Stripe's
        // billing-country capture (set once someone subscribes) is far more reliable than this
        // client-side timezone guess. Just fills the gap for people who haven't subscribed yet.
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
      }
    });
    return () => unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
