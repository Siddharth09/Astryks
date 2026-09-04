# Astryks launch checklist

Everything I could fix in code is done and pushed (see the summary at the end). Everything below
requires you personally — a dashboard login, a business decision, or a real device — so none of
it could be done from inside this session. Roughly in the order you'd actually do it.

## 1. Store accounts (do these first — everything else waits on them)

- [ ] **Apple Developer Program** account (developer.apple.com, US$99/year) if you don't already
      have one, under whatever legal entity you want listed as the seller.
- [ ] **Google Play Console** account (play.google.com/console, one-time US$25 registration fee).
- [ ] Create the app listing in **App Store Connect** — bundle ID `com.astryks.app` (already set
      in the code).
- [ ] Create the app listing in **Google Play Console** — package `com.astryks.app` (already set).

## 2. In-app purchases (the biggest remaining item — full steps in `MOBILE_IAP_SETUP.md`)

Both stores require subscriptions unlocking app content to go through their own payment system
(Apple's App Store guideline 3.1.1 / Google Play's equivalent) — you can't use Stripe directly
inside the mobile app the way the website does. The code is already built for this via
Qonversion; what's missing is the account setup:

- [ ] Create the weekly and annual subscription products in App Store Connect and Google Play
      Console.
- [ ] Create a Qonversion account/project, connect both stores, and create the `premium`
      entitlement.
- [ ] Paste your real Qonversion Project Key into `lib/purchases.ts` (currently a placeholder).
- [ ] Set the `QONVERSION_WEBHOOK_AUTH` Firebase secret and point Qonversion's webhook at your
      `qonversionWebhook` Cloud Function.
- [ ] **Test a real sandbox purchase on both platforms before submitting** — a broken Subscribe
      button is one of the most common rejection reasons, since it's the core paid feature and
      reviewers always test it.
- [ ] Also test **Restore Purchases** on a fresh install — both stores' reviewers specifically
      check that a reinstall doesn't force paying again.

## 3. Store listing content

- [ ] Screenshots for each required device size (App Store Connect and Play Console both list
      exact required sizes).
- [ ] App description, keywords, support URL, marketing URL.
- [ ] **Privacy policy URL** — you already have a real one at astryks.com/privacy; just make sure
      it's entered in both consoles' privacy policy fields.
- [ ] **Age rating questionnaire** — both stores ask about content type (user-generated posts,
      messaging between users, cash prizes) — answer accurately; a cash-prize sweepstakes and
      open messaging usually raise the minimum age rating.
