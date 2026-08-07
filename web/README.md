# Astryks — MVP (Firebase)

Sign up → see posted videos → post your own video → like and comment.
Built on Firebase this time — no free-tier auto-pausing to worry about.

## What's actually built

- Email/password + Google sign-up and login (Firebase Auth)
- A feed listing every posted video, newest first (viewing requires login)
- An upload page — pick a video file, add a title/description, it posts
  straight to Firebase Storage
- A video detail page with likes and comments (Firestore)
- Security rules so people can only edit/delete their own posts, likes, and
  comments

## What you need to do (about 15 minutes)

### 1. Create a Firebase project
Go to [console.firebase.google.com](https://console.firebase.google.com) →
Add project. Free "Spark" plan is enough to start, and it does not pause on
inactivity.

### 2. Register a web app
Inside the project: Project settings (gear icon) → General → "Your apps" →
click the `</>` (web) icon → register an app (no need for Firebase Hosting
here). Firebase will show you a config object — copy those six values into
`.env.local` (start from `.env.local.example`).

### 3. Turn on Authentication
Build → Authentication → Get started.
- Enable **Email/Password**
- Enable **Google** (pick a support email when prompted)

### 4. Turn on Firestore
Build → Firestore Database → Create database → start in **production mode**
(the security rules below handle access control) → pick a region close to
Sydney (e.g. `asia-southeast1`).

Then: Firestore → Rules tab → paste in the contents of `firestore.rules` →
Publish.

### 5. Turn on Storage
Build → Storage → Get started → production mode → same region.
Then: Storage → Rules tab → paste in the contents of `storage.rules` →
Publish.

### 6. Install and run locally
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

### 7. Deploy
Push this folder to a GitHub repo, then import it in
[Vercel](https://vercel.com). Add the same Firebase environment variables in
Vercel's project settings before the first deploy.

## Notes on video files

Videos upload directly to Firebase Storage and play back via a plain HTML5
`<video>` tag — no separate video-hosting account needed. The Spark (free)
plan includes 5GB of storage and 1GB/day of downloads, which is plenty for
testing with friends. If usage grows, Firebase moves to pay-as-you-go
(Blaze plan) rather than pausing your project.

## What's not in here yet

- Payments/subscriptions (Stripe)
- Course structure / lesson ordering — this is a flat feed, not a curriculum
- Profile editing page (avatar, bio)
- Notifications

Come back when you're ready for any of these and we'll build them into this
same codebase.
