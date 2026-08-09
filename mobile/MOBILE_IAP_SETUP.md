# Mobile subscriptions (RevenueCat + Apple/Google in-app purchases) — setup checklist

The code for this is now wired up (`lib/purchases.ts`, `SubscriptionBanner.tsx`,
`ReferralAndBilling.tsx`, and the `revenueCatWebhook` Cloud Function), but it can't actually
charge anyone until you do the following account/dashboard setup. None of these steps can be
done for you — they need your own Apple Developer, Google Play Console, and RevenueCat logins.

## Why this exists

The web app charges through Stripe, which is fine for a website. But Apple and Google require
digital subscriptions bought *inside* an iOS/Android app to go through their own in-app
purchase systems (Apple takes 15–30%, Google similar) — a Stripe-only checkout inside the app
would very likely get the app rejected at review (Guideline 3.1.1). RevenueCat sits in between
your app and Apple/Google's purchase APIs so you don't have to write that integration by hand
twice, and gives you one dashboard for both platforms.

## Steps

1. **Create App Store Connect subscription products** (developer.apple.com → your app →
   Subscriptions). Create one auto-renewable subscription group with a weekly subscription
   product. You'll pick a base price and can add per-territory prices — Apple auto-suggests
   equivalents in ~40 currencies, but you can manually override specific ones (this is how
   you'd try to match the AUD5/USD5/EUR5/GBP5/INR400/PHP250 scheme — it won't be pixel-exact
   the way Stripe's `currency_options` are, since Apple controls the actual price tiers).

2. **Create Google Play Console subscription products** (play.google.com/console → your app →
   Monetize → Subscriptions). Same idea — one base plan, weekly, with per-country prices you
   can edit manually per country.

3. **Create a RevenueCat account and project** (revenuecat.com). Connect it to both your App
   Store Connect account (via an App Store Connect API key you generate in App Store Connect →
   Users and Access → Integrations) and your Google Play service account (a JSON key from
   Google Cloud Console with access to the Play Developer API — RevenueCat's docs walk through
   generating this).

4. **In RevenueCat**, create an Entitlement called `premium` (must match `ENTITLEMENT_ID` in
   `lib/purchases.ts`). Attach both the iOS and Android weekly products to it. Then create an
   Offering with one Package pointing at that entitlement — this is what
   `purchaseSubscription()` in `lib/purchases.ts` fetches and buys.

5. **Copy your two public SDK keys** (RevenueCat → Project Settings → API Keys — one iOS key,
   one Android key) into `REVENUECAT_API_KEYS` at the top of
   `astryks-mobile/lib/purchases.ts`, replacing the `REPLACE_WITH_...` placeholders. These are
   public keys, safe to commit.

6. **Wire the webhook**: deploy the functions (`firebase deploy --only functions`), then in
   RevenueCat → Project Settings → Integrations → Webhooks, add the deployed
   `revenueCatWebhook` function's URL (Firebase gives you this after deploy — looks like
   `https://us-central1-astryks-5f31c.cloudfunctions.net/revenueCatWebhook`). Set an
   "Authorization header value" in that same RevenueCat screen to any long random string, then
   run:
   ```
   firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH
   ```
   and paste that same string when prompted. They have to match exactly or the webhook calls
   get rejected.

7. **Switch from Expo Go to a dev client for testing.** `react-native-purchases` is a native
   module — it does not work in the plain Expo Go app at all (the calls will silently no-op,
   which is what the try/catch in `lib/purchases.ts` is for, so the app doesn't crash for
   existing testers still on Expo Go — but they won't be able to test purchases). To actually
   test buying a subscription, you (and any testers) need a custom dev client build instead:
   ```
   npm install -g eas-cli
   eas login
   eas build --profile development --platform ios      # or --platform android
   ```
   That produces an installable build (a `.ipa`/`.apk`, or a TestFlight/internal-track link)
   that has the native RevenueCat code baked in. From then on you run `npx expo start
   --dev-client` instead of plain `npx expo start`, and install that custom build on test
   devices instead of the Expo Go app.

8. **Test with sandbox accounts** — Apple (a Sandbox Apple ID, created in App Store Connect →
   Users and Access → Sandbox Testers) and Google (a license-tester account added in Play
   Console → Setup → License testing) let you go through a real purchase flow without being
   charged real money.

9. Once real purchases are flowing, `revenueCatWebhook` keeps `users/{uid}.subscriptionStatus`
   in sync automatically — no further code changes needed.

## What's already done for you

- `lib/purchases.ts` — configures RevenueCat with the Firebase uid as its identity, and
  exposes `purchaseSubscription()` / `restorePurchases()`.
- `contexts/AuthContext.tsx` — calls `initPurchases(uid)` as soon as someone signs in.
- `SubscriptionBanner.tsx` / `ReferralAndBilling.tsx` — mobile Subscribe buttons now call
  `purchaseSubscription()` instead of opening a Stripe checkout link; "Manage subscription" now
  opens the native App Store/Play Store subscription-management screen.
- `functions/index.js` → `exports.revenueCatWebhook` — verifies the shared secret, then updates
  `subscriptionStatus` in Firestore the same way `stripeWebhook` does for web.
- `eas.json` — basic build profiles (development/preview/production) so `eas build` works out
  of the box once you're logged in with your own Expo/EAS account.
- `app.json` — added `ios.buildNumber` and `android.versionCode`, which App Store
  Connect/Play Console require on every submitted build.
