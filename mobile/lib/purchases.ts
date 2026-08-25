import Qonversion, {
  QonversionConfigBuilder,
  LaunchMode,
  Environment,
  Product,
} from "@qonversion/react-native-sdk";

// --- Qonversion setup ----------------------------------------------------
//
// This is a PUBLIC Project Key (safe to ship in the app binary — it's not a secret). Unlike
// RevenueCat (which uses separate iOS/Android public keys), Qonversion uses a single
// cross-platform Project Key from the Qonversion dashboard, once you create a project there
// and connect it to your App Store Connect / Google Play Console apps. Until a real key is
// added below, the native calls in this file will fail gracefully (see the try/catch in each
// function) rather than crash the app — so the rest of the app keeps working, but Subscribe
// won't do anything on mobile until this is configured for real.
//
// Sid: see MOBILE_IAP_SETUP.md in the repo root for the full step-by-step of what to create
// in Qonversion / App Store Connect / Google Play Console, and where to paste the resulting
// key in here.
const QONVERSION_PROJECT_KEY = "kSzWfRt8hXZu44-i_ZaF-gpFTS3Fif1Z";

// The Qonversion "entitlement" identifier you'll create in the Qonversion dashboard to
// represent "has an active Astryks subscription" — attach both the iOS and Android weekly
// subscription products to this one entitlement so the app doesn't need to know which store
// the purchase came from.
export const ENTITLEMENT_ID = "premium";

let configured = false;

/**
 * Call once, as soon as you know the signed-in Firebase uid (e.g. from AuthContext). Passing
 * the Firebase uid as Qonversion's custom user ID (via `identify`) is what lets the
 * qonversionWebhook Cloud Function map a purchase event straight back to `users/{uid}` without
 * any extra bookkeeping.
 */
export function initPurchases(uid: string) {
  if (!QONVERSION_PROJECT_KEY || QONVERSION_PROJECT_KEY.startsWith("REPLACE_WITH_")) {
    // Not configured yet — skip silently so dev/testing on Expo Go (where this native module
    // isn't even available) and early builds don't crash.
    return;
  }
  try {
    if (!configured) {
      const config = new QonversionConfigBuilder(
        QONVERSION_PROJECT_KEY,
        LaunchMode.SUBSCRIPTION_MANAGEMENT
      )
        .setEnvironment(__DEV__ ? Environment.SANDBOX : Environment.PRODUCTION)
        .build();
      Qonversion.initialize(config);
      configured = true;
    }
    // Links this device's Qonversion identity to the Firebase uid — fire-and-forget, matches
    // the qonversionWebhook Cloud Function's expectation that custom_user_id == users/{uid}.
    Qonversion.getSharedInstance()
      .identify(uid)
      .catch(() => {});
  } catch {
    // Native module not available (e.g. running in Expo Go) — no-op.
  }
}

export type PlanId = "weekly" | "annual";

// Must match the Product IDs created in App Store Connect / Google Play Console, and the
// Qonversion dashboard Product entries mapped to them (see MOBILE_IAP_SETUP.md step 3).
const PRODUCT_IDS: Record<PlanId, string> = {
  weekly: "astryks_weekly",
  annual: "astryks_annual",
};

// Qonversion's RN SDK has no RevenueCat-style "offering" wrapper — `products()` returns a flat
// Map<string, Product> of everything configured in the dashboard, keyed by Product ID.
async function getProduct(planId: PlanId): Promise<Product | null> {
  try {
    const products = await Qonversion.getSharedInstance().products();
    return products.get(PRODUCT_IDS[planId]) ?? null;
  } catch {
    return null;
  }
}

/** Returns true if the purchase succeeded and the entitlement is now active. */
export async function purchaseSubscription(planId: PlanId): Promise<{ success: boolean; error?: string }> {
  try {
    const product = await getProduct(planId);
    if (!product) {
      return { success: false, error: "Subscriptions aren't set up yet — check back soon." };
    }
    const result = await Qonversion.getSharedInstance().purchaseWithResult(product);
    if (result.isCanceled) return { success: false };
    if (result.isPending) {
      return { success: false, error: "Purchase is pending approval — check back shortly." };
    }
    if (result.isError) {
      return { success: false, error: result.error?.description ?? "Purchase failed." };
    }
    const active = !!result.entitlements?.get(ENTITLEMENT_ID)?.isActive;
    return { success: active };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Purchase failed." };
  }
}

export async function restorePurchases(): Promise<boolean> {
  try {
    const entitlements = await Qonversion.getSharedInstance().restore();
    return !!entitlements?.get(ENTITLEMENT_ID)?.isActive;
  } catch {
    return false;
  }
}
