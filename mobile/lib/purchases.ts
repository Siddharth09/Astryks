import { Platform } from "react-native";
import Purchases, { LOG_LEVEL, PurchasesOffering } from "react-native-purchases";

// --- RevenueCat setup ---------------------------------------------------
//
// These are PUBLIC SDK keys (safe to ship in the app binary — they're not secrets), one per
// platform, from the RevenueCat dashboard once you create a project there and connect it to
// your App Store Connect / Google Play Console apps. Until real keys are added below, the
// native calls in this file will fail gracefully (see the try/catch in each function) rather
// than crash the app — so the rest of the app keeps working, but Subscribe won't do anything
// on mobile until this is configured for real.
//
// Sid: see MOBILE_IAP_SETUP.md in the repo root for the full step-by-step of what to create
// in RevenueCat / App Store Connect / Google Play Console, and where to paste the resulting
// keys in here.
const REVENUECAT_API_KEYS = {
  ios: "REPLACE_WITH_REVENUECAT_IOS_PUBLIC_SDK_KEY",
  android: "REPLACE_WITH_REVENUECAT_ANDROID_PUBLIC_SDK_KEY",
};

// The RevenueCat "entitlement" identifier you'll create in the RevenueCat dashboard to
// represent "has an active Astryks subscription" — attach both the iOS and Android weekly
// subscription products to this one entitlement so the app doesn't need to know which store
// the purchase came from.
export const ENTITLEMENT_ID = "premium";

let configured = false;

/**
 * Call once, as soon as you know the signed-in Firebase uid (e.g. from AuthContext). Passing
 * the Firebase uid as RevenueCat's appUserID is what lets the revenueCatWebhook Cloud Function
 * map a purchase event straight back to `users/{uid}` without any extra bookkeeping.
 */
export function initPurchases(uid: string) {
  if (configured) {
    Purchases.logIn(uid).catch(() => {});
    return;
  }
  const apiKey = Platform.OS === "ios" ? REVENUECAT_API_KEYS.ios : REVENUECAT_API_KEYS.android;
  if (!apiKey || apiKey.startsWith("REPLACE_WITH_")) {
    // Not configured yet — skip silently so dev/testing on Expo Go (where this native module
    // isn't even available) and early builds don't crash.
    return;
  }
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: uid });
    configured = true;
  } catch {
    // Native module not available (e.g. running in Expo Go) — no-op.
  }
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch {
    return null;
  }
}

/** Returns true if the purchase succeeded and the entitlement is now active. */
export async function purchaseSubscription(): Promise<{ success: boolean; error?: string }> {
  try {
    const offering = await getCurrentOffering();
    const pkg = offering?.availablePackages?.[0];
    if (!pkg) {
      return { success: false, error: "Subscriptions aren't set up yet — check back soon." };
    }
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const active = !!customerInfo.entitlements.active[ENTITLEMENT_ID];
    return { success: active };
  } catch (err: any) {
    if (err?.userCancelled) return { success: false };
    return { success: false, error: err?.message ?? "Purchase failed." };
  }
}

export async function restorePurchases(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return !!customerInfo.entitlements.active[ENTITLEMENT_ID];
  } catch {
    return false;
  }
}
