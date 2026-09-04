// A browser-local screen lock for the Home and Messages tabs — lets anyone use a shared/public
// computer without seeing the feed or messages. Deliberately NOT framed or built as a "parental
// control" / child-safety feature: Astryks's own Terms require users to be 18+, and marketing
// this as child-directed would pull in COPPA-style obligations (age verification, parental
// consent, restricted data collection) the app isn't built for. Mirrors the mobile app's
// SecureStore-backed lib/privacyLock.ts as closely as the browser allows.
//
// The PIN itself never leaves the browser — stored hashed (SHA-256, via the Web Crypto API) in
// localStorage, not in Firestore, so there's nothing server-side to sync or leak. Keyed by uid,
// not browser-wide: without that, a second account signing into the same browser would inherit
// the first account's lock (and could then clear it via the "Forgot PIN" email reset, which is
// account-scoped server-side) — see the mobile lib/privacyLock.ts for the same reasoning.
function keyFor(uid: string): string {
  return `astryks_privacy_lock_pin_hash_${uid}`;
}

async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isPrivacyLockEnabled(uid: string): boolean {
  return !!localStorage.getItem(keyFor(uid));
}

export async function setPrivacyLockPin(uid: string, pin: string): Promise<void> {
  const hash = await hashPin(pin);
  localStorage.setItem(keyFor(uid), hash);
}

export async function verifyPrivacyLockPin(uid: string, pin: string): Promise<boolean> {
  const stored = localStorage.getItem(keyFor(uid));
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

// Turning the lock off requires the current PIN (checked by the caller via verifyPrivacyLockPin
// before calling this) — otherwise whoever is locked out could just open Me and disable it.
export function clearPrivacyLockPin(uid: string): void {
  localStorage.removeItem(keyFor(uid));
}
