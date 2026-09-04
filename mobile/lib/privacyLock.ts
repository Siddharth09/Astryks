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
const PIN_HASH_KEY = "astryks_privacy_lock_pin_hash";

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

export async function isPrivacyLockEnabled(): Promise<boolean> {
  const hash = await SecureStore.getItemAsync(PIN_HASH_KEY);
  return !!hash;
}

export async function setPrivacyLockPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
}

export async function verifyPrivacyLockPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

// Turning the lock off requires the current PIN (checked by the caller via verifyPrivacyLockPin
// before calling this) — otherwise whoever is locked out could just open Settings and disable it.
export async function clearPrivacyLockPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_HASH_KEY);
}
