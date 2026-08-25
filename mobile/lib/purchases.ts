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

export type RealProductPrice = { pretty: string; amount: number; currencyCode: string };

// The store (Apple/Google) converts our USD-anchored price into the shopper's actual local
// currency and tier — e.g. our $4.99 USD weekly product becomes A$7.99 for an Australian
// storefront, not the "A$4.99" a naive same-number-different-symbol guess would produce. Once
// Qonversion has loaded the real Product objects (which mirror what the store's own purchase
// sheet will show), this is the only source of truth for what to display pre-checkout — see
// lib/pricing.ts, which prefers this over lib/geo.ts's static approximate table.
export async function getRealProductPrices(): Promise<Record<PlanId, RealProductPrice | null>> {
  try {
    const products = await Qonversion.getSharedInstance().products();
    const toPrice = (product: Product | undefined): RealProductPrice | null => {
      if (!product?.prettyPrice || product.price == null || !product.currencyCode) return null;
      return { pretty: product.prettyPrice, amount: product.price, currencyCode: product.currencyCode };
    };
    return {
      weekly: toPrice(products.get(PRODUCT_IDS.weekly)),
      annual: toPrice(products.get(PRODUCT_IDS.annual)),
    };
  } catch {
    return { weekly: null, annual: null };
  }
}

/** Returns true if the purchase succeeded and the entitlement is now active. */
export async function purchaseSubscription(planId: PlanId): Promise<{ success: boolean; error?: string }> {
  try {
    const product = await getProduct(planId);
    if (!product) {
      return { success: false, error: "Subscriptions aren't set up yet — check back soon." };
    }

    // Re-check the real entitlement (via the store, not our own possibly-stale Firestore/local
    // state) right before buying. Every "Subscribe" button is already hidden once our local
    // subscriptionStatus reads "active", but that value is a one-time fetch with no live
    // listener — subscribing on another device, or the webhook landing a beat after this screen
    // loaded, can leave it stale. Since Apple treats weekly/annual as the same subscription
    // group, buying the second plan while the first is still active doesn't double-charge, but
    // it does throw a confusing native "you're currently subscribed to this" dialog instead of
    // our own clear messaging — checking here catches that case before the store ever sees it.
    try {
      const currentEntitlements = await Qonversion.getSharedInstance().checkEntitlements();
      if (currentEntitlements?.get(ENTITLEMENT_ID)?.isActive) {
        return {
          success: true,
          error: "You're already subscribed — manage your plan from Settings if you'd like to switch.",
        };
      }
    } catch {
      // Entitlement check failed (offline, etc.) — fall through and let the purchase attempt
      // itself be the source of truth, same as before this guard existed.
    }

    const result = await Qonversion.getSharedInstance().purchaseWithResult(product);
    if (result.isCanceled) return { success: false };
    if (result.isPending) {
      return { success: false, error: "Purchase is pending approval — check back shortly." };
    }
    if (result.isError) {
      return { success: false, error: result.error?.description ?? "Purchase failed." };
    }
    // Trust the store's own success signal (result.isSuccess) rather than requiring the
    // ENTITLEMENT_ID to already show as active in this same result's entitlements map. Apple/
    // Google have already charged the user by this point — the native "purchase successful"
    // sheet has already shown — but entitlement attachment can lag a beat behind that. Checking
    // the entitlement map instead of isSuccess meant a purchase that fully succeeded at the
    // store level could still come back as { success: false } with no error message, silently
    // leaving both "Subscribe Weekly"/"Subscribe Annual" buttons back on screen with no
    // indication anything had happened — which is exactly what let someone attempt (and get
    // most of the way through) a second purchase for the other plan moments after the first
    // one succeeded.
    return { success: result.isSuccess };
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
