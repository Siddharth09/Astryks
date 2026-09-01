# Play Store submission — ready-to-paste draft

Written to match the app as actually built today (Music + Art only, AU$5/week or AU$250/year
subscription, 10-minute free preview per subject, a community Hall of Fame). Paste
straight into Play Console once you're logged in — nothing here needs editing except where
noted in brackets.

## App details

- **App name:** Astryks
- **Short description (80 chars max):**
  ```
  Masterclasses in Music & Art, a creative feed, and a community Hall of Fame.
  ```
- **Package name:** `com.astryks.app` (already set in `app.json` — cannot be changed after first upload)
- **Category:** Education (primary)
- **Contact email:** support@astryks.com
- **Website:** https://astryks.com
- **Privacy Policy URL:** https://astryks.com/privacy

## Full description (4,000 chars max — this is ~1,000)

```
Astryks is where learning meets community. Take masterclasses from real teachers, share your
own creative work, and get discovered.

LEARN
Stream masterclasses in Music and Art from working professionals — not just people who talk
about it. Every subject opens with a 10-minute free preview, no account or card required.

SHARE YOUR WORK
Post photos and videos to a feed built for creators. Follow people whose work you admire, and
build a following of your own. Posting is always free.

HALL OF FAME
The community's best work, featured right on the Home tab — our team spotlights posts they
love, and each month's 5 most-liked posts are added automatically. Nothing to enter, no
purchase necessary.

SUBSCRIBE FOR FULL ACCESS
AU$5/week or AU$250/year unlocks every masterclass. Cancel anytime, and get a full refund
within 90 days, no questions asked.

Astryks membership renews automatically through your Google Play account unless auto-renew is
turned off at least 24 hours before the end of the current period. Manage or cancel anytime in
your Google Play subscriptions settings.
```

## Data Safety section (Play Console will ask you to fill this in as a questionnaire)

This mirrors exactly what's declared in Apple's App Privacy label (published), verified
against the actual code:

| Data type | Collected? | Shared with 3rd parties? | Purpose |
|---|---|---|---|
| Name | Yes | No | App functionality (account/profile) |
| Email address | Yes | No | App functionality (account/login) |
| Photos and videos | Yes | No | App functionality (posts) |
| Messages | Yes | No | App functionality (in-app messaging) |
| Other in-app content (text posts, comments) | Yes | No | App functionality |
| User IDs | Yes | No | App functionality |
| Device or other IDs | Yes | No | App functionality (push notification token) |
| Approximate location | Yes | No | App functionality (regional pricing, country-level only, no GPS) |
| Purchase history | Yes | Google Play (as payment processor) | App functionality (subscription management) |
| Crash logs | Yes | No | App functionality (self-hosted crash reporting) |

Declare:
- **Data is encrypted in transit:** Yes (all traffic over HTTPS/TLS via Firebase/Stripe/Bunny)
- **Users can request data deletion:** Yes — the app has an in-app "Delete my account" option
  (Me tab → Delete my account)
- **Data sold to third parties:** No
- **Data used for advertising/tracking:** No — there is no ad SDK and no cross-app/cross-site
  tracking anywhere in this app

## Content rating questionnaire — suggested answers

- User-generated content: Yes (photos, videos, comments, messages) — this alone typically
  results in a rating equivalent to Apple's 13+/Teen.
- Simulated gambling: No — the app has no prize, contest, or wagering mechanic at all (the
  former Creative Prize was retired in favor of the Hall of Fame, a purely editorial/curated
  gallery with no cash involved).
- Violence, sexual content, profanity: No, not intentionally designed into the app; content
  moderation exists via post reporting and a self-hosted moderation review.
- Shares user location: Yes, coarse/country-level only, for regional pricing — not precise
  GPS location.

## Before you submit

- **Android build**: needs `eas build --profile production --platform android` run from your
  own Terminal (same reason as iOS — this sandboxed session has no interactive terminal, so it
  can't complete Apple/Google's login+2FA flow). This produces an `.aab` file.
- **Google Play sign-in**: I could not access Play Console at all tonight — it needs your own
  Google account login (2FA), which I'm not able to do on your behalf. Everything above is
  ready to paste in once you're signed in.
- **Qonversion Android product setup**: the AU$5/week and AU$250/year subscription products
  need to be created in Play Console (Monetize → Products → Subscriptions) with the same
  product IDs already configured in Qonversion's dashboard, mirroring what's set up for iOS.
- **Screenshots**: same constraint as iOS — needs a real device/emulator, which needs Xcode
  installed for the iOS Simulator tool, or you can just use your actual Android phone if you
  have one, or Android Studio's emulator if you want to set that up on this Mac.
