# App Store / Play Store submission — metadata pack

Everything below is a draft you can copy straight into App Store Connect and Google Play
Console. Adjust the bracketed bits (support email, screenshots) — everything else is written
to match the app as it's actually built today.

## App identity

- **App name:** Astryks
- **Subtitle (iOS, 30 chars max):** Learn, create, get discovered
- **Short description (Android, 80 chars max):** Masterclasses, a creative feed, and a monthly cash prize.
- **Bundle ID / package name:** `com.astryks.app` (already set in `app.json`)
- **Category:** Education (primary), Lifestyle or Social Networking (secondary, if the store allows one)
- **Support URL:** `https://astryks.com/support` — [confirm this page exists; if not, a `mailto:` support email works for App Store Connect, but Google Play requires a real URL]
- **Marketing URL (optional):** `https://astryks.com`
- **Privacy Policy URL:** `https://astryks.com/privacy` (live once the web app is deployed — see the deployment notes below)

## Full description (App Store / Play Store long description)

```
Astryks is where learning meets community. Take masterclasses from real teachers, share your
own creative work, and get discovered.

LEARN
Stream video masterclasses across creative and practical skills, at your own pace, on any
device.

SHARE YOUR WORK
Post photos, videos, and updates to a feed built for creators — follow people whose work you
admire, and build a following of your own.

COMPETE FOR THE MONTHLY CREATIVE PRIZE
Every month, the post with the most likes from the community wins a cash prize. No purchase
necessary to enter — just post and get liked.

SUBSCRIBE
A single subscription unlocks every masterclass, with straightforward pricing shown in your
local currency before you subscribe. Cancel anytime.

Astryks membership renews automatically through your [App Store / Google Play] account unless
auto-renew is turned off at least 24 hours before the end of the current period. Manage or
cancel anytime in your [Apple ID / Google Play] account settings.
```

## Keywords (App Store, 100 chars, comma-separated, no spaces after commas)

```
masterclass,learning,online course,creative,social,feed,contest,prize,skills,community
```

## What's New (first submission)

```
Welcome to Astryks! Masterclasses, a creative feed, and our first monthly Creative Prize.
```

## Screenshots needed (you'll need to capture these — I can't generate real device screenshots)

At minimum, for each required device size:
1. Home/feed screen
2. A masterclass/lesson player screen
3. The Prizes/leaderboard screen
4. Subscribe screen (showing localized pricing)
5. A profile screen

iOS requires 6.7" (iPhone 15 Pro Max or similar) and 6.5" screenshots at minimum; Android
requires at least 2 phone screenshots (1080p+ recommended).

## Age rating questionnaire — suggested answers

Both stores ask a series of yes/no questions to compute a rating. Based on how the app is
built today (user-generated photo/video posts, direct messages, no gambling, no violence):

- **User-generated content:** Yes (photos, videos, comments, messages) → this alone typically
  pushes the rating to 12+/Teen on both stores, since unmoderated UGC can't be guaranteed
  age-appropriate.
- **Simulated gambling / real gambling:** No — the Creative Prize is a skill-based contest
  (highest like count wins), not a game of chance or wagering, so this should be answered No.
  [If your lawyer's review of `prize-rules/page.tsx` concludes otherwise for a specific
  jurisdiction, revisit this.]
- **Violence, sexual content, profanity:** No, not intentionally designed into the app — but
  because it's UGC, both stores expect you to describe your moderation/reporting process (you
  have post reporting — confirm this in the questionnaire's content-moderation section).
- **Unrestricted web access / in-app browser:** Yes (Stripe/Qonversion checkout, external
  links).
- **Age requirement to use the app:** Terms of Service already states 18+. Set the minimum age
  in each store's age-rating tool to reflect that if the tool allows a hard minimum; otherwise
  the computed content rating (likely 12+/Teen) is what actually gates the store listing, and
  your Terms' 18+ requirement is enforced by you, not by the store.

## Google Play "Data Safety" section — suggested mapping

Based on what the app actually collects (see `app/privacy/page.tsx`):

| Data type | Collected? | Shared with 3rd party? | Purpose |
|---|---|---|---|
| Name | Yes | No | Account management |
| Email address | Yes | No | Account management |
| User photos/videos | Yes | No (except Bunny.net/Firebase as processors) | App functionality |
| Messages | Yes | No | App functionality |
| Approximate location (country only, from device locale) | Yes | No | App functionality (localized pricing) |
| Purchase history | Yes | Apple/Google/Stripe (payment processors) | App functionality |
| App interactions (usage data) | Yes | No | App functionality |

Declare **no data sold**, and **no data used for advertising/tracking purposes** (there's no ad
SDK in this app as built). Declare **data encrypted in transit** (Firebase/Stripe/Bunny all use
HTTPS/TLS) and that you provide an in-app account-deletion path if you have one — if not yet
built, Google Play now requires a working account-and-data-deletion flow before you can
publish; this is worth checking before submission.

## Apple "App Privacy" (nutrition label) — suggested mapping

Roughly mirrors the Play table above using Apple's categories: **Contact Info** (name, email),
**User Content** (photos, videos, messages), **Identifiers** (Firebase uid), **Purchases**
(subscription status), **Location** (coarse, derived from locale — not precise GPS). Mark none
of it as "used to track you across apps or websites owned by other companies" (no ad SDK
present), so you can answer "Data Not Used to Track You."

## Export compliance (iOS submission question)

Astryks only uses standard HTTPS/TLS (via Firebase, Stripe, Bunny SDKs) — no custom encryption.
You can typically answer "No" to "Does your app use encryption" beyond exempt standard
HTTPS, but confirm the exact wording against Apple's current questionnaire at submission time,
since this determines whether you need to file a US export-compliance document.

## Before you submit — dependencies from other parts of this work

- `/terms`, `/privacy`, and `/prize-rules` need to be live at astryks.com (see the deployment
  notes I sent separately) before store review, since both stores check that the privacy
  policy URL actually resolves.
- The Qonversion/IAP integration (see `MOBILE_IAP_SETUP.md`) needs to be fully wired — with
  real subscription products approved in App Store Connect/Play Console — before submitting,
  since Apple in particular will reject a submission where the subscribe flow doesn't work.
