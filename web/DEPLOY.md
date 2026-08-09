# Why astryks.com/learn/upload (and the rest of the site) 404s

The web app has never actually been deployed anywhere — every bit of work on it so far has
only run locally (`npm run dev` on localhost). That's the actual cause of the 404 — it's a
deployment gap, not a bug in the upload page itself (the upload page code is fine, and its
large-file TUS upload flow to Bunny Stream is already correctly built for your 60GB masterclass
files).

**We picked Firebase App Hosting** as the deployment target (over Vercel/Netlify) since you're
already on Firebase's Blaze plan for Cloud Functions — same project, same billing, one
dashboard, and it stays close to free while the app is small. I've already prepared everything
in the repo that doesn't require your own login: `apphosting.yaml` (build/runtime config with
your Firebase web config values already filled in) and `firebase.json` (added an `apphosting`
block pointing at a backend called `astryks-web`). `package.json` now also pins Node 20 so the
build matches your Cloud Functions runtime.

What's left needs your own Firebase login (I can't authenticate as you) — here's exactly what
to do, using the CLI path (no GitHub connection required, though that's also an option if you'd
rather auto-deploy on every push later):

## Steps

1. **Install the Firebase CLI** (if you don't already have it) and confirm the version is new
   enough for App Hosting:
   ```
   npm install -g firebase-tools
   firebase --version   # needs to be 14.4.0 or higher
   ```
2. **Log in** (this opens a browser window for you to approve — I can't do this step, it's
   your Google account):
   ```
   firebase login
   ```
3. From inside the `astryks-app` folder, **initialize App Hosting** against the existing config:
   ```
   cd "astryks-app"
   firebase init apphosting
   ```
   When prompted: choose your existing project (`astryks-5f31c`), and when it asks about the
   backend, tell it to use the `astryks-web` backend already defined in `firebase.json` (or
   create a new one with that same name if it doesn't detect it automatically — either way
   works, `apphosting.yaml` is what actually configures the build).
4. **Deploy:**
   ```
   firebase deploy --only apphosting:astryks-web
   ```
   First deploy takes a few minutes. Firebase gives you a working `*.web.app`-style URL —
   check that `/learn/upload`, `/terms`, `/privacy`, `/prize-rules`, `/support` all load there
   before moving on.
5. **Point astryks.com at it:** Firebase console → Hosting & Serverless → App Hosting → select
   the `astryks-web` backend → View Dashboard → Settings tab → "Add custom domain." Enter
   astryks.com, follow the DNS records it gives you (these go wherever you manage the domain's
   DNS — your registrar, or Cloudflare/etc. if you use one). DNS changes can take anywhere from
   a few minutes to a few hours to propagate.
6. **Optional, for auto-deploy on every push:** instead of manually running `firebase deploy`
   each time, you can connect the backend to your GitHub repo (Firebase console → the backend →
   Settings → connect GitHub) so every push to your main branch redeploys automatically. This
   requires authorizing Firebase's GitHub App on the repo — another login-gated step only you
   can do.

## If you'd rather use Vercel or Netlify instead

Both work fine for this app too (nothing in the code is Firebase-App-Hosting-specific beyond
the two config files above, which they'll simply ignore). The one thing to remember: Vercel's
free "Hobby" tier explicitly disallows commercial/paid products in its terms, so that would
require the $20/month Pro plan — Netlify's free tier is fine for commercial use. Either way, the
steps are: import the GitHub repo, add the six `NEXT_PUBLIC_FIREBASE_*` env vars from
`.env.local` in their dashboard, deploy, then point astryks.com at the URL they give you via
their custom-domain settings.

## After it's deployed

Once real requests are hitting a real deployment, it's worth double-checking:
- The Stripe webhook URL (in your Stripe Dashboard → Developers → Webhooks) points at your
  deployed Cloud Function URL, not `localhost`.
- CORS/allowed-origins on anything that checks `Origin` (if applicable) includes
  `https://astryks.com`.
- The `/terms`, `/privacy`, `/prize-rules` pages resolve publicly — both Apple and Google check
  that your privacy policy URL actually works before approving a store submission.
