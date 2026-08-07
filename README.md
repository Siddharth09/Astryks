[README.md](https://github.com/user-attachments/files/30821774/README.md)
# Astryks

Monorepo for astryks.com — a subscription learning/social app.

## Structure

- `web/` — the Next.js web app (astryks.com), deployed via Vercel/your host of choice, backed by Firebase and Stripe.
- `mobile/` — the Expo (React Native) iOS/Android app, sharing the same Firebase backend.

## Backend

Both apps share one Firebase project (Firestore, Storage, Auth, Cloud Functions) and one Stripe account.
Firestore security rules and Cloud Functions live in `web/firestore.rules`, `web/storage.rules`, and `web/functions/`
and apply to both clients.

## Getting started

See `web/README.md` and `mobile/README.md` for setup instructions for each app.

**Note:** neither app's `.env.local` (real Firebase config) nor `web/service-account.json` (Firebase admin
credentials) are committed here — see each app's `.env.local.example` for the shape of what's needed, and
never commit real keys.