- [ ] **Data safety / App Privacy labels** (Play Console "Data safety" section, App Store
      Connect's "App Privacy" section) — both require you to explicitly declare what data you
      collect (email, photos/videos, payment info via Stripe/Qonversion, usage analytics if any)
      and what it's used for. This has to match what `privacy/page.tsx` actually says.
- [ ] EAS submit credentials — `eas.json`'s `submit.production` block is currently empty; you'll
      need your Apple ID/App Store Connect API key and Google Play service account JSON before
      `eas submit` will work.

## 4. Legal & compliance review (do this with an actual lawyer, not just me)

- [ ] I fixed the Terms page so the 90-day refund guarantee is stated explicitly there (it was
      only enforced in code and shown in the app UI before, not in the Terms themselves), and
      added a Referral Program section (the $50 referral payout previously had zero terms
      coverage). I also added a direct "Sponsor" line to the Prize Rules page with your ABN — but
      it has no physical mailing address, since I don't have one to put there. **Add a real
      business address to the Prize Rules sponsor line** — some jurisdictions' sweepstakes laws
      expect this for a cash-prize promotion open worldwide.
- [ ] **Tax on subscriptions** — there's currently no tax collection configured in the Stripe
      checkout code at all (no Stripe Tax, no manual rates). Selling digital subscriptions
      across countries often carries real tax obligations (EU VAT, Australian GST, etc.) — get
      an accountant's read on this specifically before scaling up international payments. If you
      decide to turn on Stripe Tax, that's a dashboard toggle in Stripe plus a small code change
      I can make once you've enabled it on your account.
- [ ] Have someone review the Creative Prize sweepstakes structure against the actual laws of
      every country you're comfortable running it in — "worldwide, void where prohibited" is
      standard boilerplate, but a real cash prize open globally is exactly the kind of thing
      worth a specific legal sanity check before it scales.

## 5. Stripe (web payments) — verify before real money moves

- [ ] **Confirm live vs. test mode**: run `firebase functions:secrets:access STRIPE_SECRET_KEY`
      and check whether the value is a `sk_live_...` or `sk_test_...` key, and cross-check
      against the mode toggle in your Stripe Dashboard. I can't see this from code — it's a
      secret value on purpose.
- [ ] In the Stripe Dashboard, confirm the webhook endpoint has **`account.updated`** ticked as
      an event type — the code has a comment noting this exact requirement for prize-winner
      payout notifications, and it's easy to miss when setting up the webhook.
- [x] ~~Cross-check the actual Stripe Price objects against `lib/geo.ts`~~ — resolved by removing
      the manual per-currency setup entirely. The Stripe Prices are now a single AUD amount each
      (A$4.99/week, A$199/year — the account's only settlement currency), with Stripe's own
      Adaptive Pricing handling every other currency's real charge automatically (no
      `currency_options` left to drift). `lib/geo.ts`'s pre-checkout display now pulls live rates
      from `config/exchangeRates`, refreshed daily by `refreshExchangeRates` — also no longer a
      hand-maintained table. **Still needed: enable Adaptive Pricing in the Stripe Dashboard**
      (dashboard.stripe.com/settings/adaptive-pricing) — that one toggle has no API equivalent, so
      it can't be done from code.

## 6. Data migration & security follow-ups

- [ ] **Confirm `migratePrivatePostMedia` has actually been run against production data.** There's
      a known, deliberate gap in Storage rules for posts uploaded before that migration existed —
      their media stays reachable by anyone with the file URL, even if the post is set to
      private, until that migration moves them to the new path. If you're not sure it's been run,
      run it once (there's an admin-only callable for it) and spot-check a private post's media
      URL isn't publicly fetchable afterward.
- [ ] **Turn on 2FA** on the Google account listed in `ADMIN_EMAILS` — that one email address is
      currently the entire authorization boundary for refund approval, prize payouts, and account
      deletion. No code change needed, just enable it on that account directly.
- [ ] Decide when to flip Firebase App Check from "Monitor" to "Enforce" — it's deliberately left
      unenforced until the mobile app can send its own App Check tokens (a separate native
      App Attest/Play Integrity setup, not part of the Qonversion IAP work above). Worth
      revisiting once the mobile app is live and stable.

## 7. Nice-to-have, not blocking

- [ ] Set up crash reporting (Sentry or similar) for the mobile app — there's currently zero
      production crash visibility once it's in users' hands.
- [ ] A properly designed 1200×630 Open Graph share image — I wired up link-preview metadata
      using your existing square logo as a placeholder, which works but isn't as polished as a
      purpose-designed image.

---

## What's already done (from this session)

**Mobile app — this was the most important find**: the app literally couldn't build. Three
foundational files (`lib/styles.ts`, `tsconfig.json`, `babel.config.js`) were missing entirely,
and three screens `require()`'d image/video assets that don't exist in the repo. All fixed and
verified — I actually ran `npx expo export` for both iOS and Android and confirmed a real,
successful bundle, not just a code read-through.

**Backend**: fixed a webhook idempotency bug that could permanently drop a failed-then-retried
Stripe event, and a bug where a temporary card-decline (`past_due`, still recoverable) sent the
same "your subscription has been canceled" email as a real cancellation. Added a `.gitignore` to
both repos (neither had one). Confirmed (via independent audit) that signature verification,
admin authorization, refund/payout idempotency, and Firestore/Storage rules for financial and
personal data are all already implemented correctly.

**Web app**: added a custom 404 page and error boundary (previously any broken link or crash
showed Next.js's raw default screen), Open Graph/Twitter link-preview metadata, `robots.txt` and
a sitemap, aria-labels on a couple of icon-only buttons and the login/signup form fields, and the
Terms/Prize-Rules content fixes described above.

Everything's been pushed to both `astryks-app` and `Astryks-GitHub` — commands to run are in the
chat.
