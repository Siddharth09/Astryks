// A Content-Security-Policy was deliberately left out before now — this app has a lot of
// external-looking traffic (link-preview thumbnails from arbitrary sites, Firebase Storage
// images, Bunny video embeds, Google sign-in, Stripe Checkout) and a wrong policy that silently
// breaks login or checkout is worse than no policy at all. This version was built by walking
// every real external call the app makes (grepped across app/, components/, and lib/) rather
// than guessing:
//   - Stripe Checkout/Billing Portal: the app never loads Stripe.js or embeds an iframe — it gets
//     a URL back from createCheckoutSession/createBillingPortalSession and does a full top-level
//     `location.href` redirect to it (see ReferralAndBilling.tsx, SubscriptionBanner.tsx). That's
//     a normal page navigation, not a fetch/frame this document's CSP governs, so Stripe's own
//     domains don't need to appear below.
//   - Firebase Auth's Google sign-in (signInWithPopup) opens a separate popup window, and Firebase
//     also uses a small hidden iframe on *.firebaseapp.com for session/session-cookie handling —
//     that needs frame-src + connect-src for the auth domain and accounts.google.com.
//   - Firestore/Storage/Functions/App Check all talk to *.googleapis.com over HTTPS.
//   - Bunny video is embedded via <iframe src="https://iframe.mediadelivery.net/...">.
//   - Link-preview thumbnails and post photos can legitimately be almost any HTTPS image host —
//     img-src allows any https: origin rather than an allowlist, since there's no fixed list to
//     write down for user-supplied link previews.
//   - App Check's reCAPTCHA v3 provider (see lib/firebase.ts) loads a script from google.com/
//     gstatic.com and renders a small badge/iframe from google.com.
// If a future feature needs a new external domain (another CDN, a new auth provider, etc.), the
// browser console will show a clear "Refused to ... because it violates the following Content
// Security Policy directive" error — add that specific domain to the relevant directive below
// rather than loosening the policy generally.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is kept for script-src/style-src because Next.js's App Router injects small
  // inline bootstrap scripts (and Tailwind/inline styles show up throughout the app) that a
  // stricter nonce-based policy would require a bigger refactor to support. This still blocks the
  // main real-world risk a CSP defends against here — an attacker-controlled *external* script or
  // style domain — even though it doesn't fully close inline-script injection.
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com https://*.cloudfunctions.net https://*.firebaseapp.com https://iframe.mediadelivery.net https://video.bunnycdn.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://www.google.com https://iframe.mediadelivery.net",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Was empty — no security headers at all. These close off the standard, low-risk gaps plus the
  // CSP above:
  //   - Content-Security-Policy: see the big comment above.
  //   - X-Frame-Options: stops the whole site being loaded in someone else's invisible iframe
  //     (clickjacking — e.g. tricking a signed-in user into "confirming" a payout or an account
  //     deletion they can't actually see happening). Kept alongside frame-ancestors in the CSP
  //     above for browsers that don't support the newer directive.
  //   - X-Content-Type-Options: stops the browser from guessing a file's type in a way that
  //     could make an uploaded image get executed as a script.
  //   - Referrer-Policy: don't leak the full URL (which can include auth callback params) to
  //     third-party sites a user clicks out to, e.g. a link-preview source.
  //   - Permissions-Policy: the app never uses the camera/microphone/geolocation APIs, so
  //     explicitly deny them — one less thing a future bug or a compromised dependency could
  //     abuse.
  //   - Strict-Transport-Security: tells browsers to only ever talk to astryks.com over HTTPS,
  //     even if someone types or is redirected to a plain http:// link.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
