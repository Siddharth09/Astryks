import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

// A device-local screen lock for the Home and Messages tabs — lets anyone hand their phone to
// someone else (a kid, a friend, a colleague) without that person seeing the feed or messages.
// Deliberately NOT framed or built as a "parental control" / child-safety feature: Astryks's own
// Terms require users to be 18+, and marketing this as child-directed would pull in COPPA-style
// obligations (age verification, parental consent, restricted data collection) the app isn't
// built for. This is a generic privacy lock, same idea as an iOS Screen Time app restriction.
//
// The PIN itself never leaves the device — stored hashed (SHA-256) in SecureStore (Keychain on
// iOS, Keystore on Android), not in Firestore, so there's nothing server-side to sync or leak.
//
// Keyed by uid, not device-wide: without this, signing a second Astryks account into the same
// device would find the first account's lock still active (locking the second account out of
// their own Home/Messages with a PIN they never set), and the "Forgot PIN" email-reset flow would
// let that second account holder clear the first account's PIN entirely just by proving they
// control *their own* email — since the reset is authenticated per-account server-side, but the
// PIN it was resetting wasn't. Namespacing the key by uid means each account's PIN (and each
// account's reset flow) only ever touches that same account's own entry.
function keyFor(uid: string): string {
  return `astryks_privacy_lock_pin_hash_${uid}`;
}

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

export async function isPrivacyLockEnabled(uid: string): Promise<boolean> {
  const hash = await SecureStore.getItemAsync(keyFor(uid));
  return !!hash;
}

export async function setPrivacyLockPin(uid: string, pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await SecureStore.setItemAsync(keyFor(uid), hash);
}

export async function verifyPrivacyLockPin(uid: string, pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(keyFor(uid));
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

// Turning the lock off requires the current PIN (checked by the caller via verifyPrivacyLockPin
// before calling this) — otherwise whoever is locked out could just open Settings and disable it.
export async function clearPrivacyLockPin(uid: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(uid));
}
