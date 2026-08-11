/** @type {import('next').NextConfig} */
const nextConfig = {
  // Was empty — no security headers at all. A full Content-Security-Policy is deliberately NOT
  // included here: the app loads images from arbitrary domains (link-preview thumbnails, Bunny
  // video embeds, Google sign-in popups, Stripe Checkout), and getting a restrictive CSP wrong
  // in a way that silently breaks checkout or Google sign-in is worse than not having one — that
  // needs to be built and tested against every real flow before shipping, not guessed at. These
  // headers are the safe, unambiguous wins that don't risk breaking anything:
  //   - X-Frame-Options: stops the whole site being loaded in someone else's invisible iframe
  //     (clickjacking — e.g. tricking a signed-in user into "confirming" a payout or an account
  //     deletion they can't actually see happening).
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
