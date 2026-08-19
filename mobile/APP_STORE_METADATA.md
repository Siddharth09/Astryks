# App Store / Play Store submission — metadata pack

Everything below is a draft you can copy straight into App Store Connect and Google Play
Console. Adjust the bracketed bits (support email, screenshots) — everything else is written
to match the app as it's actually built today.

## App identity

- **App name:** Astryks
- **Subtitle (iOS, 30 chars max):** Masterclasses & a $1,000 prize *(30 chars exactly)*
- **Promotional text (iOS, 170 chars max — the only App Store Connect text field you can edit any time without a new build):**
  ```
  New this month: a $1,000 Creative Prize, free to enter every time you post. Music & Art masterclasses from AU$5/week, with a 10-minute free preview.
  ```
- **Short description (Android, 80 chars max):** Masterclasses in Music & Art, a creative feed, and a monthly $1,000 prize. *(75 chars, matches the live Play Store draft in `PLAY_STORE_SUBMISSION.md`)*
- **Bundle ID / package name:** `com.astryks.app` (already set in `app.json`)
- **Category:** Education (primary), Lifestyle or Social Networking (secondary, if the store allows one)
- **Support URL:** `https://astryks.com/support`
- **Marketing URL (optional):** `https://astryks.com`
- **Privacy Policy URL:** `https://astryks.com/privacy` (live)

## Full description (App Store / Play Store long description)

Kept in sync with `PLAY_STORE_SUBMISSION.md`'s description — same product, same copy, only the
renewal-account wording changes per store below.

```
Astryks is where learning meets community. Take masterclasses from real teachers, share your
own creative work, and get discovered.

LEARN
Stream masterclasses in Music and Art from working professionals — not just people who talk
about it. Every subject opens with a 10-minute free preview, no account or card required.

SHARE YOUR WORK
Post photos and videos to a feed built for creators. Follow people whose work you admire, and
build a following of your own. Posting is always free.

WIN THE MONTHLY CREATIVE PRIZE
Every month, whoever's single post has the most likes wins AU$1,000 — as long as it's reached
at least 30 likes. Entering is free for every Astryks member, subscribed or not. No purchase
necessary.

SUBSCRIBE FOR FULL ACCESS
AU$5/week or AU$250/year unlocks every masterclass. Cancel anytime, and get a full refund
within 90 days, no questions asked.

Astryks membership renews automatically through your Apple ID account unless auto-renew is
turned off at least 24 hours before the end of the current period. Manage or cancel anytime in
Settings → [your name] → Subscriptions on your device.
```

## Keywords (App Store, 100 chars, comma-separated, no spaces after commas)

```
music,art,masterclass,learning,online course,creative,social,feed,contest,prize,community
```

## What's New (first submission)

```
Welcome to Astryks! Music & Art masterclasses, a creative feed, and our first monthly $1,000
Creative Prize.
```

## Screenshots

Two sets exist:
1. **Real device screenshots** (7 shots from TestFlight testing, already resized to Apple's
   1242×2688 6.5" bucket and uploaded as part of the current submission) — these show the app
   as-is.
2. **Marketing/promo screenshots** — 5 pastel-branded slides (free-to-post, the Creative Prize,
   masterclasses, music, art), 1242×2688px, in `astryks-mobile/../store-assets` (sent to you
   separately). Swap these in via App Store Connect → your version → Screenshots once the app
   is approved — screenshots can be updated without a new build.

Google Play still needs at least 2 real device screenshots (1080p+) — same constraint as
before: needs a real Android phone or emulator to capture from.

## Age rating — already completed

The iOS Age Ratings questionnaire was already filled out and submitted in App Store Connect as
part of the current review. Google Play's Content Rating questionnaire (IARC) still needs to be
filled out once Play Console access is unblocked — same answers as below apply on both stores.
Reasoning, for reference (based on how the app is built: user-generated photo/video posts,
direct messages, no gambling, no violence):

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

## Status

- `/terms`, `/privacy`, and `/prize-rules` are live at astryks.com — done.
- Qonversion/IAP (see `MOBILE_IAP_SETUP.md`) is wired with real subscription products — done.
- iOS build submitted, Age Ratings questionnaire completed, currently "Waiting for Review."
- Once approved: swap in the 5 marketing screenshots above, double-check the Promotional Text
  and Subtitle fields above are saved, and this metadata pack is otherwise ready to paste as-is.
- Android/Play Store is blocked on your Play Console account verification (needs a real
  Android 10+ device + your own government ID upload) — see `PLAY_STORE_SUBMISSION.md`.
