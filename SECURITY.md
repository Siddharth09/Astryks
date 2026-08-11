# Astryks Security Posture

Last updated: 2026-08-11. This document is the single source of truth for what's protected, what's deliberately deferred (and why), and what to check before shipping anything that touches user data, money, or auth.

## What's protected today

**Data isolation & privacy**
- Firestore and Storage security rules enforce per-user ownership on all reads/writes (posts, profiles, messages, payout details, refund requests).
- Post media (web and mobile) is written under a path keyed by the post's own document ID (`posts/{uid}/{postId}/...`), not a flat public path — so a post marked "Private" can't be reached by guessing a URL.
- No financial detail (card numbers, bank details) ever touches our own servers or database — Stripe Checkout/Billing Portal handles all of that via full-page redirect; Qonversion handles mobile in-app-purchase receipts. We only ever store Stripe/Qonversion customer + subscription IDs.

**Abuse & rate limiting**
- A Firestore-transaction-based rate limiter (`enforceRateLimit`) caps calls per account on: link-preview fetches, report submissions, payout-detail submissions, message-suggestion requests, referral-code validation, checkout-session creation, and refund requests.
- Likes are deduplicated and validated server-side (one like per user per post, enforced by security rules — not just client-side UI state), so leaderboard/prize standings can't be inflated by replaying a like request.

**Network-facing code**
- `fetchLinkPreview` (the one endpoint that fetches an arbitrary user-supplied URL) resolves the hostname via DNS first, validates every resolved IP isn't private/loopback/link-local, and connects directly to that pinned IP — closing both direct SSRF and DNS-rebinding races.
- Content-Security-Policy on the web app is built from an actual audit of every external domain the app calls (Firebase, Bunny video, Google sign-in) — not a guessed/broad policy. Full reasoning is in the comment block at the top of `next.config.js`.
- Standard security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS) are set on every response.

**Dependencies (as of this doc)**
- Web (`astryks-app`): Next.js 15.5.23 (fully patched line — no known CVEs), React 18.3.1, firebase 12.x. `npm audit`: 0 findings.
- Functions (`astryks-app/functions`): firebase-admin 13.10.0, with `uuid` force-overridden to a patched version. `npm audit`: 0 findings.
- Mobile (`astryks-mobile`): Expo SDK 54, React Native 0.81.5, React 19.1.0. `npm audit`: findings remain, but see "Deferred" below — they're confined to build-time tooling (Metro bundler, Expo config-plugins), not code that ships in the app binary.

## Deliberately deferred (and why)

**Mobile npm audit — Metro/Expo CLI tooling vulnerabilities.** `image-size`, `postcss`, and `uuid` findings inside Metro and `@expo/config-plugins` all require jumping the Expo SDK forward 3 versions (54 → 57) to close. These packages run at build/bundle time on a developer's machine or in EAS Build's cloud service — they never ship inside the actual app binary a user installs, so the real-world exploit surface is low. A 3-SDK-version jump risks breaking native module compatibility in ways only discoverable with a real device build, so this is left for a deliberate, tested SDK upgrade later rather than a blind force-fix.

**Firebase App Check — not yet enforced.** The web app has dormant App Check scaffolding (`lib/firebase.ts`) that activates only if `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is set. It is NOT set yet — that requires registering a reCAPTCHA v3 key in the Firebase console (a manual, one-time step, see below). Do not flip any Firestore/Storage/Functions product to "Enforce" in the App Check console until mobile sends App Check tokens too, or real mobile users will get blocked.

**Mobile native App Check — investigated, needs a decision before real code changes.** Astryks mobile talks to Firebase entirely through the plain `firebase` JS SDK (same package as web), not `@react-native-firebase`. Native App Check attestation (App Attest on iOS, Play Integrity on Android) only exists in `@react-native-firebase/app-check`, and — this is the important part — installing that package alone would NOT protect any of the app's real Firestore/Storage/Functions traffic, because those calls all go through the JS SDK, and the JS SDK has no built-in bridge to a native-attested token on React Native. Adding the native package would just be inert weight without also either (a) migrating every Firestore/Storage/Functions/Auth call on mobile to the native `@react-native-firebase/*` modules (a large, real migration — touches most files in `app/` and `lib/`), or (b) manually fetching a native App Check token and attaching it to each JS-SDK call by hand (fragile, easy to miss a call site). Given App Check stays in Monitor-only mode for a long time regardless (see above), this is left as a deliberate future decision rather than a half-integration that would give false confidence. Revisit when ready to commit to the full native-SDK migration.

**Mobile app icon fix — committed but not shipped.** The corrected black-background home-screen icon and Android adaptive-icon color are in git, but native icons can't be pushed via `eas update` (OTA) — they only reach a real installed app via a new EAS Build + App Store/Play Store submission.

## Review checklist before shipping anything security-sensitive

Run through this before merging/deploying a change that touches auth, billing, user-generated content, or any endpoint that calls out to a URL:

1. Does this new Cloud Function need a rate limit? If it's callable by any authenticated user and does meaningful work (writes, external calls, sends email), add an `enforceRateLimit` call.
2. Does this touch Firestore/Storage rules? Re-read the affected `match` block and confirm it can't be reached by a user who isn't the owner/admin.
3. Does this add a new external domain the app calls? Update the CSP in `next.config.js` — don't just widen a directive to `*`.
4. Does this touch anything Stripe/Qonversion-related? Confirm no card/bank detail is ever received or logged by our own code.
5. Did `npm install` change anything? Run `npm audit` before committing the lockfile — if it flags something, check whether the fix is safe (patch/minor) or a forced major bump (needs a deliberate decision, not `--force` on autopilot).
6. Mobile-only: did a native dependency change? That needs a fresh EAS Build to actually test — an OTA `eas update` alone won't catch native-side breakage.

## Recommended cadence

A scheduled task runs periodically (see the Astryks security check-in task) to re-run `npm audit` on all three package.json files and flag anything new. Beyond that, re-read this document before any release that touches billing, auth, or user data structure.
