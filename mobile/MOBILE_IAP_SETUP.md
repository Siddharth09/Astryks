# Mobile in-app purchases (Qonversion) — setup steps

The mobile app's Subscribe button goes through Qonversion, which brokers Apple's StoreKit and
Google Play Billing — this is required by both stores' rules for unlocking digital content
inside an app (you can't call Stripe directly from the mobile app the way the website does).
The code is already wired up (`lib/purchases.ts`, and `qonversionWebhook` in
`astryks-app/functions/index.js`) — what's missing is the actual account setup below. None of
these steps can be done from inside this coding session; they all require signing into
dashboards with your own accounts.

## 1. Create your App Store Connect and Google Play Console apps (if not done already)

You need both apps registered before Qonversion can attach real subscription products to them.
See the main launch checklist for the full store-account steps — do that first if you haven't.

## 2. Create the subscription products in each store

**App Store Connect** (App Store Connect → your app → Subscriptions):
- Create a Subscription Group (e.g. "Astryks Premium").
- Add a weekly subscription product, e.g. product ID `astryks_weekly`.
- Add an annual subscription product, e.g. product ID `astryks_annual`.
- Price them to match `lib/geo.ts`'s displayed prices as closely as each store's pricing tiers
  allow (they won't match to the cent — App Store/Play pricing is tier-based per country).
- Fill in the required subscription display name, description, and review screenshot for each.

**Google Play Console** (Play Console → your app → Monetize → Products → Subscriptions):
- Create a base plan for weekly and one for annual, same product-id convention as above.
- Set pricing per country.

## 3. Create a Qonversion account and project

1. Sign up at qonversion.com and create a Project for Astryks.
2. Under the project, add your iOS app (bundle ID `com.astryks.app`) and Android app (package
   `com.astryks.app` — both already set correctly in `app.json`).
3. Under each store integration, connect:
   - **iOS**: your App Store Connect API key (generate one under App Store Connect → Users and
     Access → Integrations → App Store Connect API — Qonversion's docs walk through the exact
     permissions needed).
   - **Android**: your Google Play service account JSON (Play Console → Setup → API access).
4. In Qonversion, create Product entries that map to the exact product IDs you created in step 2
   for both stores.
5. Create an **Entitlement** called `premium` (this exact id — it must match `ENTITLEMENT_ID` in
   `lib/purchases.ts` and the `qonversionWebhook` function). Attach both the weekly and annual
   products from both stores to this one entitlement, so the app doesn't need to know which
   product or store a purchase came from — it just checks "is `premium` active."

## 4. Wire the Qonversion Project Key into the app

1. Qonversion dashboard → Settings → your project → copy the **Project Key** (this is public,
   safe to ship in the app binary — not a secret).
2. Open `lib/purchases.ts` and replace:
   ```ts
   const QONVERSION_PROJECT_KEY = "REPLACE_WITH_QONVERSION_PROJECT_KEY";
   ```
   with the real key.
3. Rebuild the app (`eas build`) — Subscribe will now attempt a real purchase instead of showing
   "Subscriptions aren't set up yet."

## 5. Wire the Qonversion webhook into Firebase

This is what actually updates `subscriptionStatus` on a user's Firestore doc after a real
purchase, so the rest of the app (paywall, Learn tab, etc.) sees them as subscribed.

1. Pick any secret string yourself (e.g. generate one with `openssl rand -hex 32`) — this is
   the shared secret between Qonversion and your Cloud Function, not a Qonversion-issued value.
2. Set it as a Firebase secret (run from the `astryks-app` directory, which has your Firebase
   project config):
   ```
   firebase functions:secrets:set QONVERSION_WEBHOOK_AUTH
   ```
   paste the same string when prompted.
3. In the Qonversion dashboard: Settings → Integrations → Webhooks:
   - Webhook URL: `https://<your-region>-astryks-5f31c.cloudfunctions.net/qonversionWebhook`
     (check the exact deployed URL with `firebase functions:list`, or by looking at the deploy
     output the next time you run `firebase deploy --only functions`).
   - Header: `Authorization`
   - Value: `Basic <the same secret string from step 1>`
4. Redeploy the function so it picks up the new secret:
   ```
   firebase deploy --only functions:qonversionWebhook
   ```

## 6. Test end-to-end before submitting to review

- **iOS**: use a real device (not the simulator — StoreKit purchases don't work there) with a
  Sandbox Apple ID (App Store Connect → Users and Access → Sandbox Testers). Install a
  development or TestFlight build, tap Subscribe, complete a sandbox purchase, then check the
  corresponding `users/{uid}` Firestore doc updates to `subscriptionStatus: "active"` within a
  few seconds.
- **Android**: use a Play Console internal/closed testing track with a license tester account,
  same check.
- Also test **Restore Purchases** (already wired up as `restorePurchases()` in
  `lib/purchases.ts`) on a fresh install with the same test account, to confirm someone who
  reinstalls the app gets their subscription back without paying again — reviewers on both
  stores specifically check for this.

## 7. What happens to existing web (Stripe) subscribers on mobile?

Nothing automatic — a Stripe subscriber's `subscriptionStatus` is already `"active"` in
Firestore regardless of which webhook set it, so they'll see full access in the mobile app too
without needing to also buy the Qonversion/IAP subscription. Someone who subscribes on mobile
gets a *separate* Apple/Google subscription from a web Stripe one — there's no automatic
"can I use my existing Stripe subscription in the app" flow, since neither store allows
recognizing an external purchase for unlocking content this way. If you want to support that
combination cleanly (e.g. "restore" a web purchase inside the app), that needs its own product
decision — it's not something either store's IAP system does out of the box.
