const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentDeleted, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const crypto = require("crypto");
const dns = require("dns").promises;
const https = require("https");
const http = require("http");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// Every function below is exported from this one file, so every function's container loads the
// combined weight of everything required anywhere in it at cold start — Stripe, nodemailer,
// @google-cloud/vision, @google-cloud/video-intelligence, firebase-admin — regardless of whether
// that specific function actually uses most of them. That pushed the platform's own 256MiB
// default right to the edge: functions were intermittently failing to start in production with
// "Memory limit of 256 MiB exceeded" (confirmed in Cloud Run logs), not because of a bug in any
// one function, but because the shared module's baseline footprint alone was too close to the
// ceiling for cold starts to reliably fit under. 512MiB gives real headroom without needing to
// split this into multiple codebases right now.
setGlobalOptions({ memory: "512MiB" });

admin.initializeApp();
const db = admin.firestore();

// ---------- Country detection (for pricing display + prize-leaderboard flags) ----------
//
// Replaces a purely client-side timezone guess (a timezone like "America/Chicago" spans
// multiple countries, and is easy to get wrong) with a server-side IP lookup, for the many
// prize entrants who never subscribe and so never get a real billing country from Stripe/
// Apple/Google. Uses geoip-lite's bundled offline database rather than a third-party API —
// no account/API key to manage, no per-request cost or rate limit, and no new outbound network
// call from our own servers (which would itself need SSRF-style scrutiny). Trade-off: country-
// level accuracy only, and only as fresh as the installed package version's data snapshot —
// both fine for a cosmetic leaderboard flag and a rough pricing-currency guess.
//
// require()'d lazily INSIDE the function, not at module top-level — geoip-lite loads its whole
// offline database into memory the moment it's required, which was pushing every single
// function in this file over its 256MiB cold-start memory limit (this file is one shared module
// across all ~65 functions), not just this one. Node caches require() results, so this still
// only loads the data once per container, just on first actual invocation instead of on every
// unrelated function's cold start.
function getClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    // The load balancer appends each hop; the first entry is the original client.
    return forwarded.split(",")[0].trim();
  }
  return req?.ip || null;
}

// Callable: looks up the caller's country from their IP and saves it to their own user doc —
// but only if one isn't already there. Never overwrites an existing value, since a real Stripe/
// Apple/Google billing country (set once someone subscribes) is far more reliable than any
// guess. Safe to call on every sign-in; it's a no-op once a country is on record. Given its own
// 512MiB (double the 256MiB default) headroom for geoip-lite's dataset — see the require()
// comment above for why that cost doesn't spill over into every other function.
exports.detectCountryFromIp = onCall({ memory: "512MiB" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const geoip = require("geoip-lite");
  const ip = getClientIp(request.rawRequest);
  const geo = ip ? geoip.lookup(ip) : null;
  const countryCode = geo?.country || null;
  if (countryCode) {
    const userRef = db.doc(`users/${request.auth.uid}`);
    const snap = await userRef.get();
    if (!snap.data()?.countryCode) {
      await userRef.set({ countryCode }, { merge: true });
    }
  }
  return { countryCode };
});

// ---------- Rate limiting ----------
//
// A handful of callables are expensive (they fan out into several Firestore reads), send email/
// SMS-adjacent side effects, or — in fetchLinkPreview's case — make an outbound HTTP request on
// Astryks's behalf to a URL the caller chooses. None of that is normally dangerous from a single
// signed-in account, but nothing before this stopped one compromised or malicious account from
// calling any of them thousands of times a minute: unbounded Firestore read/write costs, an open
// spam-reporting/refund-request firehose, or turning fetchLinkPreview into a free proxy for
// hammering some other site. This is a lightweight per-account counter stored in Firestore itself
// (one extra read+write per call) rather than a separate rate-limiting service — good enough to
// stop single-account abuse without adding new infrastructure. It can't stop someone spreading
// the same abuse across many different accounts; that's what fetchLinkPreview's SSRF/private-IP
// checks and Firebase App Check (see lib/firebase.ts) are for instead.
async function enforceRateLimit(uid, action, { max, windowMs }) {
  const ref = db.collection("rateLimits").doc(`${uid}_${action}`);
  const now = Date.now();
  let limited = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (!data || now - data.windowStart > windowMs) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if (data.count >= max) {
      limited = true;
      return;
    }
    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
  });
  if (limited) {
    throw new HttpsError("resource-exhausted", "You're doing that too often — please try again in a few minutes.");
  }
}

const BUNNY_API_KEY = defineSecret("BUNNY_API_KEY");
const BUNNY_LIBRARY_ID = defineSecret("BUNNY_LIBRARY_ID");
// Declared here (rather than down by the other Stripe secrets, where it originally lived)
// because deleteUserAccount/deleteMyAccount reference it in their onCall({ secrets: [...] })
// config objects, which run immediately at module load — declaring it later as a `const` meant
// this line ran before that declaration executed, throwing "Cannot access 'stripeSecret' before
// initialization" and crashing the entire functions deploy, not just these two functions.
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");

// Update with the email(s) allowed to do admin-only things: delete anyone's post,
// upload lessons/trailers.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

// A fixed pseudo-account representing Astryks support in the Messages UI.
// It's not a real Firebase Auth user — just a shared participant ID so the
// existing conversations/messages schema can be reused as-is.
const SUPPORT_UID = "astryks-support";

// Same pattern, for the automated creative-prize nomination messages.
const PRIZE_BOT_UID = "astryks-prizes";
const PRIZE_BOT_NAME = "Astryks Prizes";

// Flat monthly prize amount — a fixed commitment regardless of that month's subscription
// revenue. Entry stays free for any account either way (see nominateForPrize below for why
// that matters); PRIZE_PAYOUTS_ENABLED below is the actual safety valve if a given month's
// revenue doesn't comfortably cover this.
const PRIZE_AUD = 1000;

// A post needs at least this many likes to actually qualify for that month's prize — see the
// comment on nominateForPrize for the reasoning. If nothing clears this bar in a given month,
// no winner is picked that month (sendMonthlyPrizeReport below handles that case explicitly).
const PRIZE_LIKE_THRESHOLD = 30;

// Kill switch for actually paying out the Creative Prize. The like-tracking, leaderboard, and
// monthly winner-selection logic all keep running regardless (so you can see the mechanism
// work end to end) — this only gates the messaging that promises a specific payment, and
// flags every winner record as held. Entry is free for any account (see nominateForPrize),
// which is what keeps the promotion compliant broadly across AU/US/UK/Canada without needing
// per-jurisdiction legal sign-off — but manual review before any real money moves is still
// good practice regardless. Flip to `true` once you've done a final check of the current
// Official Rules (app/prize-rules) against local law and are ready to announce/pay winners.
const PRIZE_PAYOUTS_ENABLED = true;

// "YYYY-MM" for a given date — used as the prizeWinners doc ID so a plain
// orderBy("month") sorts chronologically without needing a separate timestamp field.
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const SUPPORT_EMAIL_USER = defineSecret("SUPPORT_EMAIL_USER");
const SUPPORT_EMAIL_PASS = defineSecret("SUPPORT_EMAIL_PASS");
const SUPPORT_EMAIL_TO = defineSecret("SUPPORT_EMAIL_TO");

// ---------- Helpers ----------

async function sendPush(toUid, title, body) {
  const userDoc = await db.collection("users").doc(toUid).get();
  const token = userDoc.data()?.pushToken;
  if (!token) return;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to: token, title, body, sound: "default" }),
  });
}

// Emails a support message straight to your inbox using Gmail SMTP.
async function sendSupportEmail(subject, text) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SUPPORT_EMAIL_USER.value(), pass: SUPPORT_EMAIL_PASS.value() },
  });

  await transporter.sendMail({
    from: `Astryks Support Bot <${SUPPORT_EMAIL_USER.value()}>`,
    to: SUPPORT_EMAIL_TO.value(),
    subject,
    text,
  });
}

// Count of users with an active subscription right now (web via Stripe or mobile via
// Qonversion — both write subscriptionStatus: "active" to the same field, see
// stripeWebhook/qonversionWebhook below). This is a headcount only, not a dollar figure —
// we don't have a reliable single "net revenue" number in Firestore (prices vary by
// currency/tier, and mobile revenue is further reduced by Apple/Google's cut before it
// reaches you), so the prize report includes this count and leaves the actual affordability
// call — and whether to flip PRIZE_PAYOUTS_ENABLED — to you each month, using your own Stripe/
// App Store/Play Console dashboards for the real number.
async function getActiveSubscriberCount() {
  const snap = await db.collection("users").where("subscriptionStatus", "==", "active").count().get();
  return snap.data().count;
}

// Alerts YOU, the admin — both by email and by push notification to your own account (if you
// have the Astryks app installed and a pushToken saved, same mechanism as any member's push).
// Used only for "something needs your review before money moves" moments — right now, that's
// exclusively "a winner's payout method just became ready, come approve sending it." This never
// sends money itself and never can — payWinnerViaStripe/markPrizeWinnerPaid still require you to
// open astryks.com/admin/prizes and click through a confirmation dialog yourself, every time.
async function notifyAdmin(subject, body) {
  try {
    await sendSupportEmail(subject, body);
  } catch (err) {
    console.error("notifyAdmin: failed to email admin", err);
  }
  try {
    const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAILS[0]);
    await sendPush(adminUser.uid, subject, body.slice(0, 160));
  } catch (err) {
    // Most likely cause: you don't have a pushToken saved on your own account yet (open the
    // Astryks app and allow notifications while logged in as the admin). Email above still went
    // out regardless, so this failure is silent to you on purpose — nothing to action.
    console.error("notifyAdmin: failed to push admin", err);
  }
}

// Sends an automated "Astryks Prizes" message into (or creating, if needed) the
// 1:1 conversation between a post's owner and the prize bot pseudo-account —
// reuses the existing conversations/messages schema the same way support does.
async function sendPrizeBotMessage(ownerId, ownerName, text, extraFields) {
  const conversationId = [ownerId, PRIZE_BOT_UID].sort().join("_");
  const convoRef = db.doc(`conversations/${conversationId}`);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    await convoRef.set({
      participants: [ownerId, PRIZE_BOT_UID].sort(),
      participantNames: [ownerId, PRIZE_BOT_UID]
        .sort()
        .map((id) => (id === PRIZE_BOT_UID ? PRIZE_BOT_NAME : ownerName || "Member")),
      lastMessage: "",
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await convoRef.collection("messages").add({
    senderId: PRIZE_BOT_UID,
    senderName: PRIZE_BOT_NAME,
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extraFields,
  });
  await convoRef.set(
    { lastMessage: text, lastMessageAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// Sends an "Astryks Support" message into (or creating, if needed) the 1:1 conversation
// between a member and the support pseudo-account — same reused conversations/messages
// schema as sendPrizeBotMessage above. The existing onMessageCreated trigger push-notifies
// the recipient automatically the moment this message is created, same as any real DM.
const SUPPORT_NAME = "Astryks Support";
async function sendSupportMessage(uid, userName, text) {
  const conversationId = [uid, SUPPORT_UID].sort().join("_");
  const convoRef = db.doc(`conversations/${conversationId}`);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    await convoRef.set({
      participants: [uid, SUPPORT_UID].sort(),
      participantNames: [uid, SUPPORT_UID]
        .sort()
        .map((id) => (id === SUPPORT_UID ? SUPPORT_NAME : userName || "Member")),
      lastMessage: "",
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await convoRef.collection("messages").add({
    senderId: SUPPORT_UID,
    senderName: SUPPORT_NAME,
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await convoRef.set(
    { lastMessage: text, lastMessageAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// Marks a brand-new photo/video post eligible for that month's creative prize the moment
// it's posted, and notifies the owner with a way to opt themselves back out. To actually win,
// a post needs at least PRIZE_LIKE_THRESHOLD likes by month end (see sendMonthlyPrizeReport) —
// entry itself has no minimum, every creative post is automatically in the running from the
// start.
//
// IMPORTANT: entry/winning is NOT gated behind a subscription — this is deliberate, not an
// oversight. A paid-subscribers-only, popularity-vote-decided cash prize is legally risky
// (the "prize + chance + consideration" test for an unlawful lottery) in Australia, the US,
// the UK, and Canada alike — see chat history around Aug 2026 for the full research, including
// the Xclusive/LMCT+ unlawful-lottery conviction (SA, March 2026) for a subscription-gated
// prize model. Keeping entry free for any account is what keeps this compliant everywhere at
// once, without needing per-jurisdiction legal review. The PRIZE_LIKE_THRESHOLD requirement
// (reinstated Aug 2026) doesn't reintroduce that risk: it's a free, uncapped engagement bar
// (anyone, subscriber or not, can like a post at no cost) rather than something an entrant
// pays or subscribes for, so it isn't "consideration" in the legal sense — it's the same kind
// of qualifying bar as "your photo must be your own original work." Do not gate entry or
// winning behind a subscription, or require that likes come specifically from subscribers,
// without redoing that legal review first — both reintroduce the same consideration problem,
// just attached to a different party.
async function nominateForPrize(postId, post) {
  await db.doc(`posts/${postId}`).set(
    { prizeEligible: true, prizeNominatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  await sendPrizeBotMessage(
    post.ownerId,
    post.ownerName,
    `🎉 Your post is officially entered into this month's Astryks Creative Prize — AU$${PRIZE_AUD}! Two things ` +
      `keep this fair: it needs at least ${PRIZE_LIKE_THRESHOLD} likes to qualify — free for anyone to give, so ` +
      `it's really your community cheering you on — and before any cash goes out, a real person on our team ` +
      `takes a look to make sure it's genuine creative work, not a repost or a meme just farming likes. It really ` +
      `helps that review along if you share a quick note (or a link to a process/timelapse video) about how you ` +
      `made it — totally optional, and you can add it anytime by tapping the trophy icon on your post. If you'd ` +
      `rather not be entered at all, just tap "Opt out" below. You can also share your payout details (bank ` +
      `transfer or PayID) right here now, so we're ready to send the cash instantly if you win — note that ` +
      `international transfers from Australia may be subject to market FX rates and other overseas transfer ` +
      `considerations.`,
    { type: "prizeNomination", postId }
  );
}

async function bumpStreakInternal(uid) {
  const userRef = db.collection("users").doc(uid);
  const today = new Date().toISOString().slice(0, 10);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    const lastActive = data.lastActiveDate;

    if (lastActive === today) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const keptStreak = lastActive === yesterday;
    const newStreak = keptStreak ? (data.streakCount || 0) + 1 : 1;

    tx.set(
      userRef,
      { streakCount: newStreak, lastActiveDate: today, xp: (data.xp || 0) + 10 },
      { merge: true }
    );
  });
}

// ---------- Callable: create a signed Bunny upload (for lesson videos) ----------

exports.createBunnyUpload = onCall(
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to upload.");
    }

    // Only the Astryks team can create Bunny videos — this backs up the client-side
    // admin-only gate on the lesson/trailer upload pages, which alone isn't real security.
    if (!(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }

    const title = (request.data?.title || "Untitled").slice(0, 200);
    const libraryId = BUNNY_LIBRARY_ID.value();
    const apiKey = BUNNY_API_KEY.value();

    const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: "POST",
      headers: { AccessKey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    if (!createRes.ok) {
      throw new HttpsError("internal", `Bunny video creation failed: ${await createRes.text()}`);
    }

    const { guid: videoId } = await createRes.json();
    const expirationTime = Math.floor(Date.now() / 1000) + 60 * 60;
    const signature = crypto
      .createHash("sha256")
      .update(`${libraryId}${apiKey}${expirationTime}${videoId}`)
      .digest("hex");

    return { videoId, libraryId, signature, expirationTime };
  }
);

// ---------- Callable: fetch link preview metadata for shared links ----------

// Blocks the URL from resolving to a private/internal address before we let the server fetch
// it — without this, fetchLinkPreview is a server-side-request-forgery primitive: any signed-in
// user could point it at http://169.254.169.254/... (cloud metadata endpoints), localhost, or an
// internal-network address and have Astryks's own backend make that request for them.
function isPrivateOrLoopbackHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    return true;
  }
  // IPv4 literal checks: loopback, link-local/cloud-metadata, and the three private ranges.
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
  }
  // IPv6 loopback/link-local/unique-local literals.
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

// Resolves `hostname` and rejects if ANY of its addresses are private/loopback/link-local, then
// returns one validated address to connect to.
//
// isPrivateOrLoopbackHostname above only ever looked at the literal hostname string — it catches
// someone typing "http://127.0.0.1/..." directly, but it does nothing if "totally-normal-site.com"
// is a domain the attacker controls and has simply pointed at an internal IP with a plain DNS A
// record (no "rebinding" trickery needed at all — that's just what its DNS says). This closes
// that off by resolving the hostname ourselves and checking the actual resolved address.
//
// It also closes the narrower DNS-rebinding race: even after this check passes, letting fetch()
// do its own DNS lookup right before connecting would open a window where a malicious, very-low-
// TTL DNS record could answer "public IP" here and "private IP" a moment later. fetchPinned below
// connects directly to the exact IP validated here (while still sending the correct Host header
// and TLS servername) instead of letting anything re-resolve the hostname, so there's no second
// lookup left to race.
async function resolveAndValidateHostname(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!addresses.length || addresses.some((a) => isPrivateOrLoopbackHostname(a.address))) {
    return null;
  }
  return addresses[0].address;
}

// Fetches `parsedUrl` by connecting directly to `ip` (see resolveAndValidateHostname above)
// instead of letting Node re-resolve the hostname itself. `redirect: manual`-equivalent: any 3xx
// response is reported back as `redirected: true` rather than followed, since a redirect target
// could point at a private address and hasn't been through the checks above.
function fetchPinned(parsedUrl, ip, { timeoutMs = 5000, maxBytes = 1024 * 1024 } = {}) {
  const lib = parsedUrl.protocol === "https:" ? https : http;
  const port = parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host: ip,
        port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        headers: {
          Host: parsedUrl.host,
          "User-Agent": "Mozilla/5.0 (compatible; AstryksBot/1.0)",
        },
        // TLS still validates the certificate against the real hostname (via SNI), so dialing the
        // IP directly can't be tricked into trusting some other server that happens to sit at it.
        servername: parsedUrl.protocol === "https:" ? parsedUrl.hostname : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          resolve({ redirected: true });
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          if (total >= maxBytes) return; // already over the cap — just drain silently below
          total += chunk.length;
          chunks.push(chunk);
        });
        // A malicious server could otherwise stream gigabytes at this function — stop reading
        // (but don't tear down the socket mid-response) once we've got plenty for <head> metadata.
        res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

exports.fetchLinkPreview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  // fetchLinkPreview makes an outbound request on Astryks's own behalf to a URL the caller
  // chooses — cap how often one account can trigger that so it can't be turned into a free
  // proxy for hammering someone else's site.
  await enforceRateLimit(request.auth.uid, "fetchLinkPreview", { max: 20, windowMs: 5 * 60 * 1000 });

  const url = request.data?.url;
  if (!url || !/^https?:\/\//.test(url)) {
    throw new HttpsError("invalid-argument", "A valid URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new HttpsError("invalid-argument", "A valid URL is required.");
  }
  if (isPrivateOrLoopbackHostname(parsedUrl.hostname)) {
    throw new HttpsError("invalid-argument", "This URL can't be previewed.");
  }

  // YouTube's own watch pages are unreliable to scrape for og:image — Google frequently serves
  // a cookie-consent interstitial (no real thumbnail in it) instead of the actual video page to
  // a server-side fetch with no existing consent cookies, which is exactly what was causing
  // YouTube links to post with no thumbnail. YouTube's oEmbed endpoint is built for exactly this
  // use case (link previews) and always returns the real title/thumbnail directly as JSON, no
  // HTML-scraping or consent-wall involved. Host is hardcoded to youtube.com, not user-supplied,
  // so this doesn't need the SSRF-safe pinned-IP handling the generic path below requires.
  const youtubeHost = parsedUrl.hostname.replace(/^www\.|^m\./, "");
  if (youtubeHost === "youtube.com" || youtubeHost === "youtu.be") {
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        return {
          title: (oembed.title || url).slice(0, 200),
          image: oembed.thumbnail_url || null,
          domain: parsedUrl.hostname,
        };
      }
    } catch {
      // Fall through to the generic scraper below rather than fail the whole preview.
    }
  }

  const pinnedIp = await resolveAndValidateHostname(parsedUrl.hostname);
  if (!pinnedIp) {
    // Either the hostname didn't resolve, or one of its addresses is private/loopback/
    // link-local — treat both the same as the literal-hostname check above.
    throw new HttpsError("invalid-argument", "This URL can't be previewed.");
  }

  let html = "";
  try {
    const result = await fetchPinned(parsedUrl, pinnedIp);
    if (result.redirected) {
      // Refuse to blindly follow the redirect — return a plain fallback instead of risking SSRF.
      return { title: url, image: null, domain: parsedUrl.hostname };
    }
    html = result.html || "";
  } catch {
    return { title: url, image: null, domain: parsedUrl.hostname };
  }

  const pick = (regex) => {
    const match = html.match(regex);
    return match ? match[1] : null;
  };

  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title>([^<]+)<\/title>/i) ||
    url;
  const image = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  return { title: title.slice(0, 200), image, domain: parsedUrl.hostname };
});

// One-time maintenance callable: existing YouTube link posts shared before fetchLinkPreview
// started using the oEmbed API (see above) are stuck with whatever null/broken image the old
// HTML-scraping approach got from Google's cookie-consent interstitial. Re-fetches just those
// via oEmbed and fixes them in place. Safe to run more than once — skips anything that already
// has a linkImage. Admin-only; trigger it once from the browser console, same as
// backfillLessonPlayback/backfillPostVisibility elsewhere in this file.
exports.backfillYoutubeLinkPreviews = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db.collection("posts").where("type", "==", "link").get();
  let fixed = 0;
  let checked = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.linkImage || !data.linkUrl) continue;
    let hostname;
    try {
      hostname = new URL(data.linkUrl).hostname.replace(/^www\.|^m\./, "");
    } catch {
      continue;
    }
    if (hostname !== "youtube.com" && hostname !== "youtu.be") continue;
    checked++;
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(data.linkUrl)}&format=json`);
      if (!oembedRes.ok) continue;
      const oembed = await oembedRes.json();
      if (!oembed.thumbnail_url) continue;
      await doc.ref.update({
        linkImage: oembed.thumbnail_url,
        linkTitle: (oembed.title || data.linkTitle || data.linkUrl).slice(0, 200),
      });
      fixed++;
    } catch {
      // Leave this one as-is and keep going — a single bad video shouldn't stop the rest.
    }
  }
  return { checked, fixed };
});

// ---------- Callable: mark a lesson complete ----------
//
// This is the ONLY place streaks/xp get earned. Streaks used to also bump on
// likes/comments/shares via a general-purpose `bumpStreak` callable, but that
// made the streak/xp meaningless (and trivially fakeable from devtools, since
// any signed-in user could call it directly) — it's been removed. Now a
// streak day and +10 xp are earned specifically by completing a lesson, so
// the number on your profile actually reflects showing up to learn.
//
// On top of that, finishing every lesson in a subject pays out a one-time
// +50 xp "mastered" bonus, tracked in `users/{uid}.masteredSubjects` so it
// can't be re-triggered by toggling a lesson's completion back and forth.
exports.completeLesson = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const uid = request.auth.uid;
  const lessonId = request.data?.lessonId;
  if (!lessonId) {
    throw new HttpsError("invalid-argument", "lessonId is required.");
  }

  const lessonSnap = await db.doc(`lessons/${lessonId}`).get();
  const subjectId = lessonSnap.exists ? lessonSnap.data().subjectId : null;

  const progressRef = db.doc(`lessonProgress/${uid}_${lessonId}`);
  await progressRef.set({
    uid,
    lessonId,
    subjectId: subjectId || null,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await bumpStreakInternal(uid);

  let masteredSubject = null;
  if (subjectId) {
    const userRef = db.doc(`users/${uid}`);
    const [subjectLessonsSnap, userSnap] = await Promise.all([
      db.collection("lessons").where("subjectId", "==", subjectId).get(),
      userRef.get(),
    ]);
    const subjectLessonIds = subjectLessonsSnap.docs.map((d) => d.id);
    const alreadyMastered = (userSnap.data()?.masteredSubjects || []).includes(subjectId);

    if (subjectLessonIds.length > 0 && !alreadyMastered) {
      // Don't rely on the `subjectId` field on lessonProgress docs for this check —
      // older progress docs (completed before this field existed) won't have it.
      // Fetch everything this user has completed and intersect in JS instead.
      const progressSnap = await db.collection("lessonProgress").where("uid", "==", uid).get();
      const completedLessonIds = new Set(progressSnap.docs.map((d) => d.data().lessonId));
      const allDone = subjectLessonIds.every((id) => completedLessonIds.has(id));

      if (allDone) {
        await userRef.set(
          {
            masteredSubjects: admin.firestore.FieldValue.arrayUnion(subjectId),
            xp: admin.firestore.FieldValue.increment(50),
          },
          { merge: true }
        );
        masteredSubject = subjectId;
      }
    }
  }

  return { ok: true, masteredSubject };
});

// ---------- Callable: admin-only — delete a lesson, cleaning up its Bunny video too ----------

exports.deleteLesson = onCall(
  { secrets: [BUNNY_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    if (!(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }

    const lessonId = request.data?.lessonId;
    if (!lessonId) {
      throw new HttpsError("invalid-argument", "lessonId is required.");
    }

    const lessonRef = db.doc(`lessons/${lessonId}`);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) {
      return { ok: true }; // already gone
    }
    const lesson = lessonSnap.data();

    // The playback credentials normally live in the gated `lessonPlayback` doc (see
    // migrateLessonPlaybackFields below) — fall back to the lesson doc itself in case this
    // particular lesson was created/deleted before that migration ran.
    const playbackRef = db.doc(`lessonPlayback/${lessonId}`);
    const playbackSnap = await playbackRef.get();
    const playback = playbackSnap.exists ? playbackSnap.data() : lesson;

    if (playback.bunnyVideoId) {
      try {
        await fetch(
          `https://video.bunnycdn.com/library/${playback.bunnyLibraryId}/videos/${playback.bunnyVideoId}`,
          { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY.value() } }
        );
      } catch {
        // If Bunny cleanup fails, still proceed with removing the lesson itself.
      }
    }
    if (playbackSnap.exists) {
      await playbackRef.delete();
    }

    // Clean up everyone's progress records for this lesson too. Chunked at 400 (below
    // Firestore's 500-write batch cap) since a well-attended lesson can have more progress
    // records than a single batch allows.
    const progressSnap = await db.collection("lessonProgress").where("lessonId", "==", lessonId).get();
    for (let i = 0; i < progressSnap.docs.length; i += 400) {
      const batch = db.batch();
      progressSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await lessonRef.delete();
    return { ok: true };
  }
);

// ---------- Callable: admin-only — create a lesson without ever exposing playback credentials ----------
//
// Writing bunnyVideoId/bunnyLibraryId onto the public `lessons` doc directly (even briefly) and
// relying on migrateLessonPlaybackFields below to scrub them afterward leaves a real window —
// the trigger fires asynchronously, and a cold start can take seconds — during which anyone
// reading the public `lessons` collection (including a signed-out visitor, and including our
// own client polling it on every Learn tab load) gets the raw credentials and can bypass the
// paywall entirely. This callable closes that window by never letting those fields reach the
// public doc in the first place: the credentials go straight into the gated `lessonPlayback`
// doc, and the public `lessons` doc is created without them from the start.
exports.createLesson = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  if (!(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }

  const { subjectId, title, order, pinned, bunnyVideoId, bunnyLibraryId } = request.data || {};
  if (!subjectId || !title || !bunnyVideoId || !bunnyLibraryId) {
    throw new HttpsError("invalid-argument", "subjectId, title, bunnyVideoId, and bunnyLibraryId are required.");
  }

  const lessonRef = db.collection("lessons").doc();
  await lessonRef.set({
    subjectId,
    title,
    order: order ?? 1,
    pinned: !!pinned,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`lessonPlayback/${lessonRef.id}`).set({ bunnyVideoId, bunnyLibraryId });

  return { lessonId: lessonRef.id };
});

// ---------- Trigger + callable: keep lesson playback credentials out of the public lessons doc ----------
//
// `lessons/{lessonId}` is publicly readable (see firestore.rules — anyone browsing the catalog,
// subscribed or not, needs to see titles/thumbnails). Firestore rules can only restrict access
// to a WHOLE document, never individual fields on it — so as long as bunnyVideoId/bunnyLibraryId
// lived directly on that public doc, anyone (including a signed-out visitor calling the
// Firestore SDK directly) could read them and load the unauthenticated Bunny embed URL,
// completely bypassing the subscription paywall the UI only enforced client-side.
//
// The fix: whenever a lesson doc is written with those fields present, immediately move them
// into a separate `lessonPlayback/{lessonId}` doc (client access denied entirely, same as
// `reports`/`prizePayouts`) and strip them from the public doc. Playback credentials are then
// only ever handed out via getLessonPlayback below, which checks the caller's subscription
// status first.
exports.migrateLessonPlaybackFields = onDocumentWritten("lessons/{lessonId}", async (event) => {
  const after = event.data?.after?.data();
  if (!after || (!after.bunnyVideoId && !after.bunnyLibraryId)) return;

  const lessonId = event.params.lessonId;
  await db.doc(`lessonPlayback/${lessonId}`).set(
    { bunnyVideoId: after.bunnyVideoId || null, bunnyLibraryId: after.bunnyLibraryId || null },
    { merge: true }
  );
  await db.doc(`lessons/${lessonId}`).update({
    bunnyVideoId: admin.firestore.FieldValue.delete(),
    bunnyLibraryId: admin.firestore.FieldValue.delete(),
  });
});

// One-time maintenance callable for lessons that already had bunnyVideoId/bunnyLibraryId on
// them before migrateLessonPlaybackFields existed (that trigger only fires on a NEW write, so
// it doesn't retroactively fix already-created docs). Safe to run more than once. Admin-only;
// trigger it once from the browser console, same as backfillPostVisibility below.
exports.backfillLessonPlayback = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db.collection("lessons").get();
  let migrated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.bunnyVideoId && !data.bunnyLibraryId) continue;
    await db.doc(`lessonPlayback/${doc.id}`).set(
      { bunnyVideoId: data.bunnyVideoId || null, bunnyLibraryId: data.bunnyLibraryId || null },
      { merge: true }
    );
    await doc.ref.update({
      bunnyVideoId: admin.firestore.FieldValue.delete(),
      bunnyLibraryId: admin.firestore.FieldValue.delete(),
    });
    migrated++;
  }
  return { migrated };
});

// ---------- Free preview: 10 minutes of REAL lesson content per SUBJECT, no card required ----------
// Deliberately a total watch-time cap, not a day-based trial — a day-based trial (7 days of
// unrestricted access) lets someone binge the entire library and cancel before ever being
// charged. A metered allowance doesn't have that failure mode: however long someone takes to use
// their 10 minutes, once it's gone, it's gone — but the cap resets PER SUBJECT (10 min of Music,
// separately 10 min of Art, etc.), not one shared pool, so trying a second subject isn't
// penalized by time already spent on the first. Tracked server-side as
// users/{uid}.freePreviewSecondsUsed.{subjectId} — see reportPreviewProgress below for how that
// counter actually gets incremented, and firestore.rules for why a client can't just reset it
// itself (same protected-fields pattern as subscriptionStatus/xp). The subject is always looked
// up server-side from the lesson doc's own subjectId, never trusted from the client — otherwise
// a client could just claim a different fake subjectId on every call and get unlimited preview.
const FREE_PREVIEW_SECONDS_ALLOWED = 10 * 60;

// Callable: the ONLY legitimate way to get a lesson's actual playback credentials now — gated
// on an active subscription, the free preview allowance for that lesson's subject, or admin,
// unlike reading them straight off the public lessons doc.
exports.getLessonPlayback = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const lessonId = request.data?.lessonId;
  if (!lessonId) {
    throw new HttpsError("invalid-argument", "lessonId is required.");
  }

  // Fetched once up front — used both for the subject-scoped preview check below AND as the
  // playback-credentials fallback for any lesson not yet migrated to lessonPlayback/{lessonId}.
  const lessonDocSnap = await db.doc(`lessons/${lessonId}`).get();
  const subjectId = lessonDocSnap.data()?.subjectId || null;

  const isAdmin = (ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true);
  let freePreviewSecondsRemaining = null;
  if (!isAdmin) {
    const userSnap = await db.doc(`users/${request.auth.uid}`).get();
    const isActive = userSnap.data()?.subscriptionStatus === "active";
    if (!isActive) {
      // Privacy Lock (web + mobile) closes the free-preview loophole entirely: with it on, a
      // non-subscriber gets no lesson video at all, not even the usual 10 free minutes per
      // subject — set via setPrivacyLockStatus below, never by the client writing this field
      // directly (see firestore.rules' users/{userId} allowlist).
      if (userSnap.data()?.privacyLockEnabled === true) {
        throw new HttpsError(
          "permission-denied",
          "Privacy Lock is on for this account — subscribe to watch lessons."
        );
      }
      const usedBySubject = userSnap.data()?.freePreviewSecondsUsed || {};
      const secondsUsed = (subjectId && usedBySubject[subjectId]) || 0;
      freePreviewSecondsRemaining = FREE_PREVIEW_SECONDS_ALLOWED - secondsUsed;
      if (freePreviewSecondsRemaining <= 0) {
        throw new HttpsError(
          "permission-denied",
          "You've used up your 10 minutes of free preview for this subject — subscribe to keep watching."
        );
      }
    }
  }

  const playbackSnap = await db.doc(`lessonPlayback/${lessonId}`).get();
  const data = playbackSnap.exists ? playbackSnap.data() : lessonDocSnap.data();

  if (!data?.bunnyVideoId) {
    throw new HttpsError("not-found", "This lesson doesn't have a video yet.");
  }
  return {
    bunnyVideoId: data.bunnyVideoId,
    bunnyLibraryId: data.bunnyLibraryId,
    subjectId,
    // null for subscribers/admins (no cap to show); a number of seconds for everyone else.
    freePreviewSecondsRemaining,
  };
});

// Callable: the client calls this every ~10s while a NON-subscriber is actually playing a lesson
// video, so the free-preview allowance above is backed by a real server-side counter instead of
// something a client could just ignore. Capped per call (max 30s) so a modified client can't
// report one giant jump and skip the limit outright — worst case, someone pads a few extra
// seconds per call, not unlimited free viewing. Silently a no-op for subscribers/admins (nothing
// to meter), so the client doesn't need to know its own status to call this safely. Takes
// lessonId (not subjectId) — the subject is always resolved server-side from the lesson doc, so
// a client can't lie about which subject's allowance it's spending.
exports.reportPreviewProgress = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const lessonId = request.data?.lessonId;
  const seconds = Math.max(0, Math.min(30, Number(request.data?.seconds) || 0));
  if (!lessonId || seconds <= 0) {
    return { secondsUsed: 0, secondsAllowed: FREE_PREVIEW_SECONDS_ALLOWED, subjectId: null };
  }

  const lessonSnap = await db.doc(`lessons/${lessonId}`).get();
  const subjectId = lessonSnap.data()?.subjectId || null;
  if (!subjectId) {
    return { secondsUsed: 0, secondsAllowed: FREE_PREVIEW_SECONDS_ALLOWED, subjectId: null };
  }

  const userRef = db.doc(`users/${request.auth.uid}`);
  const userSnap = await userRef.get();
  if (userSnap.data()?.subscriptionStatus === "active") {
    // Subscribers have nothing to meter — report back as unused so the client never shows a
    // countdown for someone who doesn't need one.
    return { secondsUsed: 0, secondsAllowed: FREE_PREVIEW_SECONDS_ALLOWED, subjectId };
  }

  const fieldPath = `freePreviewSecondsUsed.${subjectId}`;
  try {
    await userRef.update({ [fieldPath]: admin.firestore.FieldValue.increment(seconds) });
  } catch {
    // users/{uid} doc (or the freePreviewSecondsUsed map on it) doesn't exist yet — update()
    // requires an existing doc, set()+merge creates whatever's missing.
    await userRef.set({ freePreviewSecondsUsed: { [subjectId]: seconds } }, { merge: true });
  }
  const current = (userSnap.data()?.freePreviewSecondsUsed || {})[subjectId] || 0;
  const secondsUsed = current + seconds;

  return { secondsUsed, secondsAllowed: FREE_PREVIEW_SECONDS_ALLOWED, subjectId };
});

// ---------- Callable: delete a post (owner or admin), cleaning up Bunny/Storage too ----------

// Shared cleanup used by both deletePost (single post) and deleteUserAccount (all of a user's posts).
//
// SECURITY: this function is called with admin-level privileges (it deletes from Storage/Bunny
// using a service credential, not the caller's own permissions), so it must never blindly trust
// fields on the post document that the post's own owner could have set. Regular posts are only
// ever created with a `mediaPath` under `posts/{ownerId}/...` (see ShareComposer.tsx) — they
// never legitimately set `bunnyVideoId`/`bunnyLibraryId` (those are for the separate,
// admin-only `lessons` collection, cleaned up by deleteLesson instead). Without the checks
// below, a malicious user could set an arbitrary `bunnyVideoId`/`bunnyLibraryId` or a
// `mediaPath` pointing at someone else's file on their own post, then delete that post to make
// this admin-privileged function delete media it doesn't actually own — a "confused deputy"
// attack.
async function deletePostInternal(postRef, post, bunnyApiKey) {
  // Clean up likes and comments subcollections. Chunked at 400 (below Firestore's 500-write
  // batch cap) since a popular post — especially one that crossed the Creative Prize's 30-like
  // threshold — can easily have more likes/comments than a single batch allows.
  for (const sub of ["likes", "comments"]) {
    const subSnap = await postRef.collection(sub).get();
    for (let i = 0; i < subSnap.docs.length; i += 400) {
      const batch = db.batch();
      subSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  // Regular posts never legitimately reference a Bunny video — that's only ever used by the
  // separate `lessons` collection, which has its own deleteLesson cleanup. Never act on
  // bunnyVideoId/bunnyLibraryId here, so a forged value on a post can't be used to delete an
  // unrelated Bunny video (e.g. an admin's lesson video) that the post's owner doesn't control.

  // Clean up the file in Firebase Storage, for photo/video posts uploaded there — but only if
  // the path is actually inside this post's own owner's folder, matching what the client is
  // ever allowed to write. This stops a forged mediaPath from deleting another user's file.
  if (post.mediaPath && typeof post.mediaPath === "string" && post.ownerId) {
    const expectedPrefix = `posts/${post.ownerId}/`;
    if (post.mediaPath.startsWith(expectedPrefix)) {
      try {
        await admin.storage().bucket().file(post.mediaPath).delete();
      } catch {
        // File may already be gone — not fatal.
      }
    }
  }

  // Best-effort: this post's own prize payout details (bank/PayID), if any were submitted.
  try {
    await db.doc(`prizePayouts/${postRef.id}`).delete();
  } catch {
    // Not fatal if this fails — nothing sensitive is exposed by leaving a stray payout doc.
  }

  await postRef.delete();
}

exports.deletePost = onCall(
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const postId = request.data?.postId;
    if (!postId) {
      throw new HttpsError("invalid-argument", "postId is required.");
    }

    const postRef = db.doc(`posts/${postId}`);
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      return { ok: true }; // already gone
    }

    const post = postSnap.data();
    const isOwner = post.ownerId === request.auth.uid;
    const isAdmin = (ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true);

    if (!isOwner && !isAdmin) {
      throw new HttpsError("permission-denied", "You can only delete your own posts.");
    }

    await deletePostInternal(postRef, post, BUNNY_API_KEY.value());
    return { ok: true };
  }
);

// ---------- Callables: report abuse + admin review queue ----------
//
// Reports are written/read entirely through the Admin SDK (never a direct client Firestore
// read/write — see the `reports` rule, which denies all client access) for the same reason
// getFeed/getUserPosts are: a client can't safely list "all pending reports" under security
// rules, and reporters shouldn't be able to read other people's reports either.

const REPORT_REASONS = ["Spam", "Harassment or bullying", "Inappropriate content", "Fake account", "Other"];

exports.submitReport = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    // Reports trigger an email to the Astryks team (see the secrets above) — cap how many one
    // account can fire off so this can't be turned into a spam/inbox-flooding vector.
    await enforceRateLimit(request.auth.uid, "submitReport", { max: 15, windowMs: 60 * 60 * 1000 });
    const { targetType, targetId, postId, reason, details } = request.data ?? {};
    if (!["post", "comment", "user"].includes(targetType)) {
      throw new HttpsError("invalid-argument", "targetType must be post, comment, or user.");
    }
    if (!targetId) {
      throw new HttpsError("invalid-argument", "targetId is required.");
    }
    if (targetType === "comment" && !postId) {
      throw new HttpsError("invalid-argument", "postId is required when reporting a comment.");
    }
    const safeReason = REPORT_REASONS.includes(reason) ? reason : "Other";
    const safeDetails = typeof details === "string" ? details.slice(0, 1000) : "";

    // Don't let the same person pile up duplicate reports on the same thing — collapse to a no-op.
    const existing = await db
      .collection("reports")
      .where("reporterId", "==", request.auth.uid)
      .where("targetType", "==", targetType)
      .where("targetId", "==", targetId)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!existing.empty) {
      return { ok: true, duplicate: true };
    }

    const reportRef = await db.collection("reports").add({
      targetType,
      targetId,
      postId: postId ?? null,
      reason: safeReason,
      details: safeDetails,
      reporterId: request.auth.uid,
      reporterName: request.auth.token.name ?? "Member",
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Let the admin know right away — previously this only wrote to Firestore with no
    // notification at all, so reports could sit unseen indefinitely.
    try {
      await sendSupportEmail(
        `New report: ${targetType} — ${safeReason}`,
        `${request.auth.token.name ?? "A member"} reported a ${targetType} (id: ${targetId}` +
          `${postId ? `, on post: ${postId}` : ""}).\n\n` +
          `Reason: ${safeReason}\n` +
          `Details: ${safeDetails || "(none provided)"}\n\n` +
          `Reporter uid: ${request.auth.uid}\n` +
          `Report id: ${reportRef.id}\n\n` +
          `Review and take action here: https://astryks.com/admin/reports`
      );
    } catch {
      // Don't fail the report just because the email failed to send — it's still saved and
      // will show up on the admin reports page either way.
    }

    return { ok: true };
  }
);

exports.getReports = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db
    .collection("reports")
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const reports = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const report = {
        id: d.id,
        ...data,
        // Millis, not a Firestore Timestamp object — httpsCallable can't serialize Timestamps,
        // and the admin UI needs a plain number to show "reported Xh ago" / flag it overdue
        // against the 24-hour response commitment in terms/page.tsx §10.
        createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
      };
      let preview = null;
      try {
        if (report.targetType === "post") {
          const postSnap = await db.doc(`posts/${report.targetId}`).get();
          if (postSnap.exists) {
            const p = postSnap.data();
            preview = { ownerId: p.ownerId, ownerName: p.ownerName, title: p.title, body: p.body, mediaUrl: p.mediaUrl, type: p.type };
          }
        } else if (report.targetType === "comment") {
          const commentSnap = await db.doc(`posts/${report.postId}/comments/${report.targetId}`).get();
          if (commentSnap.exists) {
            const c = commentSnap.data();
            preview = { ownerId: c.userId, ownerName: c.userName, body: c.body };
          }
        } else if (report.targetType === "user") {
          const userSnap = await db.doc(`users/${report.targetId}`).get();
          if (userSnap.exists) {
            const u = userSnap.data();
            preview = { ownerId: report.targetId, ownerName: u.displayName, email: u.email, photoURL: u.photoURL };
          }
        }
      } catch {
        preview = null;
      }
      return { ...report, preview };
    })
  );

  return { reports };
});

exports.resolveReport = onCall(
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID, stripeSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    // clientTargetUid is the ownerId/userId the admin's own screen already had loaded (from
    // getReports' preview) — used as a fallback below when the reported content was deleted out
    // from under this call (self-deleted, or resolved by another admin) between page load and
    // the eject click, since at that point there's no live post/comment doc left to read it from.
    const { reportId, action, targetUid: clientTargetUid } = request.data ?? {};
    // "eject" does everything "delete" does, plus permanently deletes the responsible member's
    // account — the one-click "remove content and eject the user" action App Store Guideline 1.2
    // requires (a plain "delete" only ever touched the content, never the account that posted
    // it). For a user-type report there's no separate content to delete first, just the account.
    if (!reportId || !["delete", "eject", "dismiss"].includes(action)) {
      throw new HttpsError("invalid-argument", "reportId and a valid action are required.");
    }

    const reportRef = db.doc(`reports/${reportId}`);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      throw new HttpsError("not-found", "This report no longer exists.");
    }
    const report = reportSnap.data();
    let ejectedUid = null;

    if (action === "delete" || action === "eject") {
      if (report.targetType === "post") {
        const postRef = db.doc(`posts/${report.targetId}`);
        const postSnap = await postRef.get();
        if (postSnap.exists) {
          if (action === "eject") ejectedUid = postSnap.data().ownerId ?? null;
          await deletePostInternal(postRef, postSnap.data(), BUNNY_API_KEY.value());
        } else if (action === "eject") {
          // Content's already gone (self-deleted, or a prior resolve) — fall back to whatever
          // owner uid the admin's own screen still has, rather than silently skipping the eject.
          ejectedUid = clientTargetUid ?? null;
        }
      } else if (report.targetType === "comment") {
        const commentRef = db.doc(`posts/${report.postId}/comments/${report.targetId}`);
        const commentSnap = await commentRef.get();
        if (commentSnap.exists) {
          if (action === "eject") ejectedUid = commentSnap.data().userId ?? null;
          // Just delete it — the onCommentDeleted trigger below keeps the post's commentCount
          // in sync, so there's no need (and it would double-count) to decrement it here too.
          await commentRef.delete();
        } else if (action === "eject") {
          ejectedUid = clientTargetUid ?? null;
        }
      } else if (report.targetType === "user" && action === "eject") {
        ejectedUid = report.targetId;
      }

      if (action === "eject") {
        if (!ejectedUid) {
          throw new HttpsError(
            "not-found",
            "Couldn't tell which member to eject — the content is already gone. Refresh and try again."
          );
        }
        const targetUser = await admin.auth().getUser(ejectedUid).catch(() => null);
        if (targetUser && ADMIN_EMAILS.includes(targetUser.email ?? "")) {
          throw new HttpsError("failed-precondition", "Refusing to eject an admin account.");
        }
        if (targetUser) {
          await deleteAccountInternal(ejectedUid, BUNNY_API_KEY.value(), stripeSecret.value());
        } else {
          // Account no longer exists either (already deleted) — nothing left to eject, but this
          // is a real outcome the admin should see, not a silent success.
          throw new HttpsError("not-found", "That member's account no longer exists.");
        }
      }
    }

    await reportRef.update({
      status: "resolved",
      resolvedAction: action,
      resolvedBy: request.auth.token.email,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(ejectedUid ? { ejectedUid } : {}),
    });
    return { ok: true, ejectedUid };
  }
);

// ---------- Client-side crash/error reporting ----------
//
// A self-hosted alternative to a third-party crash tool (Sentry/Bugsnag/etc.) — no external
// account to create, no DSN to manage, no per-event cost. Every unhandled error/rejection on
// web and mobile gets reported here (see ErrorReporter.tsx on web, the global handler in
// astryks-mobile's root layout) and shows up in the /admin/errors dashboard. Deliberately does
// NOT require auth: some of the most important crashes to see are ones that happen before
// someone's even logged in (a broken login screen is worse than a broken profile screen), and
// requiring auth would silently drop exactly those reports.
const CLIENT_ERROR_PLATFORMS = ["web", "ios", "android"];

exports.logClientError = onCall(async (request) => {
  const platform = CLIENT_ERROR_PLATFORMS.includes(request.data?.platform) ? request.data.platform : "web";
  // Keyed by uid when signed in, otherwise by a client-supplied installation id if present, else
  // a shared anonymous bucket — good enough to stop one broken, looping client from writing
  // unbounded documents without needing real per-IP tracking for a self-hosted debug tool.
  const rateLimitKey = request.auth?.uid || (typeof request.data?.anonId === "string" && request.data.anonId.slice(0, 100)) || "anonymous";
  await enforceRateLimit(rateLimitKey, "logClientError", { max: 30, windowMs: 10 * 60 * 1000 });

  const message = typeof request.data?.message === "string" ? request.data.message.slice(0, 2000) : "(no message)";
  const stack = typeof request.data?.stack === "string" ? request.data.stack.slice(0, 8000) : null;
  const screen = typeof request.data?.screen === "string" ? request.data.screen.slice(0, 500) : null;
  const appVersion = typeof request.data?.appVersion === "string" ? request.data.appVersion.slice(0, 50) : null;

  await db.collection("clientErrors").add({
    platform,
    message,
    stack,
    screen,
    appVersion,
    uid: request.auth?.uid ?? null,
    userEmail: request.auth?.token?.email ?? null,
    resolved: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.getClientErrors = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const includeResolved = !!request.data?.includeResolved;
  let query = db.collection("clientErrors").orderBy("createdAt", "desc").limit(200);
  if (!includeResolved) {
    query = db.collection("clientErrors").where("resolved", "==", false).orderBy("createdAt", "desc").limit(200);
  }
  const snap = await query.get();
  const errors = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toMillis ? d.data().createdAt.toMillis() : null,
  }));
  return { errors };
});

exports.resolveClientError = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const errorId = request.data?.errorId;
  if (!errorId) {
    throw new HttpsError("invalid-argument", "errorId is required.");
  }
  await db.doc(`clientErrors/${errorId}`).update({
    resolved: true,
    resolvedBy: request.auth.token.email,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// ================================================================================================
// Hall of Fame — replaces the cash Creative Prize (see the RETIRED banner just below) with pure
// recognition instead: no cash, no legal-lottery exposure, no payout ops, nothing to enter or opt
// out of. A post gets in one of two ways: (1) an admin manually features it anytime via
// addToHallOfFame, or (2) computeMonthlyHallOfFame automatically adds that calendar month's 5
// most-liked eligible posts on the 1st of the next month. Entries live directly on the post doc
// (hallOfFame/hallOfFameSource/hallOfFameMonth/hallOfFameAddedAt) rather than a separate
// collection, so displaying the gallery is just a filtered read of posts — see the posts update
// rule in firestore.rules for why a post's own owner can't set these fields themselves.
// ================================================================================================

const HALL_OF_FAME_BOT_UID = "astryks-hall-of-fame";
const HALL_OF_FAME_BOT_NAME = "Astryks Hall of Fame";

async function sendHallOfFameBotMessage(ownerId, ownerName, text) {
  const conversationId = [ownerId, HALL_OF_FAME_BOT_UID].sort().join("_");
  const convoRef = db.doc(`conversations/${conversationId}`);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    await convoRef.set({
      participants: [ownerId, HALL_OF_FAME_BOT_UID].sort(),
      participantNames: [ownerId, HALL_OF_FAME_BOT_UID]
        .sort()
        .map((id) => (id === HALL_OF_FAME_BOT_UID ? HALL_OF_FAME_BOT_NAME : ownerName || "Member")),
      lastMessage: "",
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await convoRef.collection("messages").add({
    senderId: HALL_OF_FAME_BOT_UID,
    senderName: HALL_OF_FAME_BOT_NAME,
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await convoRef.set(
    { lastMessage: text, lastMessageAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// ---------- Callable: admin-only — manually feature a post in the Hall of Fame ----------
exports.addToHallOfFame = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { postId } = request.data ?? {};
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }
  const postRef = db.doc(`posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "This post no longer exists.");
  }
  const post = postSnap.data();
  if (post.hallOfFame) {
    return { ok: true, alreadyFeatured: true };
  }

  await postRef.set(
    {
      hallOfFame: true,
      hallOfFameSource: "manual",
      hallOfFameMonth: null,
      hallOfFameAddedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await sendHallOfFameBotMessage(
      post.ownerId,
      post.ownerName,
      `🏛️ Your post just got added to the Astryks Hall of Fame — our team picked it out to spotlight. Thanks for sharing your work with us!`
    );
  } catch (err) {
    console.error("addToHallOfFame: failed to notify owner", postId, err);
  }

  return { ok: true };
});

// ---------- Callable: admin-only — un-feature a post (e.g. added by mistake) ----------
exports.removeFromHallOfFame = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { postId } = request.data ?? {};
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }
  await db.doc(`posts/${postId}`).set(
    { hallOfFame: false, hallOfFameSource: null, hallOfFameMonth: null },
    { merge: true }
  );
  return { ok: true };
});

// ---------- Callable: the public Hall of Fame gallery ----------
// A client can't list-query `posts` directly for an arbitrary field like this (same reasoning as
// the old getPrizeLeaderboard) — read with the Admin SDK and return only the public fields the
// gallery needs, filtering out anything private/flagged after the fact as a defense-in-depth
// check (posts here should already be public since only public posts can be featured, but this
// costs nothing to double-check).
exports.getHallOfFame = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const snap = await db
    .collection("posts")
    .where("hallOfFame", "==", true)
    .orderBy("hallOfFameAddedAt", "desc")
    .limit(200)
    .get();

  const entries = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.visibility !== "private" && p.moderationStatus !== "flagged")
    .map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      ownerName: p.ownerName || "Member",
      type: p.type,
      mediaUrl: p.mediaUrl || null,
      bunnyVideoId: p.bunnyVideoId || null,
      bunnyLibraryId: p.bunnyLibraryId || null,
      title: p.title || null,
      likeCount: p.likeCount ?? 0,
      hallOfFameSource: p.hallOfFameSource || "manual",
      hallOfFameMonth: p.hallOfFameMonth || null,
    }));

  return { entries };
});

// ---------- Scheduled: automatically feature the month's 5 most-liked posts ----------
// Runs the 1st of each month, same cadence the old prize report used to. Picks from the PREVIOUS
// calendar month's public photo/video posts, skips anything already featured, and just adds —
// there's no minimum like count and nothing to opt out of, since (unlike the cash prize) there's
// no money and no consideration/lottery risk to manage here.
exports.computeMonthlyHallOfFame = onSchedule(
  { schedule: "0 9 1 * *", timeZone: "Australia/Sydney", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async () => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthLabel = prevMonthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    const monthId = monthKey(prevMonthStart);

    const snap = await db
      .collection("posts")
      .where("createdAt", ">=", prevMonthStart)
      .where("createdAt", "<", thisMonthStart)
      .get();

    const top5 = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (p) =>
          ["photo", "video"].includes(p.type) &&
          p.visibility !== "private" &&
          p.moderationStatus !== "flagged" &&
          !p.hallOfFame
      )
      .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
      .slice(0, 5);

    if (top5.length === 0) {
      await sendSupportEmail(
        `Astryks Hall of Fame — ${monthLabel}: nothing to add`,
        `No eligible photo/video posts from ${monthLabel} to add automatically this month.`
      );
      return;
    }

    const batch = db.batch();
    top5.forEach((p) => {
      batch.set(
        db.doc(`posts/${p.id}`),
        {
          hallOfFame: true,
          hallOfFameSource: "monthly-top",
          hallOfFameMonth: monthId,
          hallOfFameAddedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();

    for (const p of top5) {
      try {
        await sendHallOfFameBotMessage(
          p.ownerId,
          p.ownerName,
          `🏛️ Your post was one of the ${top5.length} most-loved from ${monthLabel} — we've added it to the Astryks Hall of Fame. Thanks for sharing your work with the community!`
        );
      } catch (err) {
        console.error("computeMonthlyHallOfFame: failed to notify owner", p.id, err);
      }
    }

    const lines = top5
      .map((p, i) => `${i + 1}. ${p.ownerName || "Member"} — ${p.likeCount ?? 0} likes — "${p.title || `(${p.type} post)`}"`)
      .join("\n");
    await sendSupportEmail(
      `Astryks Hall of Fame — ${monthLabel}: ${top5.length} post(s) added`,
      `Automatically added this month's top ${top5.length} most-liked posts to the Hall of Fame:\n\n${lines}`
    );
  }
);

// ================================================================================================
// RETIRED (Sept 2026): the AU$1,000/month Creative Prize has been replaced by the Hall of Fame
// (see addToHallOfFame/removeFromHallOfFame/getHallOfFame/computeMonthlyHallOfFame below) — pure
// recognition, no cash, no legal-lottery exposure, no payout ops. Everything from here down to
// runPrizeReportNow is the old cash-prize implementation, kept in place (not deleted) in case this
// ever needs to be revisited, but deliberately un-exported (renamed exports.X -> const _legacy_X)
// so none of it deploys as a live Cloud Function anymore. onPostCreated below no longer calls
// nominateForPrize for the same reason — new posts are no longer auto-entered into anything.
// ================================================================================================

// ---------- Callable: let a post's owner opt themselves out of the creative prize ----------

const _legacy_optOutOfPrize = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const postId = request.data?.postId;
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }

  const postRef = db.doc(`posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "This post no longer exists.");
  }
  const post = postSnap.data();
  if (post.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Only the post's owner can opt it out of the prize.");
  }

  if (post.prizeOptOut) {
    return { ok: true, alreadyOptedOut: true };
  }

  await postRef.set({ prizeOptOut: true, prizeEligible: false }, { merge: true });
  await sendPrizeBotMessage(
    post.ownerId,
    post.ownerName,
    "No worries — that post has been pulled out of this month's creative prize draw. Message us here if you ever change your mind."
  );
  return { ok: true };
});

// Reverses optOutOfPrize above — was previously a one-way door with no way back in short of
// contacting support. Re-entry is free and immediate (matching how entry works for every other
// post — see the big comment on nominateForPrize), so this just flips the same two fields back.
const _legacy_optInToPrize = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const postId = request.data?.postId;
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }

  const postRef = db.doc(`posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "This post no longer exists.");
  }
  const post = postSnap.data();
  if (post.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Only the post's owner can opt it back into the prize.");
  }
  if (!["photo", "video"].includes(post.type)) {
    throw new HttpsError("failed-precondition", "Only photo and video posts can enter the creative prize.");
  }

  if (!post.prizeOptOut) {
    return { ok: true, alreadyOptedIn: true };
  }

  await postRef.set({ prizeOptOut: false, prizeEligible: true }, { merge: true });
  return { ok: true };
});

// ---------- Callable: let a post's owner share how they made it, for the Creative Prize ----------
// Purely informational for the human review step in sendMonthlyPrizeReport/approvePrizeWinnerAnnouncement
// below — it's never a technical gate on entry (see the legal-review comment on nominateForPrize for why
// entry itself has to stay free and automatic). Firestore rules already let a post's owner write any field
// on their own post directly, so this callable exists for the rate limit, the confirmation message, and a
// single validated place both apps can call rather than each hand-rolling their own writes.
const _legacy_submitPrizeProcessNote = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await enforceRateLimit(request.auth.uid, "submitPrizeProcessNote", { max: 30, windowMs: 60 * 60 * 1000 });
  const { postId, note, videoUrl } = request.data ?? {};
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }
  if (note != null && typeof note !== "string") {
    throw new HttpsError("invalid-argument", "note must be a string.");
  }
  if (videoUrl != null && typeof videoUrl !== "string") {
    throw new HttpsError("invalid-argument", "videoUrl must be a string.");
  }
  let safeVideoUrl = null;
  if (videoUrl) {
    try {
      const parsed = new URL(videoUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("bad scheme");
      }
      safeVideoUrl = videoUrl.slice(0, 500);
    } catch {
      throw new HttpsError("invalid-argument", "That doesn't look like a valid link — please use a full http(s) URL.");
    }
  }

  const postRef = db.doc(`posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "This post no longer exists.");
  }
  const post = postSnap.data();
  if (post.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Only the post's owner can add this.");
  }

  await postRef.set(
    {
      prizeProcessNote: note ? note.trim().slice(0, 600) : null,
      prizeProcessVideoUrl: safeVideoUrl,
      prizeProcessUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
});

// ---------- Callable: this month's top creative posts, for the in-app leaderboard ----------
// Scoped to posts created since the start of the current calendar month (mirrors the monthly
// report's "this month's own posts only" rule) — a client can't list-query `posts` directly
// (see the comment above `reports`), so this reads with the Admin SDK and returns just the
// public fields a leaderboard needs.

const _legacy_getPrizeLeaderboard = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const snap = await db.collection("posts").where("createdAt", ">=", thisMonthStart).get();

  // Entry is free for any account (see the comment on nominateForPrize for why) — no
  // subscription filter here.
  const top = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => ["photo", "video"].includes(p.type) && !p.prizeOptOut && p.visibility !== "private")
    .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
    .slice(0, 10);

  // Best-effort — a missing/failed user lookup just means no flag shows for that entry.
  const leaderboard = await Promise.all(
    top.map(async (p) => {
      let countryCode = null;
      try {
        const ownerSnap = await db.doc(`users/${p.ownerId}`).get();
        countryCode = ownerSnap.data()?.countryCode || null;
      } catch {
        countryCode = null;
      }
      return {
        postId: p.id,
        ownerId: p.ownerId,
        ownerName: p.ownerName || "Member",
        countryCode,
        likeCount: p.likeCount ?? 0,
        title: p.title || null,
        mediaUrl: p.type === "photo" ? p.mediaUrl : null,
        type: p.type,
        // "Entered" the draw vs. actually cleared the like bar to be in contention to win —
        // the UI can use likeThreshold to show "X / 30 likes" progress either way.
        eligible: !!p.prizeEligible,
        meetsLikeThreshold: (p.likeCount ?? 0) >= PRIZE_LIKE_THRESHOLD,
        likeThreshold: PRIZE_LIKE_THRESHOLD,
      };
    })
  );

  return { leaderboard };
});

// ---------- Callable: last completed month's creative-prize winner, for the public banner ----------

const _legacy_getLatestPrizeWinner = onCall(async () => {
  // Skip any winner whose payout is on hold (see PRIZE_PAYOUTS_ENABLED) — don't publicly
  // announce a cash prize we haven't actually confirmed we can legally pay out yet. Also skip
  // anything not yet `announced` — that flag only flips once the admin explicitly approves it
  // via approvePrizeWinnerAnnouncement, so a candidate winner never shows up here before the
  // admin has actually reviewed and signed off on it. Look back a few months in case the most
  // recent one (or several) are held/unapproved.
  const snap = await db.collection("prizeWinners").orderBy("month", "desc").limit(6).get();
  const winnerDoc = snap.docs.find((d) => !d.data().payoutHeld && d.data().announced);
  if (!winnerDoc) return { winner: null };
  const w = winnerDoc.data();

  let countryCode = null;
  try {
    const ownerSnap = await db.doc(`users/${w.ownerId}`).get();
    countryCode = ownerSnap.data()?.countryCode || null;
  } catch {
    countryCode = null;
  }

  return {
    winner: {
      month: w.month,
      monthLabel: w.monthLabel,
      postId: w.postId,
      ownerName: w.ownerName,
      countryCode,
      likeCount: w.likeCount,
      title: w.title,
      mediaUrl: w.mediaUrl,
      type: w.type,
    },
  };
});

// ---------- Callable: a nominated post's owner shares how to pay them, ahead of time ----------
// Kept in its own locked-down collection (see the `prizePayouts` rule) rather than on the post
// itself, since posts are publicly readable and bank/PayID details must not be.

const _legacy_submitPrizePayoutDetails = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    await enforceRateLimit(request.auth.uid, "submitPrizePayoutDetails", { max: 20, windowMs: 60 * 60 * 1000 });
    const { postId, method, details } = request.data ?? {};
    if (!postId || !["bank", "payid"].includes(method) || !details || typeof details !== "string") {
      throw new HttpsError("invalid-argument", "postId, a method of 'bank' or 'payid', and details are required.");
    }

    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) {
      throw new HttpsError("not-found", "This post no longer exists.");
    }
    const post = postSnap.data();
    if (post.ownerId !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Only the post's owner can submit payout details for it.");
    }

    await db.doc(`prizePayouts/${postId}`).set(
      {
        postId,
        ownerId: post.ownerId,
        ownerName: post.ownerName || "Member",
        method,
        details: details.slice(0, 500),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await sendPrizeBotMessage(
      post.ownerId,
      post.ownerName,
      "Thanks — we've saved your payout details for this post. If it wins, we'll use these to send the AU$1,000 " +
        "straight away. You can update them anytime by sending new details the same way."
    );

    // Same "come take a look" alert as the Stripe path above — only fires if this post is
    // actually this month's unpaid, un-held winner (not just anyone pre-emptively saving
    // details on a post that hasn't won anything).
    try {
      const winnersSnap = await db
        .collection("prizeWinners")
        .where("postId", "==", postId)
        .where("paid", "==", false)
        .get();
      for (const winnerDoc of winnersSnap.docs) {
        const winner = winnerDoc.data();
        if (winner.payoutHeld) continue;
        await notifyAdmin(
          `💰 Ready to pay: ${winner.ownerName || post.ownerName || "this month's winner"} added bank/PayID details`,
          `${winner.ownerName || post.ownerName || "This month's winner"} just added manual ${method === "bank" ? "bank transfer" : "PayID"} ` +
            `details for the ${winner.monthLabel} Creative Prize (AU$${PRIZE_AUD}).\n\n` +
            `Nothing has been sent — go to https://astryks.com/admin/prizes to review the details and send it ` +
            `yourself when you're ready (or nudge them toward the faster Stripe direct-deposit option instead).`
        );
      }
    } catch (err) {
      console.error("submitPrizePayoutDetails: failed to check for a ready-to-pay winner", postId, err);
    }

    return { ok: true };
  }
);

// ---------- Callable: admin-only — every month's creative-prize winner + payout/paid status ----------

const _legacy_getPrizeWinners = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db.collection("prizeWinners").orderBy("month", "desc").limit(60).get();
  const winners = await Promise.all(
    snap.docs.map(async (d) => {
      const w = { id: d.id, ...d.data() };
      let payout = null;
      let countryCode = null;
      let payoutAccount = null;
      try {
        const payoutSnap = await db.doc(`prizePayouts/${w.postId}`).get();
        if (payoutSnap.exists) payout = payoutSnap.data();
      } catch {
        payout = null;
      }
      try {
        const ownerSnap = await db.doc(`users/${w.ownerId}`).get();
        countryCode = ownerSnap.data()?.countryCode || null;
      } catch {
        countryCode = null;
      }
      try {
        const payoutAcctSnap = await db.doc(`payoutAccounts/${w.ownerId}`).get();
        if (payoutAcctSnap.exists) {
          payoutAccount = { payoutsEnabled: !!payoutAcctSnap.data().payoutsEnabled };
        }
      } catch {
        payoutAccount = null;
      }
      return { ...w, payout, countryCode, payoutAccount };
    })
  );
  return { winners };
});

// ---------- Callable: admin-only — nudge a winner who hasn't shared payout details yet ----------
// Winners are invited to share bank/PayID details the moment they post (see nominateForPrize),
// but that can be weeks before they actually win, easy to miss or ignore. This sends the exact
// same in-app form again (rendered wherever a `prizeWin`/`prizeNomination` message shows up,
// see app/messages/[conversationId]/page.tsx) so there's a clear, low-friction way for them to
// add their details even if they skipped it the first time.
const _legacy_sendPayoutReminder = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { postId } = request.data ?? {};
  if (!postId) {
    throw new HttpsError("invalid-argument", "postId is required.");
  }
  const postSnap = await db.doc(`posts/${postId}`).get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "That post no longer exists.");
  }
  const post = postSnap.data();
  await sendPrizeBotMessage(
    post.ownerId,
    post.ownerName,
    `Quick one — we still don't have your payout details on file for your AU$${PRIZE_AUD} prize. Tap "Share ` +
      `payout details" below whenever you get a chance (bank transfer or PayID both work) and we'll get it sent ` +
      `your way.`,
    { type: "prizeWin", postId }
  );
  return { ok: true };
});

// ---------- Callable: admin-only — mark a month's prize as paid (or undo that) ----------

const _legacy_markPrizeWinnerPaid = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { month, paid } = request.data ?? {};
  if (!month) {
    throw new HttpsError("invalid-argument", "month is required.");
  }
  await db.doc(`prizeWinners/${month}`).set(
    {
      paid: !!paid,
      paidAt: paid ? admin.firestore.FieldValue.serverTimestamp() : null,
    },
    { merge: true }
  );
  return { ok: true };
});

// ---------- Callable: admin-only — the actual "approve before anyone is told" gate ----------
// This is the only path by which a winner ever finds out they won, or the public site ever
// shows a winner. sendMonthlyPrizeReport only ever records a *candidate* and emails you — this
// is the explicit, deliberate action that (a) sends the winner their congratulations email +
// an in-app message, and (b) flips `announced: true`, which is what both getLatestPrizeWinner
// (public banner) and this page's "already notified" badge key off. One-way on purpose — once
// someone's been congratulated, there's no un-sending that email.
const _legacy_approvePrizeWinnerAnnouncement = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    const { month } = request.data ?? {};
    if (!month) {
      throw new HttpsError("invalid-argument", "month is required.");
    }

    const winnerRef = db.doc(`prizeWinners/${month}`);
    const winnerSnap = await winnerRef.get();
    if (!winnerSnap.exists) {
      throw new HttpsError("not-found", "No winner recorded for that month.");
    }
    const winner = winnerSnap.data();
    if (winner.announced) {
      throw new HttpsError("failed-precondition", "This winner has already been notified.");
    }
    if (winner.payoutHeld) {
      throw new HttpsError(
        "failed-precondition",
        "This month's payout is on hold (PRIZE_PAYOUTS_ENABLED is false) — flip that on first."
      );
    }

    let email = null;
    try {
      const userRecord = await admin.auth().getUser(winner.ownerId);
      email = userRecord.email;
    } catch (err) {
      console.error("approvePrizeWinnerAnnouncement: couldn't look up winner's auth user", winner.ownerId, err);
    }

    if (email) {
      try {
        const { subject, text, html } = buildWinnerCongratsEmail(winner.ownerName, winner.monthLabel, winner.postId);
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: SUPPORT_EMAIL_USER.value(), pass: SUPPORT_EMAIL_PASS.value() },
        });
        await transporter.sendMail({
          from: `Astryks <${SUPPORT_EMAIL_USER.value()}>`,
          to: email,
          subject,
          text,
          html,
        });
      } catch (err) {
        console.error("approvePrizeWinnerAnnouncement: failed to email winner", email, err);
      }
    }

    try {
      await sendPrizeBotMessage(
        winner.ownerId,
        winner.ownerName,
        `🎉 Huge congratulations, ${winner.ownerName || "there"} — your post won ${winner.monthLabel}'s Astryks ` +
          `Creative Prize! Out of everything posted this month, yours is the one the community rallied around the ` +
          `most — that's AU$${PRIZE_AUD} coming your way. Thank you for sharing it with all of us. We'll follow up ` +
          `right here about sending your prize — if you haven't already shared your payout details (bank transfer ` +
          `or PayID), just reply whenever suits. Congratulations again — you earned this.`,
        { type: "prizeWin", postId: winner.postId }
      );
    } catch (err) {
      console.error("approvePrizeWinnerAnnouncement: failed to send in-app message", winner.ownerId, err);
    }

    await winnerRef.set(
      { announced: true, announcedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { ok: true, notifiedEmail: email };
  }
);

// ---------- Callable: admin-only — swap in a different nominee as the recorded winner ----------
// The monthly job always auto-picks whoever has the most likes, but likes alone can't tell a genuine
// creative post from a meme or a repost that farmed engagement — that judgment call is exactly what this
// exists for. Only works before approvePrizeWinnerAnnouncement has fired (once someone's been told they
// won, that can't be walked back), and the replacement must be one of that month's own recorded nominees.
const _legacy_overridePrizeWinner = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { month, postId } = request.data ?? {};
  if (!month || !postId) {
    throw new HttpsError("invalid-argument", "month and postId are required.");
  }

  const winnerRef = db.doc(`prizeWinners/${month}`);
  const winnerSnap = await winnerRef.get();
  if (!winnerSnap.exists) {
    throw new HttpsError("not-found", "No winner recorded for that month.");
  }
  const current = winnerSnap.data();
  if (current.announced) {
    throw new HttpsError("failed-precondition", "This winner has already been notified — that can't be undone.");
  }
  const nominee = (current.nominees ?? []).find((n) => n.postId === postId);
  if (!nominee) {
    throw new HttpsError("invalid-argument", "That post isn't one of this month's recorded nominees.");
  }

  const postSnap = await db.doc(`posts/${postId}`).get();
  if (!postSnap.exists) {
    throw new HttpsError("not-found", "That post no longer exists.");
  }
  const post = postSnap.data();

  await winnerRef.set(
    {
      postId,
      ownerId: post.ownerId,
      ownerName: post.ownerName || nominee.ownerName || "Member",
      likeCount: post.likeCount ?? nominee.likeCount ?? 0,
      title: post.title || null,
      mediaUrl: post.type === "photo" ? post.mediaUrl : null,
      type: post.type,
      processNote: post.prizeProcessNote || null,
      processVideoUrl: post.prizeProcessVideoUrl || null,
      overriddenFrom: current.postId !== postId ? current.postId : current.overriddenFrom ?? null,
    },
    { merge: true }
  );

  return { ok: true };
});

// ---------- Shared: permanently delete a uid's posts, edges, and account ----------
//
// Used by both the admin tool (deleteUserAccount, by email) and the self-service
// "Delete my account" button (deleteMyAccount, deletes the caller's own uid) — this is also
// what App Store/Play Store now require: an in-app path for a user to delete their own
// account and data, not just an admin-only tool.
async function deleteAccountInternal(uid, bunnyApiKey, stripeSecretValue) {
  // Captured up front, before anything below deletes the actual auth user — there's no way to
  // look up an email address for a uid that no longer exists, so this is the only chance to get
  // it for the deletion-confirmation email sent at the very end of this function.
  let deletedUserEmail = null;
  let deletedUserName = null;
  try {
    const authUser = await admin.auth().getUser(uid);
    deletedUserEmail = authUser.email || null;
    deletedUserName = authUser.displayName || null;
  } catch (err) {
    console.error(`deleteAccountInternal: couldn't look up auth user ${uid} before deletion`, err);
  }

  // Cancel any active Stripe subscription FIRST, before anything else below deletes
  // users/{uid} (the only place stripeCustomerId is stored). Without this, someone who
  // deletes their own account keeps being billed by Stripe on schedule — Stripe has no idea
  // the account is gone — and once users/{uid} is gone there's no record left anywhere to
  // even notice the still-active subscription. Cancel immediately (not "at period end" like
  // the self-serve cancel flow), since there's no account left for a period to end for.
  // Best-effort/non-blocking: a Stripe hiccup shouldn't prevent someone from deleting their
  // account, but it's logged clearly so it doesn't fail silently.
  try {
    const userSnapForStripe = await db.doc(`users/${uid}`).get();
    const customerId = userSnapForStripe.data()?.stripeCustomerId;
    if (customerId && stripeSecretValue) {
      const stripe = Stripe(stripeSecretValue);
      const subsList = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      for (const sub of subsList.data) {
        if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    }
  } catch (err) {
    console.error(`deleteAccountInternal: failed to cancel Stripe subscription for ${uid} — needs manual follow-up in Stripe`, err);
  }

  // Delete all of this user's posts, with the same cleanup deletePost does for each one
  // (this also cleans up that post's own prizePayouts doc — see deletePostInternal). One post
  // failing to clean up (e.g. a transient Storage error) shouldn't abort the account deletion
  // for every other post and leave the Auth account undeleted — log and move on instead.
  const postsSnap = await db.collection("posts").where("ownerId", "==", uid).get();
  for (const postDoc of postsSnap.docs) {
    try {
      await deletePostInternal(postDoc.ref, postDoc.data(), bunnyApiKey);
    } catch (err) {
      console.error(`deleteAccountInternal: failed to clean up post ${postDoc.id} for ${uid} — continuing`, err);
    }
  }

  // Remove follow edges in both directions.
  const [asFollower, asFollowing] = await Promise.all([
    db.collection("follows").where("followerId", "==", uid).get(),
    db.collection("follows").where("followingId", "==", uid).get(),
  ]);
  const followBatch = db.batch();
  asFollower.docs.forEach((d) => followBatch.delete(d.ref));
  asFollowing.docs.forEach((d) => followBatch.delete(d.ref));
  if (!asFollower.empty || !asFollowing.empty) await followBatch.commit();

  // Remove saved-post entries and lesson progress.
  const [savesSnap, progressSnap] = await Promise.all([
    db.collection("saves").where("uid", "==", uid).get(),
    db.collection("lessonProgress").where("uid", "==", uid).get(),
  ]);
  const cleanupBatch = db.batch();
  savesSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
  progressSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
  if (!savesSnap.empty || !progressSnap.empty) await cleanupBatch.commit();

  // Remove any likes/comments this user left on OTHER people's posts — deleting these fires
  // onLikeDeleted/onCommentDeleted (see those triggers above), which keeps each affected post's
  // likeCount/commentCount correctly in sync automatically, so no manual decrement is needed
  // here. Best-effort: wrapped so a missing Firestore index or transient error doesn't block
  // the rest of account deletion (the more sensitive data below still gets removed either way).
  try {
    const commentsSnap = await db.collectionGroup("comments").where("userId", "==", uid).get();
    if (!commentsSnap.empty) {
      const commentBatch = db.batch();
      commentsSnap.docs.forEach((d) => commentBatch.delete(d.ref));
      await commentBatch.commit();
    }
  } catch (err) {
    console.error(`deleteAccountInternal: comment cleanup failed for ${uid}:`, err);
  }
  try {
    // Like docs are keyed BY the liker's uid (posts/{postId}/likes/{uid}) rather than having a
    // userId field, so there's no field to filter a collectionGroup query on — this does a full
    // scan of the likes collection group. Fine at today's scale; worth revisiting (e.g. a
    // separate per-user index of what they've liked) if the app grows a lot.
    const likesSnap = await db.collectionGroup("likes").get();
    const mine = likesSnap.docs.filter((d) => d.id === uid);
    for (let i = 0; i < mine.length; i += 400) {
      const likeBatch = db.batch();
      mine.slice(i, i + 400).forEach((d) => likeBatch.delete(d.ref));
      await likeBatch.commit();
    }
  } catch (err) {
    console.error(`deleteAccountInternal: like cleanup failed for ${uid}:`, err);
  }

  // Remove their referral code mapping, if they ever generated one (see getOrCreateReferralCode).
  try {
    const referralCodeSnap = await db.collection("referralCodes").where("uid", "==", uid).get();
    if (!referralCodeSnap.empty) {
      const referralBatch = db.batch();
      referralCodeSnap.docs.forEach((d) => referralBatch.delete(d.ref));
      await referralBatch.commit();
    }
  } catch (err) {
    console.error(`deleteAccountInternal: referral code cleanup failed for ${uid}:`, err);
  }

  // Delete their Firestore user doc, then their actual login.
  await db.doc(`users/${uid}`).delete();
  await admin.auth().deleteUser(uid);

  if (deletedUserEmail) {
    try {
      await sendBrandedEmail(deletedUserEmail, buildAccountDeletedEmail(deletedUserName));
    } catch (err) {
      console.error(`deleteAccountInternal: failed to send deletion confirmation to ${deletedUserEmail}`, err);
    }
  }
}

// ---------- Callable: admin-only — permanently delete a user's account and their content ----------

exports.deleteUserAccount = onCall(
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID, stripeSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    if (!(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }

    const email = (request.data?.email || "").trim().toLowerCase();
    if (!email) {
      throw new HttpsError("invalid-argument", "An email address is required.");
    }
    if (ADMIN_EMAILS.includes(email)) {
      throw new HttpsError("failed-precondition", "Refusing to delete an admin account.");
    }

    let targetUser;
    try {
      targetUser = await admin.auth().getUserByEmail(email);
    } catch {
      throw new HttpsError("not-found", `No account found for ${email}.`);
    }

    await deleteAccountInternal(targetUser.uid, BUNNY_API_KEY.value(), stripeSecret.value());
    return { ok: true, deletedUid: targetUser.uid };
  }
);

// ---------- Callable: self-service — a user permanently deletes their own account ----------
//
// Required by Google Play's Data Safety policy (and good practice generally): anyone who can
// create an account in-app must also be able to delete it and their data in-app, without
// having to email support. Web: called from app/me/page.tsx. Mobile: called from
// app/(tabs)/me.tsx.
exports.deleteMyAccount = onCall({ secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID, stripeSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await deleteAccountInternal(request.auth.uid, BUNNY_API_KEY.value(), stripeSecret.value());
  return { ok: true };
});

// ---------- Feed reads that need to hide someone else's private posts ----------
//
// Firestore security rules can't "filter" a list query — if a broad query like
// "all posts" or "this person's posts" could possibly match a document the
// caller isn't allowed to read (their private post), Firestore rejects the
// WHOLE query rather than silently dropping just that document. So instead of
// querying Firestore directly from the client for the home feed and other
// people's profile pages, we do the fetch here with the Admin SDK (which
// isn't subject to that restriction) and filter out private posts that don't
// belong to the caller before returning results. Firestore Timestamps are
// converted to plain millisecond numbers since they don't survive the
// callable-functions wire format as Date objects.

function serializePost(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
  };
}

// The `post.visibility !== "private" || post.ownerId === callerUid` clause here is specifically
// for profile-style views (getUserPosts) where seeing your own private posts on your own
// profile is the whole point. getFeed below deliberately does NOT rely on that clause — the
// general public feed should never show a private post, including the owner's own, so it adds
// its own unconditional private-post exclusion on top of this.
function isVisibleTo(post, callerUid, blockedSet) {
  if (post.moderationStatus === "flagged" && post.ownerId !== callerUid) return false;
  if (blockedSet && blockedSet.has(post.ownerId)) return false;
  return post.visibility !== "private" || post.ownerId === callerUid;
}

// Returns the union of who the caller has blocked and who has blocked the caller — either
// direction is enough to hide someone's content from the other, matching how blocking works on
// most social apps (mutual invisibility, not just one-way). Used by getFeed/getUserPosts/
// listPublicProfiles so a block actually hides content everywhere, not just in one screen.
async function getBlockedSet(uid) {
  if (!uid) return new Set();
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() || {};
  return new Set([...(data.blockedUserIds || []), ...(data.blockedByUserIds || [])]);
}

// Used by getUserPosts (profile view) below, which isn't paginated — a single profile's own
// post count is naturally bounded enough that 500 is still a reasonable cap there.
const FEED_PAGE_LIMIT = 500;

// getFeed itself IS cursor-paginated (see below) — this is just its page size. Was previously
// fetching all 500 posts (FEED_PAGE_LIMIT) on every single Home load regardless of how many the
// screen actually shows, which is a big part of why Home was slow to load as post volume grew.
const FEED_PAGE_SIZE = 20;

exports.getFeed = onCall(async (request) => {
  const callerUid = request.auth?.uid || null;
  const cursorId = request.data?.cursor;
  // Callers can ask for a bigger page (e.g. the "Following" scope, which filters this same feed
  // client-side and needs a wider sample to find enough matches) — capped well below the old
  // fixed 500 so a caller can't force a full unbounded scan.
  const pageSize = Math.min(Math.max(Number(request.data?.pageSize) || FEED_PAGE_SIZE, 1), 100);

  let query = db.collection("posts").orderBy("createdAt", "desc").limit(pageSize);
  if (cursorId) {
    const cursorSnap = await db.doc(`posts/${cursorId}`).get();
    if (cursorSnap.exists) {
      query = query.startAfter(cursorSnap);
    }
  }

  const [snap, blockedSet] = await Promise.all([query.get(), getBlockedSet(callerUid)]);
  // Private posts never belong in the general public feed — not even the owner's own. (Their
  // own profile page, via getUserPosts below, is where they see those.) This was previously
  // missing, so making a post "Private" only hid it from other users, not from showing up in
  // your own Home feed right alongside everything public.
  const posts = snap.docs
    .map(serializePost)
    .filter((p) => p.visibility !== "private" && isVisibleTo(p, callerUid, blockedSet));

  // nextCursor is the last RAW doc from this page (before the private/blocked filter above), not
  // the last post actually returned — otherwise a page that filtered something out would skip
  // straight past posts the next page should still visit.
  const lastDoc = snap.docs[snap.docs.length - 1];
  return { posts, nextCursor: lastDoc ? lastDoc.id : null, hasMore: snap.docs.length === pageSize };
});

exports.getUserPosts = onCall(async (request) => {
  const callerUid = request.auth?.uid || null;
  const userId = request.data?.userId;
  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }
  const isAdmin = (ADMIN_EMAILS.includes(request.auth?.token?.email ?? "") && request.auth?.token?.email_verified === true);

  const blockedSet = await getBlockedSet(callerUid);
  if (blockedSet.has(userId) && !isAdmin) {
    // Either this user has blocked the caller, or the caller has blocked them — either way,
    // don't hand back their posts. The client shows a neutral "unavailable" state for this.
    return { posts: [], blocked: true };
  }

  const snap = await db
    .collection("posts")
    .where("ownerId", "==", userId)
    .where("type", "in", ["photo", "video"])
    .orderBy("createdAt", "desc")
    .limit(FEED_PAGE_LIMIT)
    .get();

  const posts = snap.docs
    .map(serializePost)
    .filter((p) => (p.visibility !== "private" || p.ownerId === callerUid || isAdmin))
    .filter((p) => p.moderationStatus !== "flagged" || p.ownerId === callerUid || isAdmin);
  return { posts, blocked: false };
});

// Public-facing info for someone's profile page — deliberately returns only the two fields
// that page actually renders (displayName/photoURL). firestore.rules restricts users/{uid}
// reads to the document's own owner (that doc also holds stripeCustomerId/subscriptionStatus/
// payoutOwed — rules can only gate a whole document, never individual fields on it), so this is
// how everyone else still gets to see a name and a photo without also being able to read
// someone else's billing data straight out of Firestore.
exports.getPublicProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const targetUid = request.data?.uid;
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  const snap = await db.doc(`users/${targetUid}`).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "That profile doesn't exist.");
  }
  const data = snap.data();
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  const callerData = callerSnap.data() || {};
  return {
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    blockedByMe: (callerData.blockedUserIds || []).includes(targetUid),
    blockedMe: (data.blockedUserIds || []).includes(request.auth.uid),
  };
});

// Same reasoning as getPublicProfile, but for the two screens that browse/search many people at
// once (Messages' "New message" search, the home feed's "Suggested for you" row). Both used to
// run a direct `collection("users").limit(N)` query straight from the client — harmless while
// users/{uid} only held public fields, but once billing fields lived on the same document that
// query handed back everyone's stripeCustomerId/payoutOwed/subscriptionStatus too, to anyone
// signed in. This returns only what those screens actually render.
exports.listPublicProfiles = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const requested = Number(request.data?.limit) || 200;
  const cappedLimit = Math.min(Math.max(requested, 1), 200);
  const blockedSet = await getBlockedSet(request.auth.uid);
  const snap = await db.collection("users").limit(cappedLimit + blockedSet.size).get();
  const profiles = snap.docs
    .filter((d) => !blockedSet.has(d.id))
    .slice(0, cappedLimit)
    .map((d) => ({
      uid: d.id,
      displayName: d.data().displayName ?? null,
      photoURL: d.data().photoURL ?? null,
    }));
  return { profiles };
});

// Callable: block another user. Writes to both docs in one batch — the blocker's own
// blockedUserIds (so they can manage/unblock later) AND the target's blockedByUserIds (a
// denormalized reverse index, so getFeed/getUserPosts/listPublicProfiles can hide content in
// both directions without an expensive query for "who has blocked me"). Scope of what blocking
// actually does today: hides the other person's posts from your feed/profile/search, stops
// either side from posting a NEW like or comment on the other's posts, and prevents new
// messages between you (see firestore.rules' isBlockedPair, used by the likes/comments/
// conversations/messages rules) — it does NOT retroactively remove likes/comments/messages that
// already existed before the block.
exports.blockUser = onCall({ secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  // Every other write-heavy callable here is rate-limited; this one writes to a DIFFERENT
  // user's document (targetUid's blockedByUserIds) on every call, so without a limit a
  // malicious account could cycle through many targets (or the same one) to run up unbounded
  // Firestore reads/writes at someone else's expense.
  await enforceRateLimit(request.auth.uid, "blockUser", { max: 30, windowMs: 60 * 60 * 1000 });
  const targetUid = request.data?.targetUid;
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }
  if (targetUid === request.auth.uid) {
    throw new HttpsError("invalid-argument", "You can't block yourself.");
  }
  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "That account doesn't exist.");
  }
  const batch = db.batch();
  batch.set(
    db.doc(`users/${request.auth.uid}`),
    { blockedUserIds: admin.firestore.FieldValue.arrayUnion(targetUid) },
    { merge: true }
  );
  batch.set(
    db.doc(`users/${targetUid}`),
    { blockedByUserIds: admin.firestore.FieldValue.arrayUnion(request.auth.uid) },
    { merge: true }
  );
  await batch.commit();
  // Required by App Store Guideline 1.2: blocking an abusive user must also notify the
  // developer of the inappropriate content, not just hide it from the blocker. This is
  // independent of (and doesn't require) the blocker also filing a Report — every block reaches
  // the admin either way, same channel as submitReport/flagPostForModeration below.
  notifyAdmin(
    "Astryks: a member was blocked",
    `${request.auth.uid} blocked ${targetUid}. Review their recent posts/comments at astryks.com/admin/reports if this looks like abuse.`
  ).catch(() => {});
  return { success: true };
});

// Callable: undo blockUser — same two-doc batch, in reverse.
exports.unblockUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  // Same reasoning as blockUser's limit above — this also writes to another user's document.
  await enforceRateLimit(request.auth.uid, "unblockUser", { max: 30, windowMs: 60 * 60 * 1000 });
  const targetUid = request.data?.targetUid;
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }
  const batch = db.batch();
  batch.set(
    db.doc(`users/${request.auth.uid}`),
    { blockedUserIds: admin.firestore.FieldValue.arrayRemove(targetUid) },
    { merge: true }
  );
  batch.set(
    db.doc(`users/${targetUid}`),
    { blockedByUserIds: admin.firestore.FieldValue.arrayRemove(request.auth.uid) },
    { merge: true }
  );
  await batch.commit();
  return { success: true };
});

// Callable: list of accounts the caller has blocked, with enough info for a "Blocked accounts"
// management screen to render and offer an unblock button.
exports.getBlockedUsers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  const blockedUserIds = snap.data()?.blockedUserIds || [];
  if (blockedUserIds.length === 0) {
    return { users: [] };
  }
  // Firestore's getAll is the right tool here instead of N individual .get() calls — same
  // number of billed reads either way, but one round trip instead of N.
  const refs = blockedUserIds.map((uid) => db.doc(`users/${uid}`));
  const snaps = await db.getAll(...refs);
  const users = snaps
    .filter((s) => s.exists)
    .map((s) => ({ uid: s.id, displayName: s.data().displayName ?? "Member", photoURL: s.data().photoURL ?? null }));
  return { users };
});

// One-time maintenance callable: older posts (created before the public/private
// toggle existed) have no `visibility` field at all. The app already treats a
// missing field as "public" everywhere, so this just makes that explicit in the
// data itself. Safe to run more than once — it's a no-op once every post has
// the field set. Admin-only; trigger it once from the browser console
// (see the note in the delivery message) rather than exposing it in the UI.
exports.backfillPostVisibility = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db.collection("posts").get();
  const missing = snap.docs.filter((d) => d.data().visibility === undefined);
  const batches = [];
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch();
    missing.slice(i, i + 400).forEach((d) => batch.update(d.ref, { visibility: "public" }));
    batches.push(batch.commit());
  }
  await Promise.all(batches);
  return { updated: missing.length };
});

// One-time maintenance callable: private posts uploaded before storage.rules could check a
// post's visibility (see postIsPrivate in storage.rules) have their media sitting at the old
// flat posts/{ownerId}/{fileName} layout, which has no postId in it for Storage to look up —
// so those files stayed publicly readable by anyone with the URL even though the post itself
// was marked private. This copies each such post's file onto the new posts/{ownerId}/{postId}/
// {fileName} layout (which storage.rules DOES gate by visibility), repoints the post's
// mediaUrl/mediaPath at the new location, and removes the old public copy. Public posts are
// left alone — their media was never meant to be gated, so there's nothing to fix. Safe to run
// more than once: anything already on the new layout (already migrated, or created after the
// fix shipped) is skipped, not touched.
exports.migratePrivatePostMedia = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }

  const snap = await db.collection("posts").where("visibility", "==", "private").get();
  const bucket = admin.storage().bucket();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of snap.docs) {
    const post = docSnap.data();
    const oldPath = post.mediaPath;
    if (!oldPath || typeof oldPath !== "string" || !post.ownerId) {
      continue; // text/link post — no media file to move
    }

    // Old flat layout is exactly posts/{ownerId}/{fileName} — three path segments. The new
    // layout has four (posts/{ownerId}/{postId}/{fileName}), so anything already there
    // (already migrated, or created after the fix shipped) is left alone.
    const parts = oldPath.split("/");
    if (parts.length !== 3 || parts[0] !== "posts" || parts[1] !== post.ownerId) {
      skipped++;
      continue;
    }

    const newPath = `posts/${post.ownerId}/${docSnap.id}/${parts[2]}`;
    try {
      const [oldMetadata] = await bucket.file(oldPath).getMetadata();
      let token = oldMetadata.metadata && oldMetadata.metadata.firebaseStorageDownloadTokens;

      await bucket.file(oldPath).copy(bucket.file(newPath));

      // A Cloud Storage copy carries the source's custom metadata (including the download
      // token) over to the new file, so the existing token should already work at the new
      // path. Only mint a fresh one on the off chance an older upload never had one.
      if (!token) {
        token = crypto.randomUUID();
        await bucket.file(newPath).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
      }
      const mediaUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(newPath)}?alt=media&token=${token}`;

      await docSnap.ref.update({ mediaUrl, mediaPath: newPath });
      await bucket.file(oldPath).delete().catch(() => {});
      migrated++;
    } catch (err) {
      failed++;
    }
  }

  return { migrated, skipped, failed };
});

// ---------- Callable: list every signed-up account (admin dashboard) ----------
// Firebase Authentication is the actual source of truth for email/signup-date/last-login —
// there's no Firestore doc that reliably has all of that (see the note on sendWelcomeEmailTo
// above). This merges Auth's list with each account's users/{uid} doc (for subscriptionStatus)
// so you can see everyone in one place instead of cross-referencing the Firebase console by
// hand. Capped at 1000 accounts for now — fine at today's scale, worth paging if it grows past
// that.
exports.listAllUsers = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const [authList, usersSnap] = await Promise.all([
    admin.auth().listUsers(1000),
    db.collection("users").get(),
  ]);
  const subsByUid = {};
  usersSnap.docs.forEach((d) => {
    subsByUid[d.id] = d.data().subscriptionStatus ?? null;
  });

  const users = authList.users
    .map((u) => ({
      uid: u.uid,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      createdAt: u.metadata.creationTime,
      lastSignInAt: u.metadata.lastSignInTime,
      subscriptionStatus: subsByUid[u.uid] ?? null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { users, total: users.length };
});

// ---------- Callable: suggest people to message, based on shared lesson interests ----------
//
// lessonProgress is private per-user by rule (a client can only ever read its OWN progress
// docs), so there's no way to compute "who else is learning what I'm learning" from the
// client — this has to run server-side with the Admin SDK, which isn't subject to that
// restriction. Falls back to "people you haven't messaged yet" if the caller (or everyone
// else) hasn't completed any lessons yet, so new accounts still see suggestions.
exports.getMessageSuggestions = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  // Reads every lesson, every lessonProgress doc, and up to 200 users on every call — cheap once,
  // expensive if hammered. Cap it well above any real usage pattern (the UI only needs this once
  // per visit to the Messages tab).
  await enforceRateLimit(request.auth.uid, "getMessageSuggestions", { max: 30, windowMs: 60 * 60 * 1000 });
  const uid = request.auth.uid;

  const [lessonsSnap, progressSnap, convosSnap, usersSnap, blockedSet] = await Promise.all([
    db.collection("lessons").get(),
    db.collection("lessonProgress").get(),
    db.collection("conversations").where("participants", "array-contains", uid).get(),
    db.collection("users").limit(200).get(),
    getBlockedSet(uid),
  ]);

  const subjectByLesson = Object.fromEntries(lessonsSnap.docs.map((d) => [d.id, d.data().subjectId]));

  // Build each user's set of subjects they've completed at least one lesson in.
  const subjectsByUser = {};
  for (const doc of progressSnap.docs) {
    const p = doc.data();
    const subjectId = p.subjectId || subjectByLesson[p.lessonId];
    if (!subjectId) continue;
    (subjectsByUser[p.uid] ??= new Set()).add(subjectId);
  }

  const mySubjects = subjectsByUser[uid] || new Set();

  // Don't suggest people the caller is already messaging.
  const alreadyMessaging = new Set();
  for (const doc of convosSnap.docs) {
    for (const p of doc.data().participants || []) {
      if (p !== uid) alreadyMessaging.add(p);
    }
  }

  // Without this, someone who's blocked (in either direction) could still show up in "people
  // you might want to message" — the conversations/messages rules would stop the message
  // itself from ever sending, but their name/photo would still be surfaced here, which defeats
  // the point of blocking someone.
  const candidates = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.id !== uid && !alreadyMessaging.has(u.id) && !blockedSet.has(u.id));

  const withOverlap = candidates.map((u) => {
    const theirSubjects = subjectsByUser[u.id] || new Set();
    const shared = [...mySubjects].filter((s) => theirSubjects.has(s));
    return {
      id: u.id,
      displayName: u.displayName || "Member",
      photoURL: u.photoURL || null,
      sharedSubjects: shared,
    };
  });

  withOverlap.sort((a, b) => b.sharedSubjects.length - a.sharedSubjects.length);

  // If nobody shares an interest yet (cold start — brand new app, nobody's finished a
  // lesson), just suggest a handful of people rather than showing nothing.
  const suggestions = withOverlap.filter((u) => u.sharedSubjects.length > 0).length > 0
    ? withOverlap.filter((u) => u.sharedSubjects.length > 0).slice(0, 8)
    : withOverlap.slice(0, 8);

  return { suggestions };
});

// Escapes a user-controlled string (display name) before it's interpolated into an HTML email
// body — display names come from the profile-creation flow or Stripe Checkout's billing form,
// both editable by the account holder, so a crafted name could otherwise break the email's
// markup or embed a misleading element. Only used in the `html` half of each template below;
// the plain-text `text` half interpolates the raw name, since escaping would show literal
// "&amp;"-style entities to a human reading plain text.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Welcome email: branded HTML template + sender ----------
// Brand colours pulled straight from tailwind.config.ts so this actually matches the rest of
// the site (paper background, ink text, the coral "brand" accent, and the soft brandLight
// pink used behind the header) rather than drifting from it over time. The logo is a hosted
// <img> pointing at the live site rather than a base64/attached image — inline images get
// stripped by a lot of mail clients (Gmail included, in some views), a hosted URL doesn't.
function buildWelcomeEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Welcome to Astryks 🎉";

  const text = `Hi ${name},

Welcome to Astryks — we're really glad you're here.

A few things to get you started:
- Head to the Learn tab and dive into a lesson on whatever you're curious about.
- Post something creative to the feed. Every post is automatically and freely entered into
  that month's AU$1,000 Creative Prize — no subscription needed to enter, just 30+ likes to
  qualify for the win (see astryks.com/prize-rules for the full details).
- Got a question or something feels off? Just reply to this email — a real person reads it.

We're excited to see what you make.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DEF0E3;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Welcome to Astryks</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  We're really glad you're here — welcome to the community.
                </p>
                <p style="margin:0 0 10px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#17130F;">
                  A few things to get you started
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      📚 Head to <strong>Learn</strong> and dive into a lesson on whatever you're curious about.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      🎨 Post something creative — every post is automatically and freely entered into that
                      month's <strong>AU$1,000 Creative Prize</strong> (30+ likes to qualify, no subscription
                      needed to enter).
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      💬 Questions, or something feels off? Just reply to this email — a real person reads it.
                    </td>
                  </tr>
                </table>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/home" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Open Astryks
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- Creative Prize winner: branded congratulations email + in-app message ----------
// Deliberately NEVER called automatically — see approvePrizeWinnerAnnouncement below. The
// monthly job (sendMonthlyPrizeReport) only ever records a *candidate* winner and emails you
// for review; nothing reaches the actual winner until you explicitly approve it from
// astryks.com/admin/prizes. That's the "seeking your approval first" gate you asked for.
function buildWinnerCongratsEmail(displayName, monthLabel, postId) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = `🎉 You won this month's Astryks Creative Prize!`;
  const postUrl = `https://astryks.com/post/${postId}`;

  const text = `Hi ${name},

I'm genuinely delighted to tell you — your post won ${monthLabel}'s Astryks Creative Prize! That's AU$${PRIZE_AUD}, and it's all yours.

Out of everything posted this month, yours is the one the community rallied around and lifted up the most. That takes real work, and it shows — thank you for sharing it with all of us.

Here's what happens next: we'll be in touch shortly via Messages to sort out sending your AU$${PRIZE_AUD} (if you've already shared your payout details, we've got them — if not, just reply there and let us know bank transfer or PayID).

Take a moment to enjoy this one — you earned it.

Your winning post: ${postUrl}

Warmly,
Astryks`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#F7DEDB;padding:40px 32px 30px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 16px;border-radius:14px;" />
                <p style="margin:0 0 6px;font-size:34px;line-height:1;">🎉</p>
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.35;color:#17130F;font-weight:600;">
                  You won ${monthLabel}'s<br />Creative Prize
                </p>
                <p style="margin:10px 0 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;color:#E85D5D;">
                  AU$${PRIZE_AUD}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  I'm genuinely delighted to tell you — your post won ${monthLabel}'s Astryks Creative Prize.
                  Out of everything posted this month, yours is the one the community rallied around and lifted
                  up the most. That takes real work, and it shows — thank you for sharing it with all of us.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Here's what happens next: we'll be in touch shortly over Messages to sort out sending your
                  AU$${PRIZE_AUD}. If you've already shared your payout details, we've got them — if not, just
                  reply there with bank transfer or PayID details whenever suits.
                </p>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Take a moment to enjoy this one — you earned it.
                </p>
                <div style="text-align:center;margin:24px 0 8px;">
                  <a href="${postUrl}" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    View your winning post
                  </a>
                </div>
                <div style="text-align:center;margin:14px 0 8px;">
                  <a href="https://astryks.com/prizes" style="color:#17130F;opacity:0.6;text-decoration:underline;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;">
                    See this month's leaderboard
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />Astryks
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendWelcomeEmailTo(email, displayName) {
  const { subject, text, html } = buildWelcomeEmail(displayName);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SUPPORT_EMAIL_USER.value(), pass: SUPPORT_EMAIL_PASS.value() },
  });
  await transporter.sendMail({
    from: `Astryks <${SUPPORT_EMAIL_USER.value()}>`,
    to: email,
    subject,
    text,
    html,
  });
}

// ---------- Trigger: welcome email on signup ----------
// Fires off the `profiles/{uid}` doc rather than an auth-onCreate trigger, because both signup
// paths (email/password AND Google) already write this doc via createProfile() in
// app/signup/page.tsx — so this fires exactly once per real signup, whichever way someone joined,
// with no separate auth trigger to maintain. The email address itself isn't duplicated into
// Firestore anywhere — it's looked up straight from Firebase Auth (the single source of truth
// for it), via the Admin SDK, which bypasses firestore.rules entirely.
// Reuses the same Gmail SMTP credentials as the support-report email (SUPPORT_EMAIL_USER/PASS) —
// no new secret needed. Swap the `from`/transport to a support@astryks.com address once Zoho
// Mail is set up, if you'd rather send from that instead of the Gmail account.
exports.onProfileCreated = onDocumentCreated(
  { document: "profiles/{userId}", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (event) => {
    const userId = event.params.userId;
    const displayName = event.data?.data()?.displayName || "there";

    let email;
    try {
      const userRecord = await admin.auth().getUser(userId);
      email = userRecord.email;
    } catch (err) {
      console.error("onProfileCreated: couldn't look up auth user", userId, err);
      return;
    }
    if (!email) return;

    try {
      await sendWelcomeEmailTo(email, displayName);
    } catch (err) {
      console.error("onProfileCreated: failed to send welcome email to", email, err);
    }
  }
);

// ---------- Callable: send yourself a test copy of the welcome email ----------
// Admin-only. Lets you see exactly what a new member receives — including how it actually
// renders in a real inbox — without creating a throwaway signup. Always sends to your own
// admin email, never to an address you pass in.
exports.sendTestWelcomeEmail = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    const displayName = request.auth.token.name || "there";
    await sendWelcomeEmailTo(request.auth.token.email, displayName);
    return { sentTo: request.auth.token.email };
  }
);

// ---------- Callable: sign-out confirmation ----------
// Called from the client right before signOut() actually runs (see the "Log out" button on
// web/mobile), while the caller's auth token is still valid — after signOut() there'd be nothing
// left to authenticate this call with. Deliberately NOT called from the account-deletion flow's
// own signOut() — that gets buildAccountDeletedEmail instead, from deleteAccountInternal.
exports.notifySignOut = onCall({ secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const email = request.auth.token.email;
  if (!email) return { ok: false };
  try {
    await sendBrandedEmail(email, buildSignOutEmail(request.auth.token.name));
  } catch (err) {
    console.error(`notifySignOut: failed to send to ${email}`, err);
  }
  return { ok: true };
});

// ---------- Callables: mobile Privacy Lock "forgot PIN" reset ----------
//
// The PIN itself lives only on-device (SecureStore — see astryks-mobile/lib/privacyLock.ts), so
// there's nothing server-side to reset directly. What these two callables do instead is prove
// the caller can read the account's own registered email (the same trust boundary the account
// login itself relies on) before letting the client clear its local PIN and set a new one — the
// reset code is single-use, hashed at rest, and expires quickly, the same shape as a password
// reset even though no password is actually involved. Only the hash lives in Firestore, gated
// off from client writes by firestore.rules the same way subscriptionStatus etc. already are.
exports.requestPrivacyLockReset = onCall({ secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const email = request.auth.token.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "Your account doesn't have an email on file.");
  }
  await enforceRateLimit(request.auth.uid, "requestPrivacyLockReset", { max: 5, windowMs: 15 * 60 * 1000 });

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  await db.doc(`users/${request.auth.uid}`).set(
    {
      privacyLockResetCodeHash: codeHash,
      privacyLockResetCodeExpiresAt: Date.now() + 10 * 60 * 1000,
    },
    { merge: true }
  );

  try {
    await sendBrandedEmail(email, buildPrivacyLockResetEmail(request.auth.token.name, code));
  } catch (err) {
    console.error(`requestPrivacyLockReset: failed to send to ${email}`, err);
    throw new HttpsError("internal", "Couldn't send the reset code — please try again.");
  }
  return { ok: true, email };
});

exports.verifyPrivacyLockReset = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const code = (request.data?.code || "").trim();
  if (!code) {
    throw new HttpsError("invalid-argument", "A code is required.");
  }
  // Capped low and separate from the request-side limit above — this is the actual guard
  // against brute-forcing a 6-digit code (1 in a million per guess), on top of the code itself
  // expiring in 10 minutes and being invalidated after one use either way.
  await enforceRateLimit(request.auth.uid, "verifyPrivacyLockReset", { max: 8, windowMs: 15 * 60 * 1000 });

  const userRef = db.doc(`users/${request.auth.uid}`);
  const userSnap = await userRef.get();
  const data = userSnap.data() || {};
  const validCode =
    data.privacyLockResetCodeHash &&
    data.privacyLockResetCodeExpiresAt &&
    data.privacyLockResetCodeExpiresAt > Date.now() &&
    data.privacyLockResetCodeHash === crypto.createHash("sha256").update(code).digest("hex");

  if (!validCode) {
    return { valid: false };
  }
  // Single-use: clear it immediately so the same code can't be replayed.
  await userRef.update({
    privacyLockResetCodeHash: admin.firestore.FieldValue.delete(),
    privacyLockResetCodeExpiresAt: admin.firestore.FieldValue.delete(),
  });
  return { valid: true };
});

// Callable: flips a plain boolean on/off, called whenever a client sets up or disables Privacy
// Lock. The PIN itself never touches Firestore (device-local on mobile, browser-local on web —
// see lib/privacyLock.ts in each app), but getLessonPlayback above needs SOME server-visible
// signal to close the free-preview loophole for a non-subscriber while Privacy Lock is on, and
// firestore.rules' users/{userId} allowlist deliberately doesn't let a client write this (or any
// other) field directly — this callable is the one sanctioned way in.
exports.setPrivacyLockStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const enabled = !!request.data?.enabled;
  await db.doc(`users/${request.auth.uid}`).set({ privacyLockEnabled: enabled }, { merge: true });
  return { ok: true };
});

// ---------- Subscription lifecycle emails: subscribed / canceled / refunded ----------
// Same visual template as the welcome email above (kept inline rather than factored into a
// shared helper, matching how buildWinnerCongratsEmail was done, so each stays easy to tweak
// independently without worrying about breaking a shared template). All three are sent
// automatically — see the trigger comments on each sendX function for exactly what fires them.

function buildSubscriptionConfirmationEmail(displayName, priceDisplay) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "You're subscribed — welcome to full access 🎉";

  const text = `Hi ${name},

Thanks for subscribing to Astryks! You now have full access to every lesson in the library, billed at ${priceDisplay}.

A few things worth knowing:
- Cancel any time from astryks.com/me — no phone calls, no retention pitch, just a button.
- You're covered by our 90-day money-back guarantee: if it's not for you, request a full refund within 90 days of subscribing, no questions asked.
- New lessons get added regularly, all included in your subscription.

If anything's unclear or not working right, just reply to this email — a real person reads it.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DCE6F2;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">You're subscribed</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Thanks for subscribing! You now have full access to every lesson in the library, billed at
                  <strong>${priceDisplay}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      🔓 Cancel any time from <strong>astryks.com/me</strong> — no phone calls, no retention pitch.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      💛 You're covered by our <strong>90-day money-back guarantee</strong> — a full refund, no
                      questions asked, any time within 90 days of subscribing.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      📚 New lessons get added regularly, all included.
                    </td>
                  </tr>
                </table>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/learn" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Start learning
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildCancellationEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Your Astryks subscription has been canceled";

  const text = `Hi ${name},

Confirming your Astryks subscription has been canceled — you won't be charged again, and you'll keep lesson access until the end of your current billing period.

Your account itself isn't going anywhere: you can still post, browse, and enter the monthly Creative Prize for free, any time.

If this was a mistake, or something about the lessons wasn't working for you, just reply to this email and let us know — we read every reply.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#E4DEF3;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Subscription canceled</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Confirming your Astryks subscription has been canceled — you won't be charged again, and you'll
                  keep lesson access until the end of your current billing period.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Your account itself isn't going anywhere: you can still post, browse, and enter the monthly
                  Creative Prize for free, any time.
                </p>
                <div style="text-align:center;margin:8px 0 16px;">
                  <a href="https://astryks.com/me" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Reactivate my subscription
                  </a>
                </div>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#17130F;opacity:0.75;">
                  If this was a mistake, or something wasn't working for you, just reply to this email — we read
                  every reply.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildRefundConfirmationEmail(displayName, amountDisplay) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = `Your ${amountDisplay} refund has been issued`;

  const text = `Hi ${name},

Your refund of ${amountDisplay} has been approved and sent back to your original payment method — it usually takes 5-10 business days to land, depending on your bank. Your subscription has also been canceled, so you won't be charged again.

You're always welcome to keep posting and browsing for free, and if you'd like the expert-led classes again down the line, you can resubscribe any time.

Thanks for giving Astryks a try.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DEF0E3;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Refund issued</p>
                <p style="margin:10px 0 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;color:#E85D5D;">
                  ${amountDisplay}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Your refund of <strong>${amountDisplay}</strong> has been approved and sent back to your original
                  payment method — it usually takes 5-10 business days to land, depending on your bank. Your
                  subscription has also been canceled, so you won't be charged again.
                </p>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  You're always welcome to keep posting and browsing for free, and if you'd like the expert-led
                  classes again down the line, you can resubscribe any time. Thanks for giving Astryks a try.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- Creative Prize nomination: fires the moment a post first clears the like bar ----------
// Not the same as being "entered" (every photo/video post is entered for free the moment it's
// posted, see nominateForPrize) — this is the "you've actually cleared the bar and are in the
// running to win" moment, which only happens once a post reaches PRIZE_LIKE_THRESHOLD likes.
// Triggered once per post from onLikeCreated below — guarded by prizeNominationEmailSent so
// unliking/reliking around the threshold can't re-send it.
function buildPrizeNominationEmail(displayName, postId, likeCount) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = `🏆 Your post just cleared ${PRIZE_LIKE_THRESHOLD} likes — you're in the running!`;
  const postUrl = `https://astryks.com/post/${postId}`;
  const leaderboardUrl = "https://astryks.com/prizes";

  const text = `Hi ${name},

Your post just crossed ${PRIZE_LIKE_THRESHOLD} likes — that means it's officially in the running for this month's AU$${PRIZE_AUD} Astryks Creative Prize.

Nothing to do on your end. The post with the most likes when the month ends wins, and yours is now a real contender. Keep sharing it, or just see where it stands.

Your post: ${postUrl}
This month's leaderboard: ${leaderboardUrl}

Good luck,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#F7DEDB;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0 0 6px;font-size:30px;line-height:1;">🏆</p>
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">
                  You're in the running
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Your post just crossed <strong>${likeCount} likes</strong> — clearing the ${PRIZE_LIKE_THRESHOLD}-like bar
                  means it's now officially in the running for this month's <strong>AU$${PRIZE_AUD} Astryks Creative Prize</strong>.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Nothing to do on your end — the post with the most likes when the month ends wins, and yours is a
                  real contender now. Keep sharing it, or just see where it stands.
                </p>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="${postUrl}" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    View your post
                  </a>
                </div>
                <div style="text-align:center;margin:14px 0 8px;">
                  <a href="${leaderboardUrl}" style="color:#17130F;opacity:0.6;text-decoration:underline;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;">
                    See this month's leaderboard
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Good luck,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- Sign-out confirmation: fires only from an explicit "Log out" tap ----------
// Deliberately NOT wired to every place the client calls signOut() — e.g. right before account
// deletion also calls signOut(), but that gets its own dedicated deletion email instead, so
// sending this one too would be redundant. See notifySignOut below for the one call site.
function buildSignOutEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "You've been signed out of Astryks";

  const text = `Hi ${name},

Just confirming you've been signed out of Astryks.

If that wasn't you, someone else may have access to your account — reply to this email and we'll help you secure it.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DCE6F2;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Signed out</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Just confirming you've been signed out of Astryks.
                </p>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#17130F;opacity:0.75;">
                  If that wasn't you, someone else may have access to your account — reply to this email and we'll
                  help you secure it.
                </p>
                <div style="text-align:center;margin:20px 0 8px;">
                  <a href="https://astryks.com/login" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Sign back in
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- Mobile Privacy Lock: forgot-PIN reset code ----------
function buildPrivacyLockResetEmail(displayName, code) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = `${code} is your Astryks Privacy Lock code`;

  const text = `Hi ${name},

Here's your Privacy Lock reset code: ${code}

Enter this in the app to reset the PIN that locks your Home and Messages tabs. This code expires in 10 minutes.

If you didn't request this, you can ignore this email — your PIN hasn't changed.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DCE6F2;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Privacy Lock reset code</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName}, enter this code in the app to reset the PIN that locks your Home and Messages tabs:
                </p>
                <div style="text-align:center;margin:0 0 20px;">
                  <span style="display:inline-block;background-color:#F7F1E5;border-radius:14px;padding:16px 28px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:32px;font-weight:700;letter-spacing:8px;color:#17130F;">${code}</span>
                </div>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#17130F;opacity:0.75;">
                  This code expires in 10 minutes. If you didn't request this, you can ignore this email — your PIN hasn't changed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- Account deletion confirmation ----------
// Sent from deleteAccountInternal, which is shared by both deleteUserAccount (admin-initiated)
// and deleteMyAccount (self-service) — the email address is captured at the very start of that
// function, before anything is actually deleted, since there's no account left to look it up
// from afterwards.
function buildAccountDeletedEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Your Astryks account has been deleted";

  const text = `Hi ${name},

Confirming your Astryks account and everything in it — posts, messages, lesson progress, subscription — has been permanently deleted.

If you had an active subscription, it's been canceled and you won't be charged again.

We're sorry to see you go. If you ever want to come back, you're welcome to create a new account any time.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#E8E6E1;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Account deleted</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Confirming your Astryks account and everything in it — posts, messages, lesson progress,
                  subscription — has been permanently deleted.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  If you had an active subscription, it's been canceled and you won't be charged again.
                </p>
                <p style="margin:0 0 4px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#17130F;opacity:0.75;">
                  We're sorry to see you go. If you ever want to come back, you're welcome to create a new account
                  any time.
                </p>
                <div style="text-align:center;margin:20px 0 8px;">
                  <a href="https://astryks.com/signup" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Come back any time
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

// ---------- "Don't go cold" lifecycle emails: onboarding drip, re-engagement, win-back ----------
// Same visual pattern as the templates above. Each fires from a scheduled function further down
// rather than a webhook/callable, since these are all about *time passing without something
// happening* (no lesson started, no activity, no resubscribe) rather than a discrete event.

function buildTryLessonEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Haven't picked a lesson yet? Here's where to start";

  const text = `Hi ${name},

You signed up a couple of days ago — welcome again! We noticed you haven't started a lesson yet, so
here's a nudge in case you weren't sure where to begin.

Astryks has masterclasses across Music and Art, taught by people who actually do this for a living.
You get 10 minutes of free preview across any real lessons — no card required — so there's no
pressure, just pick whatever looks interesting and see how it feels.

Head to astryks.com/learn whenever you've got a few minutes.

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#F7DEDB;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Where should you start?</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  You signed up a couple of days ago — welcome again! We noticed you haven't started a
                  lesson yet, so here's a nudge in case you weren't sure where to begin.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Astryks has masterclasses across Music and Art, taught by people who actually do this
                  for a living. You get <strong>10 minutes of free preview</strong> across any real lessons —
                  no card required — so there's no pressure, just pick whatever looks interesting.
                </p>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/learn" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Browse lessons
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildSubscribeNudgeEmail(displayName, priceDisplay) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Still deciding? Here's exactly what you get";

  const text = `Hi ${name},

You've been exploring Astryks for a few days now, so we thought it's worth spelling out exactly
what subscribing gets you, in case anything was unclear:

- Every lesson in the library, across every subject, for ${priceDisplay}.
- Not sure yet? You get 10 minutes of free preview across any real lessons — no card required —
  so you can get an actual feel for it before deciding.
- A 90-day money-back guarantee once you do subscribe — a full refund, no questions asked, if
  it's not for you.
- Cancelling later takes one click from astryks.com/me, any time, no calls or forms.

No pressure either way — posting, browsing, and the monthly Creative Prize all stay free forever,
subscription or not. But if you've been on the fence, this is about as risk-free as it gets.

astryks.com/learn

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#E4DEF3;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Here's exactly what you get</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  You've been exploring Astryks for a few days now, so here's exactly what subscribing
                  gets you, in case anything was unclear.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      📚 Every lesson in the library, across every subject, for <strong>${priceDisplay}</strong>.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      🎁 <strong>10 minutes of free preview</strong> across any real lessons — no card required.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #F0EAE0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      💛 Once you subscribe, a <strong>90-day money-back guarantee</strong> — no questions asked.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#17130F;">
                      🔓 Cancel any time from <strong>astryks.com/me</strong> — one click, no calls.
                    </td>
                  </tr>
                </table>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/learn" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Get free preview
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildWeMissYouEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "We miss you at Astryks";

  const text = `Hi ${name},

It's been a couple of weeks since we've seen you around — no big deal, life gets busy. Just wanted
to let you know new lessons have gone up since you last visited, and the monthly Creative Prize
(AU$1,000, completely free to enter) is still running.

If you left off partway through a lesson or a streak, it's all still there waiting whenever you're
ready to pick it back up.

astryks.com

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DCE6F2;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">We miss you</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  It's been a couple of weeks since we've seen you around — no big deal, life gets busy.
                  Just wanted to let you know new lessons have gone up since you last visited, and the
                  monthly <strong>Creative Prize</strong> (AU$1,000, free to enter) is still running.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  If you left off partway through a lesson or a streak, it's all still there waiting
                  whenever you're ready to pick it back up.
                </p>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/home" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    Jump back in
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildWinBackEmail(displayName) {
  const name = displayName || "there";
  const safeName = escapeHtml(name);
  const subject = "Come back any time — here's what's new";

  const text = `Hi ${name},

It's been a few weeks since your Astryks subscription ended, and we genuinely hope it was useful
while it lasted. New lessons have gone up since then, and if you resubscribe, the same 90-day
money-back guarantee applies — so there's no risk in giving it another look.

Your account, posts, and Creative Prize entries are all exactly as you left them, whether or not
you come back.

astryks.com/learn

Warmly,
The Astryks team`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F1E5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F1E5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;border-top:4px solid #EFC13B;">
            <tr>
              <td style="background-color:#DEF0E3;padding:36px 32px 28px;text-align:center;">
                <img src="https://astryks.com/logo-mark.png" width="56" height="56" alt="Astryks" style="display:block;margin:0 auto 14px;border-radius:14px;" />
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#17130F;font-weight:600;">Come back any time</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 4px;">
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  It's been a few weeks since your Astryks subscription ended, and we genuinely hope it
                  was useful while it lasted. New lessons have gone up since then.
                </p>
                <p style="margin:0 0 20px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17130F;">
                  If you resubscribe, the same <strong>90-day money-back guarantee</strong> applies — so there's
                  no risk in giving it another look. Your account, posts, and Creative Prize entries are all
                  exactly as you left them either way.
                </p>
                <div style="text-align:center;margin:4px 0 8px;">
                  <a href="https://astryks.com/learn" style="display:inline-block;background-color:#E85D5D;color:#FFFFFF;text-decoration:none;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:13px 30px;border-radius:999px;">
                    See what's new
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;text-align:center;">
                <p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#17130F;opacity:0.55;">
                  Warmly,<br />The Astryks team
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#17130F;opacity:0.4;">
            Astryks · astryks.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendBrandedEmail(email, { subject, text, html }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SUPPORT_EMAIL_USER.value(), pass: SUPPORT_EMAIL_PASS.value() },
  });
  await transporter.sendMail({ from: `Astryks <${SUPPORT_EMAIL_USER.value()}>`, to: email, subject, text, html });
}

// ---------- Callables: send yourself a test copy of each lifecycle email ----------
// Same admin-only preview pattern as sendTestWelcomeEmail above.

exports.sendTestSubscriptionEmail = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    await sendBrandedEmail(
      request.auth.token.email,
      buildSubscriptionConfirmationEmail(request.auth.token.name || "there", "$4.99/week")
    );
    return { sentTo: request.auth.token.email };
  }
);

exports.sendTestCancellationEmail = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    await sendBrandedEmail(request.auth.token.email, buildCancellationEmail(request.auth.token.name || "there"));
    return { sentTo: request.auth.token.email };
  }
);

exports.sendTestRefundEmail = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    await sendBrandedEmail(
      request.auth.token.email,
      buildRefundConfirmationEmail(request.auth.token.name || "there", "AU$45.00")
    );
    return { sentTo: request.auth.token.email };
  }
);

// Sends all four "don't go cold" nudges (try-a-lesson, subscribe-nudge, we-miss-you, win-back)
// to your own inbox in one go — these don't have individual triggers you can fire on demand
// the way a webhook event does, so this is how you preview them before trusting the scheduled
// functions below to send them to real members.
exports.sendTestLifecycleNudgeEmails = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    const name = request.auth.token.name || "there";
    const email = request.auth.token.email;
    await sendBrandedEmail(email, buildTryLessonEmail(name));
    await sendBrandedEmail(email, buildSubscribeNudgeEmail(name, "$4.99/week"));
    await sendBrandedEmail(email, buildWeMissYouEmail(name));
    await sendBrandedEmail(email, buildWinBackEmail(name));
    return { sentTo: email, count: 4 };
  }
);

// Previews the three newer lifecycle emails to your own inbox — nomination and account-deletion
// don't have a safe way to trigger for real on demand (nomination needs a real post to actually
// cross the like threshold; deletion would mean actually deleting your own account), and
// sign-out is already trivially testable by just logging out for real, so it's not included here.
exports.sendTestNewLifecycleEmails = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    const name = request.auth.token.name || "there";
    const email = request.auth.token.email;
    await sendBrandedEmail(email, buildPrizeNominationEmail(name, "preview-post-id", PRIZE_LIKE_THRESHOLD));
    await sendBrandedEmail(email, buildAccountDeletedEmail(name));
    return { sentTo: email, count: 2 };
  }
);

// The onPostCreated trigger that used to live here only ever did one thing — call
// nominateForPrize to enter a new photo/video post into that month's cash prize. Now that the
// prize is retired (see the "RETIRED" banner above optOutOfPrize), that trigger body would be
// entirely empty, so the export itself is removed rather than deploying a Cloud Function that
// fires on every single post and does nothing. nominateForPrize's own definition is untouched
// above, in case this is ever revisited.

// ---------- Trigger: automated moderation scan on every new photo/video post ----------
// Runs Google Cloud Vision SafeSearch (photos) and Cloud Video Intelligence's explicit-content
// detection (videos) against every new upload, in the same GCP project Astryks already runs
// on (Blaze plan) — no new vendor account needed, just enabling the two APIs in Cloud Console
// (see astryks-app/SECURITY.md). This is a real automated backstop, but NOT a complete one —
// be clear-eyed about what it does and doesn't cover:
//   - It catches obviously adult/violent/graphic imagery before a human ever reports it.
//   - It is NOT CSAM (child sexual abuse material) hash-matching. SafeSearch/explicit-content
//     detection is a general nudity/violence classifier, not a substitute for a dedicated CSAM
//     detection service (e.g. Thorn's Safer, or Google's invite-only CSAI Match) — given this
//     platform accepts uploads from any account, applying to one of those is worth prioritizing
//     as a follow-up, not a someday-maybe.
//   - Fails OPEN on any API error (leaves the post visible) so a transient Vision/Video
//     Intelligence outage never takes the whole feed down — the human report flow
//     (submitReport/resolveReport) is always the backstop of last resort regardless.
// Flagged posts are hidden from everyone but their owner/admins (isVisibleTo, getUserPosts,
// and the posts/{postId} rule in firestore.rules all check moderationStatus) rather than
// deleted outright, so a false positive doesn't destroy someone's post with zero recourse —
// an admin reviews and deletes for real, or clears the flag, from /admin/reports.
const MODERATION_LIKELIHOODS_TO_FLAG = ["LIKELY", "VERY_LIKELY"];

async function flagPostForModeration(postId, post, flaggedFor) {
  await db.doc(`posts/${postId}`).set(
    {
      moderationStatus: "flagged",
      moderationFlags: flaggedFor,
      moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await notifyAdmin(
    `🚩 Auto-flagged post pending review (${flaggedFor.join(", ")})`,
    `A new ${post.type} post from ${post.ownerName || "a member"} (owner uid: ${post.ownerId}) was ` +
      `automatically flagged for: ${flaggedFor.join(", ")}. It's already hidden from everyone except the ` +
      `owner and admins — nothing further to do urgently, but please review and either delete it for real ` +
      `or clear moderationStatus (false positive) here: https://astryks.com/admin/reports (post id: ${postId}).`
  );
}

exports.moderatePostMedia = onDocumentCreated(
  { document: "posts/{postId}", timeoutSeconds: 540, memory: "512MiB" },
  async (event) => {
    const postId = event.params.postId;
    const post = event.data?.data();
    if (!post || !post.mediaPath || !["photo", "video"].includes(post.type)) return;

    const bucket = admin.storage().bucket().name;
    const gcsUri = `gs://${bucket}/${post.mediaPath}`;

    try {
      if (post.type === "photo") {
        const vision = require("@google-cloud/vision");
        const client = new vision.ImageAnnotatorClient();
        const [result] = await client.safeSearchDetection(gcsUri);
        const annotation = result.safeSearchAnnotation || {};
        const flaggedFor = ["adult", "violence", "racy"].filter((k) =>
          MODERATION_LIKELIHOODS_TO_FLAG.includes(annotation[k])
        );
        if (flaggedFor.length > 0) await flagPostForModeration(postId, post, flaggedFor);
      } else {
        const videoIntel = require("@google-cloud/video-intelligence").v1;
        const client = new videoIntel.VideoIntelligenceServiceClient();
        const [operation] = await client.annotateVideo({
          inputUri: gcsUri,
          features: ["EXPLICIT_CONTENT_DETECTION"],
        });
        const [result] = await operation.promise();
        const frames = result.annotationResults?.[0]?.explicitAnnotation?.frames || [];
        const flagged = frames.some((f) => MODERATION_LIKELIHOODS_TO_FLAG.includes(f.pornographyLikelihood));
        if (flagged) await flagPostForModeration(postId, post, ["explicit content"]);
      }
    } catch (err) {
      // Fail open on purpose — see the block comment above this trigger.
      console.error("moderatePostMedia: scan failed, leaving post visible", postId, err);
    }
  }
);

// ---------- Triggers: keep posts/{postId}.likeCount in sync (Admin SDK, bypasses rules) ----------
//
// This is the ONLY place likeCount is ever changed server-side. It used to also be writable
// directly by the client (a Firestore rule carve-out let anyone set a post's likeCount to
// whatever they wanted), which meant the real-money Creative Prize leaderboard could be
// trivially forged. That carve-out has been removed from firestore.rules — likeCount is now
// derived purely from the actual number of documents in the likes subcollection.
//
// Recomputed via a count() aggregation rather than a blind FieldValue.increment(±1): Cloud
// Functions triggers are "at least once" delivery, so on the rare retry/double-fire, an
// increment would double-count the same like/unlike forever with no way to detect the drift.
// A count() read always reflects the true number of like docs regardless of how many times
// this trigger happens to run for the same event, so it self-corrects instead of drifting —
// worth the extra read for a number that feeds directly into a real cash payout.
exports.onLikeCreated = onDocumentCreated(
  { document: "posts/{postId}/likes/{userId}", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async (event) => {
    const { postId, userId } = event.params;
    const postRef = db.doc(`posts/${postId}`);
    const postSnap = await postRef.get();
    if (!postSnap.exists) return;

    const post = postSnap.data();
    const countSnap = await postRef.collection("likes").count().get();
    const newLikeCount = countSnap.data().count;
    await postRef.update({ likeCount: newLikeCount });

    // Prize nomination email — the "you've cleared the bar and are actually in the running"
    // moment, separate from mere entry (every photo/video post is entered for free on creation).
    // Guarded by prizeNominationEmailSent so this can only ever fire once per post, no matter how
    // many times its like count crosses back and forth over the threshold from unlikes/relikes.
    if (
      ["photo", "video"].includes(post.type) &&
      post.prizeEligible &&
      !post.prizeOptOut &&
      !post.prizeNominationEmailSent &&
      newLikeCount >= PRIZE_LIKE_THRESHOLD
    ) {
      try {
        const ownerAuth = await admin.auth().getUser(post.ownerId);
        if (ownerAuth.email) {
          await postRef.set({ prizeNominationEmailSent: true }, { merge: true });
          await sendBrandedEmail(
            ownerAuth.email,
            buildPrizeNominationEmail(post.ownerName || ownerAuth.displayName, postId, newLikeCount)
          );
        }
      } catch (err) {
        console.error(`onLikeCreated: failed to send prize nomination email for post ${postId}`, err);
      }
    }

    if (post.ownerId === userId) return;

    const likerSnap = await db.doc(`users/${userId}`).get();
    const likerName = likerSnap.data()?.displayName || "Someone";

    await sendPush(post.ownerId, "New like", `${likerName} liked "${post.title || "your post"}"`);
  }
);

exports.onLikeDeleted = onDocumentDeleted("posts/{postId}/likes/{userId}", async (event) => {
  const { postId } = event.params;
  try {
    const postRef = db.doc(`posts/${postId}`);
    const countSnap = await postRef.collection("likes").count().get();
    await postRef.update({ likeCount: countSnap.data().count });
  } catch {
    // Post itself may have already been deleted (e.g. as part of account deletion) — nothing
    // to decrement in that case.
  }
});

// ---------- Trigger: push notification when someone comments on your post, + commentCount ----------
// Same reasoning as likeCount above — commentCount is derived from the comments subcollection,
// not writable directly by the client anymore.

exports.onCommentCreated = onDocumentCreated("posts/{postId}/comments/{commentId}", async (event) => {
  const { postId } = event.params;
  const comment = event.data.data();
  const postRef = db.doc(`posts/${postId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) return;

  const post = postSnap.data();
  await postRef.update({ commentCount: admin.firestore.FieldValue.increment(1) });

  if (post.ownerId === comment.userId) return;

  await sendPush(
    post.ownerId,
    "New comment",
    `${comment.userName || "Someone"}: ${comment.body}`.slice(0, 120)
  );
});

exports.onCommentDeleted = onDocumentDeleted("posts/{postId}/comments/{commentId}", async (event) => {
  const { postId } = event.params;
  try {
    await db.doc(`posts/${postId}`).update({ commentCount: admin.firestore.FieldValue.increment(-1) });
  } catch {
    // Post itself may have already been deleted — nothing to decrement in that case.
  }
});

// ---------- Trigger: push notification for new direct messages ----------

exports.onMessageCreated = onDocumentCreated(
  {
    document: "conversations/{conversationId}/messages/{messageId}",
    secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO],
  },
  async (event) => {
    const { conversationId } = event.params;
    const message = event.data.data();

    const convoSnap = await db.doc(`conversations/${conversationId}`).get();
    if (!convoSnap.exists) return;

    const participants = convoSnap.data().participants || [];
    const recipient = participants.find((uid) => uid !== message.senderId);
    if (!recipient) return;

    if (recipient === SUPPORT_UID) {
      // Message sent to the "Astryks Support" conversation — email it directly
      // instead of trying (and failing) to push-notify a non-real account.
      let senderEmail = "unknown";
      try {
        const senderAuth = await admin.auth().getUser(message.senderId);
        senderEmail = senderAuth.email || "unknown";
      } catch {
        // Fall back to "unknown" if the auth record can't be read for some reason.
      }
      await sendSupportEmail(
        `Astryks support message from ${message.senderName || "a member"}`,
        `From: ${message.senderName || "Member"} (uid: ${message.senderId}, email: ${senderEmail})\n\n${message.text}\n\nReply directly to the user's email above, or from the Firebase console.`
      );
      return;
    }

    await sendPush(recipient, message.senderName || "New message", message.text.slice(0, 120));
  }
);

const Stripe = require("stripe");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePriceId = defineSecret("STRIPE_PRICE_ID");
// A second, separate recurring Price on the SAME Stripe Product as STRIPE_PRICE_ID, just with
// `interval: year` instead of `interval: week` — create it once in the Stripe dashboard
// (Product catalog -> your product -> "Add another price"), copy its price ID, then run
// `firebase functions:secrets:set STRIPE_ANNUAL_PRICE_ID`. Give it the same per-currency amounts
// as the weekly price (Product -> Price -> "Add another currency"), just annualized — e.g. if
// weekly is configured as amount*1 per currency, price the annual one at roughly amount*50 (a
// "2 weeks free" framing) so it actually undercuts paying weekly all year. Until this secret is
// set, requests with plan: "annual" fail clearly rather than silently charging the weekly price.
const stripeAnnualPriceId = defineSecret("STRIPE_ANNUAL_PRICE_ID");

// Shared secret you set in the Qonversion dashboard (Project Settings > Integrations >
// Webhooks > "Header Authorization-Token Value") so we can confirm a webhook call really came
// from Qonversion and not just anyone who found this URL. Qonversion sends this back verbatim
// in an `Authorization: Basic <token>` header — note it's NOT base64-encoded the way real HTTP
// Basic auth normally is, it's just their chosen header format for a plain shared secret.
const qonversionWebhookAuth = defineSecret("QONVERSION_WEBHOOK_AUTH");

// Only ever send Stripe redirects back to Astryks's own domain — without this, a caller could
// pass any successUrl/cancelUrl/returnUrl they like and turn our own Checkout/Billing Portal
// session into an open redirect to an attacker-controlled site (phishing, credential capture,
// etc.), all under a legitimate-looking astryks.com/checkout link on the way in.
const ALLOWED_REDIRECT_HOSTS = new Set(["astryks.com", "www.astryks.com"]);
function safeRedirectUrl(url, fallbackPath) {
  const fallback = `https://astryks.com${fallbackPath}`;
  if (typeof url !== "string" || !url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && ALLOWED_REDIRECT_HOSTS.has(parsed.hostname)) {
      return url;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---------- Callable: get or create this user's referral code ----------

exports.getOrCreateReferralCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  const uid = request.auth.uid;

  const userSnap = await db.doc(`users/${uid}`).get();
  const existing = userSnap.data()?.referralCode;
  if (existing) return { code: existing };

  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = randomCode();
    const taken = await db.doc(`referralCodes/${code}`).get();
    if (!taken.exists) break;
  }

  await db.doc(`referralCodes/${code}`).set({ uid });
  await db.doc(`users/${uid}`).set({ referralCode: code }, { merge: true });
  return { code };
});

// ---------- Callable: check a referral code is real before applying it ----------

exports.validateReferralCode = onCall(async (request) => {
  // Callable without being signed in (referral codes get checked during signup, before an
  // account exists) — so there's no uid to key a rate limit on. Fall back to the caller's IP,
  // which is enough to stop one machine from brute-forcing the referral-code space; it can't stop
  // the same abuse spread across many IPs, but that's a much higher bar for anyone bothering.
  const limitKey = request.auth?.uid || request.rawRequest?.ip || "anon";
  await enforceRateLimit(limitKey, "validateReferralCode", { max: 30, windowMs: 10 * 60 * 1000 });

  const code = (request.data?.code || "").toUpperCase().trim();
  if (!code) return { valid: false };

  const codeSnap = await db.doc(`referralCodes/${code}`).get();
  if (!codeSnap.exists) return { valid: false };
  if (request.auth && codeSnap.data().uid === request.auth.uid) {
    return { valid: false, reason: "own-code" };
  }
  return { valid: true };
});

// ---------- Callable: start a Stripe Checkout session (subscribe) ----------

// No Stripe trial here on purpose — the "try before you buy" mechanic is the free preview
// (FREE_PREVIEW_SECONDS_ALLOWED, see getLessonPlayback/reportPreviewProgress below) instead: a
// capped 10 minutes of REAL lesson content, no card required. A day-based Stripe trial would let
// someone binge the entire library in the free window and cancel before ever being charged —
// a time-boxed watch allowance doesn't have that failure mode.
exports.createCheckoutSession = onCall(
  // minInstances: 1 keeps one instance of this function warm at all times, so a Subscribe click
  // never has to wait out a cold start (spinning up a fresh container + loading the Stripe SDK)
  // on top of the actual Stripe API round trip — this is the single biggest lever on "Subscribe
  // feels slow," since it's the one function on the checkout path with real revenue on the line.
  // Trade-off: a small always-on hosting cost (roughly a few dollars a month) instead of scaling
  // to zero between calls like every other function here.
  { secrets: [stripeSecret, stripePriceId, stripeAnnualPriceId], minInstances: 1 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    // Every call hits the Stripe API (a real, metered, rate-limited dependency) — keep one
    // account from being able to hammer it. A genuine subscriber never needs more than a
    // handful of checkout attempts in an hour.
    await enforceRateLimit(request.auth.uid, "createCheckoutSession", { max: 10, windowMs: 60 * 60 * 1000 });
    const stripe = Stripe(stripeSecret.value());
    const uid = request.auth.uid;

    // Refuse to open a second subscription for someone who already has one active — without
    // this, a double-click, a slow network causing the client to retry, or someone just hitting
    // Subscribe twice from two tabs could complete two separate Stripe subscriptions and charge
    // the same person twice in parallel. Billing Portal is the correct place to change/cancel an
    // existing plan, not a brand-new Checkout Session.
    const existingUserSnap = await db.doc(`users/${uid}`).get();
    if (existingUserSnap.data()?.subscriptionStatus === "active") {
      throw new HttpsError(
        "failed-precondition",
        "You already have an active subscription — use Manage Subscription to change or cancel it."
      );
    }

    const referralCode = (request.data?.referralCode || "").toUpperCase().trim() || null;
    const plan = request.data?.plan === "annual" ? "annual" : "weekly";

    let priceId;
    if (plan === "annual") {
      priceId = stripeAnnualPriceId.value();
      if (!priceId) {
        throw new HttpsError(
          "failed-precondition",
          "Annual billing isn't set up yet — subscribe weekly for now, or ask the Astryks team."
        );
      }
    } else {
      priceId = stripePriceId.value();
    }

    // No discount for the referred person — referral codes are tracked purely so the
    // referrer can be paid out $50 after the referred person stays subscribed 90 days
    // (see checkReferralPayouts below). There used to be a 20%-off coupon here too; that
    // was removed, so this block only resolves referrerUid for tracking/payout purposes.
    let referrerUid = null;

    if (referralCode) {
      const codeSnap = await db.doc(`referralCodes/${referralCode}`).get();
      if (codeSnap.exists && codeSnap.data().uid !== uid) {
        referrerUid = codeSnap.data().uid;
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: uid,
      metadata: { uid, referrerUid: referrerUid || "", plan },
      success_url: safeRedirectUrl(request.data?.successUrl, "/home"),
      cancel_url: safeRedirectUrl(request.data?.cancelUrl, "/home"),
      // Required (not just "auto") so every subscriber's billing country is captured —
      // the webhook below saves it as the authoritative countryCode on their profile.
      // If the Price this Product uses has per-currency amounts configured in the Stripe
      // dashboard (Product → Price → "Add another currency"), Checkout automatically shows
      // and charges in that local currency based on the same billing details — no extra
      // code needed here for that part.
      billing_address_collection: "required",
    }, {
      // Collapses a double-click or a client retry after a network stutter within the same
      // minute into the SAME Stripe session (Stripe returns the original response instead of
      // creating a second one) rather than two separate sessions that could both be completed
      // and charge the same person twice. A genuine new attempt a minute later gets a fresh key.
      idempotencyKey: `checkout_${uid}_${plan}_${Math.floor(Date.now() / 60000)}`,
    });

    return { url: session.url };
  }
);

// ---------- Callable: open the Stripe Billing Portal (self-serve cancel/manage) ----------

exports.createBillingPortalSession = onCall(
  { secrets: [stripeSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    const stripe = Stripe(stripeSecret.value());
    const userSnap = await db.doc(`users/${request.auth.uid}`).get();
    const customerId = userSnap.data()?.stripeCustomerId;
    if (!customerId) throw new HttpsError("failed-precondition", "No subscription found for this account.");

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: safeRedirectUrl(request.data?.returnUrl, "/me"),
    });
    return { url: portal.url };
  }
);

// ---------- Callable: this member's own past charges + current subscription state ----------
// Lets the account page show billing history (date + amount) and whether a cancellation is
// already scheduled, directly in the app — rather than only being visible after clicking
// through to the separate Stripe-hosted billing portal.
exports.getMyBillingHistory = onCall(
  { secrets: [stripeSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    const userSnap = await db.doc(`users/${request.auth.uid}`).get();
    const customerId = userSnap.data()?.stripeCustomerId;
    if (!customerId) return { charges: [], cancelAtPeriodEnd: false, currentPeriodEnd: null };

    const stripe = Stripe(stripeSecret.value());
    const chargesList = await stripe.charges.list({ customer: customerId, limit: 24 });
    const charges = chargesList.data
      .filter((c) => c.paid || c.status === "succeeded")
      .map((c) => ({
        id: c.id,
        amountDisplay: formatCents(c.amount, c.currency),
        date: c.created * 1000,
        refunded: c.amount_refunded > 0,
        fullyRefunded: c.refunded,
      }));

    const subsList = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 5 });
    const currentSub = subsList.data.find((s) => s.status === "active" || s.status === "trialing") || null;

    return {
      charges,
      cancelAtPeriodEnd: currentSub?.cancel_at_period_end ?? false,
      currentPeriodEnd: currentSub?.current_period_end ? currentSub.current_period_end * 1000 : null,
    };
  }
);

// ---------- Callable: cancel my own subscription, right from the account page ----------
// Cancels at the end of the current billing period (the normal, expected behavior — you keep
// what you already paid for) rather than immediately, which is what distinguishes this from the
// full-refund flow's `stripe.subscriptions.cancel` (immediate, because that path already
// refunded the money). This exists so canceling doesn't require a detour through the separate
// Stripe billing portal — one button, right here.
exports.cancelMySubscription = onCall(
  { secrets: [stripeSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    const userSnap = await db.doc(`users/${request.auth.uid}`).get();
    const customerId = userSnap.data()?.stripeCustomerId;
    if (!customerId) throw new HttpsError("failed-precondition", "No subscription found for this account.");

    const stripe = Stripe(stripeSecret.value());
    const subsList = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 5 });
    const activeSubs = subsList.data.filter((s) => s.status === "active" || s.status === "trialing");
    if (activeSubs.length === 0) {
      throw new HttpsError("failed-precondition", "There's no active subscription on this account to cancel.");
    }

    let currentPeriodEnd = null;
    for (const sub of activeSubs) {
      const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      currentPeriodEnd = updated.current_period_end ? updated.current_period_end * 1000 : currentPeriodEnd;
    }
    // subscriptionStatus in Firestore stays "active" until the period actually ends and Stripe
    // sends customer.subscription.updated with status no longer active/trialing — that handler
    // (in stripeWebhook below) is what flips it to "canceled" and sends the cancellation email,
    // so both the immediate-refund path and this scheduled-cancel path funnel through one place.
    return { currentPeriodEnd };
  }
);

// ---------- Self-service refunds — 90-day money-back guarantee, "no questions asked" ----------
// A member requests a refund (requestRefund) -- only accepted within REFUND_GUARANTEE_DAYS of
// their first charge -- you get emailed + pushed (notifyAdmin) with their entire lifetime
// billing total -> you review at astryks.com/admin/refunds and click Approve (approveRefund),
// which refunds every charge Stripe has on file for them in full and cancels their subscription
// immediately. There's no partial-refund path and no built-in decline reason capture on purpose
// — "no questions asked" per how this was scoped, as long as it's within the guarantee window.
// Web/Stripe subscribers only: mobile App Store/Google Play subscribers pay through Apple/
// Google, and only Apple/Google can refund those — requestRefund below explains that instead of
// accepting a request it can't fulfill.

// Sums every still-refundable dollar Stripe has ever captured from this customer — i.e. their
// full lifetime billing total minus whatever's already been refunded — across every charge,
// not just the current billing period. Walks all pages so a years-long subscriber (>100
// charges) is still totalled correctly.
async function getRefundableTotal(stripe, customerId) {
  let totalCents = 0;
  let currency = null;
  let startingAfter;
  for (;;) {
    const page = await stripe.charges.list({ customer: customerId, limit: 100, starting_after: startingAfter });
    for (const charge of page.data) {
      if (!charge.paid || charge.status !== "succeeded") continue;
      const refundable = charge.amount - charge.amount_refunded;
      if (refundable <= 0) continue;
      totalCents += refundable;
      currency = currency || charge.currency;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return { totalCents, currency: currency || "usd" };
}

// Stripe amounts are always integer minor units (cents) — this turns 1234/"aud" into "AU$12.34"
// for anything shown to a member or you, falling back to a plain "12.34 AUD" if Intl doesn't
// recognize the currency code for some reason.
function formatCents(cents, currency) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(
      cents / 100
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

// The money-back guarantee window: a full refund is available, no questions asked, up to this
// many days after someone's *first* Stripe charge (subscriptionStartDate, set in stripeWebhook's
// checkout.session.completed handler above). After that window, requestRefund below declines
// automatically rather than silently refunding an indefinitely long-tenured subscriber — this
// mirrors a standard 90-day money-back guarantee, not an open-ended "cancel and get everything
// back" policy.
const REFUND_GUARANTEE_DAYS = 90;

// ---------- Callable: a member asks for a full refund ----------

exports.requestRefund = onCall(
  { secrets: [stripeSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    await enforceRateLimit(request.auth.uid, "requestRefund", { max: 5, windowMs: 24 * 60 * 60 * 1000 });
    const uid = request.auth.uid;

    const userSnap = await db.doc(`users/${uid}`).get();
    const customerId = userSnap.data()?.stripeCustomerId;
    if (!customerId) {
      throw new HttpsError(
        "failed-precondition",
        "No web subscription found on this account. If you subscribed through the iOS or Android app, refunds " +
          "for that go through Apple's or Google's own refund request process, not Astryks directly."
      );
    }

    const startDate = userSnap.data()?.subscriptionStartDate?.toDate?.();
    const daysSinceStart = startDate ? (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24) : null;
    if (daysSinceStart == null || daysSinceStart > REFUND_GUARANTEE_DAYS) {
      throw new HttpsError(
        "failed-precondition",
        `The ${REFUND_GUARANTEE_DAYS}-day money-back guarantee only covers refund requests made within ` +
          `${REFUND_GUARANTEE_DAYS} days of first subscribing, and that window has passed on this account. ` +
          `Message us in the app if you'd like to ask about an exception.`
      );
    }

    const pendingSnap = await db
      .collection("refundRequests")
      .where("uid", "==", uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      throw new HttpsError("already-exists", "You already have a refund request awaiting review.");
    }

    const stripe = Stripe(stripeSecret.value());
    const { totalCents, currency } = await getRefundableTotal(stripe, customerId);
    if (totalCents <= 0) {
      throw new HttpsError("failed-precondition", "There's nothing on this account to refund.");
    }

    const userName = userSnap.data()?.displayName || request.auth.token.name || "A member";
    const userEmail = userSnap.data()?.email || request.auth.token.email || "";
    const amountDisplay = formatCents(totalCents, currency);

    // A deterministic per-user doc ID (rather than the pendingSnap query above, which only
    // catches a duplicate that's already committed) is what actually closes the race: two
    // near-simultaneous calls from the same account can both pass the query check before either
    // write lands, but only one of them can win this transactional create.
    const reqRef = db.doc(`refundRequests/pending_${uid}`);
    const created = await db.runTransaction(async (tx) => {
      const existing = await tx.get(reqRef);
      if (existing.exists && existing.data()?.status === "pending") return false;
      tx.set(reqRef, {
        uid,
        userName,
        userEmail,
        stripeCustomerId: customerId,
        totalCents,
        currency,
        status: "pending",
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!created) {
      throw new HttpsError("already-exists", "You already have a refund request awaiting review.");
    }

    await notifyAdmin(
      `💸 Refund requested — ${amountDisplay}`,
      `${userName} (${userEmail}) has requested a full refund of everything they've ever been billed — ` +
        `${amountDisplay} across their account's lifetime.\n\n` +
        `Go to https://astryks.com/admin/refunds to review and approve. Approving refunds every charge on file ` +
        `and cancels their subscription immediately — no partial refunds, no questions asked.`
    );

    return { requestId: reqRef.id, totalDisplay: amountDisplay };
  }
);

// ---------- Callable: a member checks their own most recent refund request ----------

exports.getMyRefundStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");

  const snap = await db
    .collection("refundRequests")
    .where("uid", "==", request.auth.uid)
    .orderBy("requestedAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return { status: null };

  const r = snap.docs[0].data();
  return {
    status: r.status,
    totalDisplay: formatCents(r.totalCents, r.currency),
    requestedAt: r.requestedAt ? r.requestedAt.toMillis() : null,
  };
});

// ---------- Callable: admin lists every refund request ----------

exports.getRefundRequests = onCall(async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "Admins only.");
  }

  const snap = await db.collection("refundRequests").orderBy("requestedAt", "desc").limit(100).get();
  return {
    requests: snap.docs.map((d) => {
      const r = d.data();
      return {
        id: d.id,
        uid: r.uid,
        userName: r.userName,
        userEmail: r.userEmail,
        status: r.status,
        totalDisplay: formatCents(r.totalCents, r.currency),
        refundedDisplay: r.refundedCents != null ? formatCents(r.refundedCents, r.refundedCurrency || r.currency) : null,
        requestedAt: r.requestedAt ? r.requestedAt.toMillis() : null,
        approvedAt: r.approvedAt ? r.approvedAt.toMillis() : null,
      };
    }),
  };
});

// ---------- Callable: admin approves a refund request — refunds everything, no questions asked ----------

exports.approveRefund = onCall(
  { secrets: [stripeSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }
    const requestId = request.data?.requestId;
    if (!requestId) throw new HttpsError("invalid-argument", "Missing requestId.");

    const reqRef = db.doc(`refundRequests/${requestId}`);

    // Claim this request atomically before touching Stripe. Without this, a doubled admin
    // click (or a retried network request) could both read status "pending" before either
    // write landed, and both loops below would refund every charge on file — a real double
    // refund, not just a UI glitch.
    let refundRequest;
    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw new HttpsError("not-found", "Refund request not found.");
      refundRequest = reqSnap.data();
      if (refundRequest.status !== "pending") {
        throw new HttpsError("failed-precondition", `This request has already been ${refundRequest.status}.`);
      }
      tx.update(reqRef, { status: "processing" });
    });

    const stripe = Stripe(stripeSecret.value());
    const customerId = refundRequest.stripeCustomerId;

    // Refund every outstanding charge on file — their entire billing history, no partial
    // amounts, no picking which charge. Walks all pages for long-tenured subscribers.
    let refundedCents = 0;
    let currency = refundRequest.currency || "usd";
    try {
      let startingAfter;
      for (;;) {
        const page = await stripe.charges.list({ customer: customerId, limit: 100, starting_after: startingAfter });
        for (const charge of page.data) {
          const refundable = charge.amount - charge.amount_refunded;
          if (!charge.paid || charge.status !== "succeeded" || refundable <= 0) continue;
          const refund = await stripe.refunds.create({ charge: charge.id });
          refundedCents += refund.amount;
          currency = charge.currency || currency;
        }
        if (!page.has_more) break;
        startingAfter = page.data[page.data.length - 1].id;
      }

      // A full refund shouldn't leave them still being billed — cancel immediately rather than
      // "at period end" (Stripe SDK v16: subscriptions.cancel, not the deprecated .del()).
      const subsList = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      for (const sub of subsList.data) {
        if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (err) {
      // Deliberately left as "processing" rather than reverted to "pending" — some charges may
      // already be refunded, so this needs a human to check Stripe before anyone retries, not
      // an automatic re-attempt that could refund the same charges twice.
      throw new HttpsError(
        "internal",
        `Refund failed partway through — check this customer's Stripe history before retrying. (${err.message})`
      );
    }

    await db.doc(`users/${refundRequest.uid}`).set(
      { subscriptionStatus: "canceled", canceledAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    const amountDisplay = formatCents(refundedCents, currency);
    await reqRef.set(
      {
        status: "approved",
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        refundedCents,
        refundedCurrency: currency,
      },
      { merge: true }
    );

    try {
      await sendSupportMessage(
        refundRequest.uid,
        refundRequest.userName,
        `Your refund of ${amountDisplay} has been approved and sent back to your original payment method — ` +
          `it usually takes 5-10 business days to land, depending on your bank. Your subscription's been ` +
          `canceled, so you won't be charged again. You're always welcome to keep posting and browsing for ` +
          `free, and if you ever want the expert-led classes again, you can resubscribe any time.`
      );
    } catch (err) {
      console.error("approveRefund: failed to message member", refundRequest.uid, err);
    }

    // Same confirmation as an email too, not just the in-app message above — a refund is
    // exactly the kind of thing someone wants a receipt for in their inbox, not just a DM they
    // might not see if they've already stopped opening the app.
    try {
      if (refundRequest.userEmail) {
        await sendBrandedEmail(
          refundRequest.userEmail,
          buildRefundConfirmationEmail(refundRequest.userName, amountDisplay)
        );
      }
    } catch (err) {
      console.error("approveRefund: failed to email member", refundRequest.uid, err);
    }

    return { refundedTotal: amountDisplay };
  }
);

// ---------- RETIRED — Creative Prize payouts via Stripe Connect ----------
// Un-exported along with the rest of the cash prize (see the RETIRED banner above optOutOfPrize)
// — payoutAccounts/createPayoutOnboardingLink/getPayoutAccountStatus/payWinnerViaStripe existed
// purely to pay prize winners, nothing else in the app used them.
// The manual "copy these details into your own bank" flow (see admin/prizes) still works and
// stays as a fallback — this adds a real automated rail on top of it. Each winner (or anyone,
// really — same as the existing manual bank/PayID form, available any time, not just after
// winning) can complete a short Stripe-hosted onboarding form. Their actual bank details go
// straight to Stripe and are never seen by Astryks at all — payoutAccounts/{uid} only ever
// stores the resulting Stripe account ID and whether it's ready to receive money, nothing
// sensitive. Once ready, paying them is one click (payWinnerViaStripe) instead of a manual
// transfer. Requires Stripe Connect to be enabled on the account first (Stripe Dashboard →
// Connect → get started, choose "Platform or marketplace") — that's a one-time setup step only
// possible from inside your own Stripe account, not something settable via the API.

// ---------- Callable: get-or-create a Stripe Connect onboarding link for the caller ----------
const _legacy_createPayoutOnboardingLink = onCall({ secrets: [stripeSecret] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  const uid = request.auth.uid;
  const stripe = Stripe(stripeSecret.value());

  const acctDocRef = db.doc(`payoutAccounts/${uid}`);
  const acctDoc = await acctDocRef.get();
  let stripeAccountId = acctDoc.data()?.stripeAccountId;

  if (!stripeAccountId) {
    // Best-effort country guess — countryCode is only reliably set once someone has actually
    // subscribed via Stripe or mobile IAP (see stripeWebhook/qonversionWebhook), and prize
    // entry deliberately doesn't require a subscription (see nominateForPrize), so plenty of
    // winners won't have one on file. Defaulting to AU is a reasonable bet for an Australian
    // prize in AUD; if a winner's real country isn't one Stripe Express supports, account
    // creation below will throw a clear Stripe error and the manual bank/PayID flow remains
    // the fallback for that case.
    let countryCode = "AU";
    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      countryCode = userSnap.data()?.countryCode || "AU";
    } catch {
      countryCode = "AU";
    }

    const account = await stripe.accounts.create({
      type: "express",
      country: countryCode,
      email: request.auth.token.email || undefined,
      capabilities: { transfers: { requested: true } },
      metadata: { uid },
    });
    stripeAccountId = account.id;
    await acctDocRef.set(
      {
        stripeAccountId,
        payoutsEnabled: false,
        detailsSubmitted: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    type: "account_onboarding",
    refresh_url: "https://astryks.com/prize-payout-setup?status=refresh",
    return_url: "https://astryks.com/prize-payout-setup?status=done",
  });

  return { url: accountLink.url };
});

// ---------- Callable: has the caller finished Stripe onboarding? ----------
const _legacy_getPayoutAccountStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
  const snap = await db.doc(`payoutAccounts/${request.auth.uid}`).get();
  if (!snap.exists) return { hasAccount: false, payoutsEnabled: false };
  const data = snap.data();
  return { hasAccount: true, payoutsEnabled: !!data.payoutsEnabled };
});

// ---------- Callable: admin-only — actually send the AU$1,000 via Stripe Connect ----------
// One click, no manually keying anything into a bank form. Requires the winner to have already
// completed Stripe onboarding (payoutsEnabled on their payoutAccounts doc) — the admin prizes
// page only shows this button once that's true; the manual copy-fields panel is always there
// as a fallback regardless.
const _legacy_payWinnerViaStripe = onCall({ secrets: [stripeSecret] }, async (request) => {
  if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const { month } = request.data ?? {};
  if (!month) throw new HttpsError("invalid-argument", "month is required.");

  const winnerRef = db.doc(`prizeWinners/${month}`);

  // Claim the payout atomically before calling Stripe. Two near-simultaneous clicks (or a
  // retried request) could otherwise both read paid: false before either write landed, and
  // both would go on to send a real transfer — an actual double payment, not just a UI glitch.
  let winner;
  await db.runTransaction(async (tx) => {
    const winnerSnap = await tx.get(winnerRef);
    if (!winnerSnap.exists) throw new HttpsError("not-found", "No winner recorded for that month.");
    winner = winnerSnap.data();
    if (winner.paid) {
      throw new HttpsError("failed-precondition", "This month is already marked as paid — unmark it first if you really want to send another transfer.");
    }
    if (winner.paymentInProgress) {
      throw new HttpsError("failed-precondition", "A payout for this month is already being processed — wait a moment and refresh before retrying.");
    }
    tx.update(winnerRef, { paymentInProgress: true });
  });

  const payoutAcctSnap = await db.doc(`payoutAccounts/${winner.ownerId}`).get();
  const payoutAcct = payoutAcctSnap.data();
  if (!payoutAcct?.stripeAccountId || !payoutAcct.payoutsEnabled) {
    await winnerRef.set({ paymentInProgress: false }, { merge: true });
    throw new HttpsError(
      "failed-precondition",
      "This winner hasn't finished setting up direct deposit yet — use the manual bank/PayID details instead, or send them a reminder."
    );
  }

  const stripe = Stripe(stripeSecret.value());
  let transfer;
  try {
    // Belt-and-suspenders alongside the paymentInProgress transaction claim above: an
    // idempotency key scoped to this specific month means even a Cloud Functions-level retry
    // of this exact request (rare, but possible on a cold-start/network hiccup) can't result in
    // Stripe actually moving the AU$1,000 twice for the same winner.
    transfer = await stripe.transfers.create({
      amount: PRIZE_AUD * 100,
      currency: "aud",
      destination: payoutAcct.stripeAccountId,
      description: `Astryks Creative Prize — ${winner.monthLabel}`,
    }, {
      idempotencyKey: `prize_transfer_${month}`,
    });
  } catch (err) {
    // Release the claim so a genuine retry (e.g. after fixing a Stripe Connect account issue)
    // isn't permanently blocked by the in-progress flag left over from this failed attempt.
    await winnerRef.set({ paymentInProgress: false }, { merge: true });
    throw new HttpsError("internal", `Stripe declined this transfer: ${err.message}`);
  }

  await winnerRef.set(
    {
      paid: true,
      paymentInProgress: false,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidVia: "stripe",
      stripeTransferId: transfer.id,
    },
    { merge: true }
  );

  return { ok: true, transferId: transfer.id };
});

// ---------- Webhook: Stripe tells us about subscription changes ----------

exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret, SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (req, res) => {
    const stripe = Stripe(stripeSecret.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], stripeWebhookSecret.value());
    } catch (err) {
      res.status(400).send(`Webhook signature error: ${err.message}`);
      return;
    }

    // Stripe delivers webhooks "at least once" — if this function is slow (Firestore writes +
    // sending an email) and Stripe's own timeout fires before we respond, it retries the SAME
    // event again later. Every write below is naturally idempotent (Firestore .set with merge
    // just re-applies the same state), EXCEPT the confirmation/cancellation emails, which would
    // otherwise get re-sent to a real person on every retry.
    //
    // This used to claim the event (write stripeWebhookEvents/{id}) BEFORE any processing ran —
    // so if a Firestore write or the email send threw partway through, the event was already
    // marked "done." Stripe's automatic retry of that exact same event would then be silently
    // dropped as a duplicate, permanently losing whatever side effect never finished (e.g. a
    // paying customer never gets subscriptionStatus:"active"). Checking-then-claiming-at-the-end
    // instead means a genuine mid-processing failure is retried for real. The only trade-off is
    // a narrow window where two truly-simultaneous deliveries of the same event (not the normal
    // sequential retry-after-timeout case) could both process before either claims — acceptable
    // here since that's far rarer than "processing throws partway through."
    const eventRef = db.doc(`stripeWebhookEvents/${event.id}`);
    const alreadyProcessed = (await eventRef.get()).exists;
    if (alreadyProcessed) {
      res.json({ received: true, duplicate: true });
      return;
    }

    // Fires whenever a Connect Express account's status changes — including right after
    // someone finishes the onboarding form triggered by createPayoutOnboardingLink above. Make
    // sure "account.updated" is ticked in this webhook's event list in the Stripe Dashboard
    // (Developers → Webhooks → this endpoint → update events), or this branch never runs.
    if (event.type === "account.updated") {
      const account = event.data.object;
      const uid = account.metadata?.uid;
      if (uid) {
        const payoutsEnabled = !!account.payouts_enabled;
        const acctRef = db.doc(`payoutAccounts/${uid}`);
        const prevSnap = await acctRef.get();
        const wasEnabled = !!prevSnap.data()?.payoutsEnabled;

        await acctRef.set(
          {
            payoutsEnabled,
            detailsSubmitted: !!account.details_submitted,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Only alert the moment this account NEWLY becomes payable — Stripe fires
        // account.updated repeatedly throughout onboarding, most of which don't flip
        // payouts_enabled at all. And only if this person is an actual unpaid, un-held prize
        // winner right now — someone can complete Stripe onboarding for reasons unrelated to
        // ever having won anything.
        if (payoutsEnabled && !wasEnabled) {
          try {
            const winnersSnap = await db
              .collection("prizeWinners")
              .where("ownerId", "==", uid)
              .where("paid", "==", false)
              .get();
            for (const winnerDoc of winnersSnap.docs) {
              const winner = winnerDoc.data();
              if (winner.payoutHeld) continue;
              await notifyAdmin(
                `💰 Ready to pay: ${winner.ownerName || "this month's winner"} finished direct deposit setup`,
                `${winner.ownerName || "This month's winner"} just finished verifying their bank details with ` +
                  `Stripe for the ${winner.monthLabel} Creative Prize (AU$${PRIZE_AUD}).\n\n` +
                  `Nothing has been sent — go to https://astryks.com/admin/prizes and click "Pay AU$${PRIZE_AUD} via ` +
                  `Stripe" next to their name when you're ready. That button, and the confirmation dialog after it, ` +
                  `is the only thing that actually moves the money.`
              );
            }
          } catch (err) {
            console.error("stripeWebhook: failed to check for a ready-to-pay winner", uid, err);
          }
        }
      }
      // Claimed only now that every side effect above actually completed — see the comment
      // where alreadyProcessed is checked, at the top of this function.
      await eventRef.set({ type: event.type, receivedAt: admin.firestore.FieldValue.serverTimestamp() });
      res.json({ received: true });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (!uid) {
        // Every session createCheckoutSession creates sets this — a session missing it wasn't
        // created through our own flow (e.g. a manual test session from the Stripe dashboard).
        // Ack the event so Stripe doesn't retry, but don't write to the literal path
        // `users/undefined`.
        console.error("stripeWebhook: checkout.session.completed with no client_reference_id, skipping", session.id);
        res.json({ received: true });
        return;
      }
      const referrerUid = session.metadata?.referrerUid;

      // Billing country/currency from the actual payment — this is the authoritative source
      // for the leaderboard flag and any future localized-pricing logic (far more reliable
      // than a client-side timezone guess, since it's captured by Stripe itself at checkout).
      const countryCode = session.customer_details?.address?.country || null;
      const subscriptionCurrency = session.currency ? session.currency.toUpperCase() : null;

      await db.doc(`users/${uid}`).set(
        {
          subscriptionStatus: "active",
          stripeCustomerId: session.customer,
          subscriptionStartDate: admin.firestore.FieldValue.serverTimestamp(),
          ...(countryCode ? { countryCode } : {}),
          ...(subscriptionCurrency ? { subscriptionCurrency } : {}),
        },
        { merge: true }
      );

      if (referrerUid) {
        await db.doc(`referrals/${uid}`).set({
          referrerUid,
          referredUid: uid,
          subscriptionStartDate: admin.firestore.FieldValue.serverTimestamp(),
          paid: false,
        });
      }

      // Automatic "thanks for subscribing" email — fires the moment Stripe confirms the first
      // payment, using the actual charged amount/currency (session.amount_total/currency) rather
      // than the client-side geo-guessed price, so the number in the email always matches what
      // was really billed (including any referral discount applied at checkout). The interval
      // label (/week vs /year) comes from the plan we stashed in session.metadata at checkout.
      try {
        const email = session.customer_details?.email;
        if (email) {
          const interval = session.metadata?.plan === "annual" ? "year" : "week";
          const priceDisplay =
            session.amount_total != null
              ? `${formatCents(session.amount_total, subscriptionCurrency || "usd")}/${interval}`
              : "your subscription price";
          let displayName = session.customer_details?.name || "there";
          try {
            const userRecord = await admin.auth().getUser(uid);
            displayName = userRecord.displayName || displayName;
          } catch {
            // Fall back to the name Stripe collected at checkout — not fatal either way.
          }
          await sendBrandedEmail(email, buildSubscriptionConfirmationEmail(displayName, priceDisplay));
        }
      } catch (err) {
        console.error("stripeWebhook: failed to send subscription confirmation email", uid, err);
      }
    }

    if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const isActive = sub.status === "active" || sub.status === "trialing";
      // Stripe's automatic dunning retries put a subscription into "past_due" (not straight to
      // "canceled") while it keeps retrying the card over several days. Access is correctly cut
      // off here the moment it's not active/trialing — a lapsed card shouldn't keep unlocking
      // lessons — but "past_due" is still RECOVERABLE: if the card gets fixed or the retry
      // succeeds, Stripe flips the subscription straight back to "active" and charges it, with
      // no separate "resubscribed" event. Treating past_due the same as a real, terminal
      // cancellation for EMAIL purposes used to send "your subscription has been canceled — you
      // won't be charged again," which is simply false for anyone still inside the retry window.
      const isPastDue = sub.status === "past_due";
      const usersSnap = await db.collection("users").where("stripeCustomerId", "==", sub.customer).limit(1).get();
      if (!usersSnap.empty) {
        const userDoc = usersSnap.docs[0];
        const wasActive = userDoc.data()?.subscriptionStatus === "active";
        await userDoc.ref.set(
          {
            subscriptionStatus: isActive ? "active" : "canceled",
            ...(isActive ? {} : { canceledAt: admin.firestore.FieldValue.serverTimestamp() }),
          },
          { merge: true }
        );

        // Only email the moment a subscription actually TRANSITIONS from active to canceled —
        // Stripe fires "customer.subscription.updated" for lots of things unrelated to
        // cancellation (card updates, trial-to-paid, etc.), and firing this on every one of
        // those would spam someone who hasn't actually canceled anything. And never send the
        // "canceled, you won't be charged again" email for a past_due lapse specifically — that
        // state can still recover into a real charge, so a payment-failed email (surfaced to the
        // user in-app via their billing status, not yet a separate email template) is the
        // accurate message here, not a cancellation confirmation.
        if (wasActive && !isActive && !isPastDue) {
          try {
            const userRecord = await admin.auth().getUser(userDoc.id);
            if (userRecord.email) {
              await sendBrandedEmail(userRecord.email, buildCancellationEmail(userRecord.displayName || "there"));
            }
          } catch (err) {
            console.error("stripeWebhook: failed to send cancellation email", userDoc.id, err);
          }
        }
      }
    }

    // Claimed only now that every side effect above actually completed — see the comment where
    // alreadyProcessed is checked, at the top of this function.
    await eventRef.set({ type: event.type, receivedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ received: true });
  }
);

// ---------- Webhook: Qonversion -> Firestore (mobile in-app-purchase subscriptions) ----------
//
// Web subscriptions go through Stripe (stripeWebhook above). Mobile subscriptions go through
// Apple/Google in-app purchases, brokered by Qonversion, which is told the Firebase uid via
// Qonversion.getSharedInstance().identify(uid) (see astryks-mobile/lib/purchases.ts) — so
// `event.custom_user_id` here IS the Firestore users/{uid} doc id, no separate mapping table
// needed.
//
// Set this URL as the webhook in the Qonversion dashboard (Settings > Integrations > Webhooks),
// and put the same value you choose for the "Header Authorization-Token Value" field there into
// the QONVERSION_WEBHOOK_AUTH secret via `firebase functions:secrets:set`.
exports.qonversionWebhook = onRequest({ secrets: [qonversionWebhookAuth] }, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] || "";
    const expected = `Basic ${qonversionWebhookAuth.value()}`;

    // Timing-safe comparison — a plain !== leaks (via response-time differences) how many
    // leading characters of the secret an attacker's guess got right. crypto.timingSafeEqual
    // requires equal-length buffers, so pad/compare lengths first to avoid it throwing (which
    // would itself leak length information via a different error).
    const authBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expected);
    const isAuthorized =
      authBuf.length === expectedBuf.length && crypto.timingSafeEqual(authBuf, expectedBuf);
    if (!isAuthorized) {
      res.status(401).send("Unauthorized");
      return;
    }

    const event = req.body || {};
    const uid = event.custom_user_id || event.user_id;
    // Firebase Auth uids are never longer than 128 chars and this must be a plain identifier,
    // not a Firestore path — reject anything that isn't a simple, bounded string before ever
    // using it to build a document path.
    if (!uid || typeof uid !== "string" || uid.length > 128 || uid.includes("/")) {
      res.status(400).send("Missing or invalid custom_user_id/user_id");
      return;
    }

    // Qonversion's webhook payload includes the current state of every entitlement directly, so
    // unlike RevenueCat's event-type-based approach, we don't need to interpret event_name values
    // (trial_converted, subscription_renewed, subscription_canceled, etc.) ourselves — just read
    // whether the entitlement we care about is currently active. `entitlements` comes through as
    // an object keyed by numeric string index, not an array.
    // Must match ENTITLEMENT_ID in astryks-mobile/lib/purchases.ts.
    const ENTITLEMENT_ID = "premium";
    const entitlements = Object.values(event.entitlements || {});
    const premium = entitlements.find((e) => e && e.id === ENTITLEMENT_ID);

    if (!premium) {
      // Event not related to our entitlement (e.g. a different product/entitlement in the same
      // project) — nothing to do.
      res.json({ received: true });
      return;
    }

    if (premium.active) {
      await db.doc(`users/${uid}`).set(
        {
          subscriptionStatus: "active",
          subscriptionPlatform: event.platform ? event.platform.toLowerCase() : "qonversion",
          ...(event.country ? { countryCode: event.country } : {}),
        },
        { merge: true }
      );
    } else {
      // `active: false` already accounts for the "keep access until the paid period ends" grace
      // period the same way RevenueCat's CANCELLATION-vs-EXPIRATION distinction did — Qonversion
      // keeps `active: true` until the period actually lapses even after the user cancels
      // auto-renew, so we don't need separate cancellation-vs-expiration handling here.
      await db.doc(`users/${uid}`).set(
        { subscriptionStatus: "canceled", canceledAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("qonversionWebhook error:", err);
    res.status(500).send("Internal error");
  }
});

// ---------- Scheduled: mark $50 referral payouts owed after 3 months of active subscription ----------

exports.checkReferralPayouts = onSchedule("every day 09:00", async () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const referralsSnap = await db.collection("referrals").where("paid", "==", false).get();

  for (const refDoc of referralsSnap.docs) {
    const ref = refDoc.data();
    const startDate = ref.subscriptionStartDate?.toDate?.();
    if (!startDate || startDate > ninetyDaysAgo) continue;

    const referredUserSnap = await db.doc(`users/${ref.referredUid}`).get();
    if (referredUserSnap.data()?.subscriptionStatus !== "active") continue;

    // Claim this referral's payout atomically — re-checks `paid` inside the transaction so two
    // overlapping runs of this scheduled function (a Cloud Scheduler retry racing the original,
    // say) can't both read `paid: false` and both credit the same $50 twice.
    const claimed = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(refDoc.ref);
      if (freshSnap.data()?.paid !== false) return false;
      tx.set(db.doc(`users/${ref.referrerUid}`), { payoutOwed: admin.firestore.FieldValue.increment(50) }, { merge: true });
      tx.set(refDoc.ref, { paid: true, payoutMarkedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) continue;
    await sendPush(ref.referrerUid, "You earned $50!", "A friend you referred has stuck around for 3 months.");
  }
});


exports.dailyStreakReminder = onSchedule("every day 18:00", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const usersSnap = await db.collection("users").where("lastActiveDate", "!=", today).get();

  await Promise.all(
    usersSnap.docs.map((doc) =>
      sendPush(doc.id, "Keep your streak going", "You haven't posted or completed a lesson today yet.")
    )
  );
});

// Cosmetic-only display price for the onboarding nudge emails below — fixed USD everywhere,
// same as web/lib/geo.ts. NOT the source of truth for what anyone is actually charged.
function nudgePriceDisplay() {
  return "$4.99/week";
}

// ---------- Scheduled: onboarding drip — the two nudges for signups who've gone quiet ----------
// Both are purely time-since-signup based (profiles/{uid}.createdAt), each gated so it can only
// ever fire once per account:
//  - ~2 days in, if they haven't started a single lesson yet
//  - ~5 days in, if they still haven't subscribed
// Each query uses a wide (16-hour) window so a single missed/delayed run doesn't skip anyone —
// they just get caught by the next day's run instead of falling through a narrow slot.
exports.sendOnboardingNudges = onSchedule(
  { schedule: "every day 10:00", timeZone: "Australia/Sydney", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async () => {
    const now = Date.now();
    const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000);

    const day2Snap = await db
      .collection("profiles")
      .where("createdAt", ">=", hoursAgo(56))
      .where("createdAt", "<=", hoursAgo(40))
      .get();

    for (const doc of day2Snap.docs) {
      const data = doc.data();
      if (data.onboarding?.day2SentAt) continue;
      try {
        const progressSnap = await db.collection("lessonProgress").where("uid", "==", doc.id).limit(1).get();
        if (!progressSnap.empty) continue; // already started a lesson — no nudge needed

        const userRecord = await admin.auth().getUser(doc.id);
        if (!userRecord.email) continue;
        await sendBrandedEmail(userRecord.email, buildTryLessonEmail(userRecord.displayName || data.displayName));
        await doc.ref.set(
          { onboarding: { ...data.onboarding, day2SentAt: admin.firestore.FieldValue.serverTimestamp() } },
          { merge: true }
        );
      } catch (err) {
        console.error("sendOnboardingNudges: day2 nudge failed for", doc.id, err);
      }
    }

    const day5Snap = await db
      .collection("profiles")
      .where("createdAt", ">=", hoursAgo(128))
      .where("createdAt", "<=", hoursAgo(112))
      .get();

    for (const doc of day5Snap.docs) {
      const data = doc.data();
      if (data.onboarding?.day5SentAt) continue;
      try {
        const userSnap = await db.doc(`users/${doc.id}`).get();
        if (userSnap.data()?.subscriptionStatus === "active") continue;

        const userRecord = await admin.auth().getUser(doc.id);
        if (!userRecord.email) continue;
        const priceDisplay = nudgePriceDisplay();
        await sendBrandedEmail(
          userRecord.email,
          buildSubscribeNudgeEmail(userRecord.displayName || data.displayName, priceDisplay)
        );
        await doc.ref.set(
          { onboarding: { ...data.onboarding, day5SentAt: admin.firestore.FieldValue.serverTimestamp() } },
          { merge: true }
        );
      } catch (err) {
        console.error("sendOnboardingNudges: day5 nudge failed for", doc.id, err);
      }
    }
  }
);

// ---------- Scheduled: re-engagement — nudge accounts that have gone quiet 2+ weeks ----------
// lastActiveDate is the plain "YYYY-MM-DD" string bumpStreakInternal already maintains (updated
// on every lesson completion) — ISO date strings compare correctly as plain strings, so this is
// a single-field range query, same pattern as the existing dailyStreakReminder above. Sends at
// most once every 30 days per account (checked in JS against reengagement.lastSentAt) so someone
// who stays inactive doesn't get this every single day forever.
exports.sendReengagementEmails = onSchedule(
  { schedule: "every day 11:00", timeZone: "Australia/Sydney", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const usersSnap = await db.collection("users").where("lastActiveDate", "<=", fourteenDaysAgo).get();

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const lastSent = data.reengagement?.lastSentAt?.toDate?.();
      if (lastSent && Date.now() - lastSent.getTime() < 30 * 24 * 60 * 60 * 1000) continue;

      try {
        const userRecord = await admin.auth().getUser(doc.id);
        if (!userRecord.email) continue;
        await sendBrandedEmail(userRecord.email, buildWeMissYouEmail(userRecord.displayName));
        await doc.ref.set(
          { reengagement: { lastSentAt: admin.firestore.FieldValue.serverTimestamp() } },
          { merge: true }
        );
      } catch (err) {
        console.error("sendReengagementEmails: failed for", doc.id, err);
      }
    }
  }
);

// ---------- Scheduled: win-back — nudge accounts that canceled roughly 3 weeks ago ----------
// canceledAt is set at the same moment subscriptionStatus flips to "canceled" (Stripe webhook,
// Qonversion webhook, and the refund-approval flow all set it now — see those call sites).
// Requires a composite index on users(subscriptionStatus ASC, canceledAt ASC) — already added to
// firestore.indexes.json. Fires at most once per account (winBackSentAt flag).
exports.sendWinBackEmails = onSchedule(
  { schedule: "every day 12:00", timeZone: "Australia/Sydney", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS] },
  async () => {
    const now = Date.now();
    const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000);

    const snap = await db
      .collection("users")
      .where("subscriptionStatus", "==", "canceled")
      .where("canceledAt", ">=", hoursAgo(23 * 24))
      .where("canceledAt", "<=", hoursAgo(19 * 24))
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.winBackSentAt) continue;
      try {
        const userRecord = await admin.auth().getUser(doc.id);
        if (!userRecord.email) continue;
        await sendBrandedEmail(userRecord.email, buildWinBackEmail(userRecord.displayName));
        await doc.ref.set({ winBackSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (err) {
        console.error("sendWinBackEmails: failed for", doc.id, err);
      }
    }
  }
);

// ---------- Scheduled: email the admin the previous month's creative-prize nominees ----------
//
// Fires the morning of the 1st of every month. Looks at posts CREATED during the month that
// just ended (not just "posts with 50+ likes right now") so a popular older post can't keep
// "winning" every month forever — each month's draw is scoped to that month's own posts.
// This only ever emails a ranked candidate list; picking the actual winner and sending the
// AU$1,000 is still a manual step for the admin, same as the referral payouts above.
const _legacy_sendMonthlyPrizeReport = onSchedule(
  { schedule: "0 9 1 * *", timeZone: "Australia/Sydney", secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async () => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthLabel = prevMonthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    const monthId = monthKey(prevMonthStart);

    const snap = await db
      .collection("posts")
      .where("createdAt", ">=", prevMonthStart)
      .where("createdAt", "<", thisMonthStart)
      .get();

    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.prizeEligible && !p.prizeOptOut)
      .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));

    if (candidates.length === 0) {
      await sendSupportEmail(
        `Astryks creative prize — ${monthLabel}: no qualifying posts`,
        `No eligible creative posts in ${monthLabel} (none opted out and none posted), so there's no one to pay out this month.`
      );
      return;
    }

    const topPost = candidates[0];
    const hasWinner = (topPost.likeCount ?? 0) >= PRIZE_LIKE_THRESHOLD;

    if (!hasWinner) {
      // Nobody cleared the ${PRIZE_LIKE_THRESHOLD}-like bar this month — per the current Official
      // Rules, no winner is picked and nothing is persisted to prizeWinners for this month.
      const lines = candidates
        .slice(0, 10)
        .map(
          (p, i) =>
            `${i + 1}. ${p.ownerName || "Member"} — ${p.likeCount ?? 0} likes — "${p.title || p.body?.slice(0, 60) || `(${p.type} post)`}"`
        )
        .join("\n");
      await sendSupportEmail(
        `Astryks creative prize — ${monthLabel}: no winner this month`,
        `The top post this month topped out at ${topPost.likeCount ?? 0} likes, short of the ${PRIZE_LIKE_THRESHOLD}-like ` +
          `minimum needed to win — so per the Official Rules, no winner is picked for ${monthLabel} and no ` +
          `AU$${PRIZE_AUD} is paid out.\n\nTop entries for reference:\n${lines}`
      );
      return;
    }

    const winner = topPost;
    let winnerPayout = null;
    try {
      const payoutSnap = await db.doc(`prizePayouts/${winner.id}`).get();
      if (payoutSnap.exists) winnerPayout = payoutSnap.data();
    } catch {
      winnerPayout = null;
    }

    // Persist the winner so the admin "Prize winners" page can track paid status, and so the
    // public leaderboard page can announce it — see getPrizeWinners/getLatestPrizeWinner above.
    await db.doc(`prizeWinners/${monthId}`).set(
      {
        month: monthId,
        monthLabel,
        postId: winner.id,
        ownerId: winner.ownerId,
        ownerName: winner.ownerName || "Member",
        likeCount: winner.likeCount ?? 0,
        title: winner.title || null,
        mediaUrl: winner.type === "photo" ? winner.mediaUrl : null,
        type: winner.type,
        processNote: winner.prizeProcessNote || null,
        processVideoUrl: winner.prizeProcessVideoUrl || null,
        nominees: candidates.slice(0, 10).map((p) => ({
          postId: p.id,
          ownerName: p.ownerName || "Member",
          likeCount: p.likeCount ?? 0,
          processNote: p.prizeProcessNote || null,
          processVideoUrl: p.prizeProcessVideoUrl || null,
        })),
        paid: false,
        paidAt: null,
        payoutHeld: !PRIZE_PAYOUTS_ENABLED,
        // Nothing is ever sent to the actual winner just from this job running — that only
        // happens once you explicitly click "Approve & notify winner" on astryks.com/admin/prizes
        // (see approvePrizeWinnerAnnouncement below). This flag, not payoutHeld, is what the
        // public-facing getLatestPrizeWinner checks before announcing anyone.
        announced: false,
        announcedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const lines = await Promise.all(
      candidates.map(async (p, i) => {
        let email = "unknown";
        try {
          const authUser = await admin.auth().getUser(p.ownerId);
          email = authUser.email || "unknown";
        } catch {
          // Account may have been deleted since — fall back to "unknown".
        }
        const title = p.title || p.body?.slice(0, 60) || `(${p.type} post)`;
        const payoutLine =
          i === 0
            ? winnerPayout
              ? `   Payout details on file (${winnerPayout.method}): ${winnerPayout.details}`
              : "   No payout details on file yet — ask them via Messages, or check the admin Prize winners page."
            : null;
        const processLine = p.prizeProcessNote
          ? `   📝 Their process: "${p.prizeProcessNote}"${p.prizeProcessVideoUrl ? ` (video: ${p.prizeProcessVideoUrl})` : ""}`
          : i === 0
          ? "   ⚠️ No process note shared yet — worth a look before approving, or message them to ask."
          : "   No process note shared.";
        return [
          `${i + 1}. ${p.ownerName || "Member"} (${email}) — ${p.likeCount} likes — "${title}"`,
          `   https://astryks.com/post/${p.id}`,
          payoutLine,
          processLine,
        ]
          .filter(Boolean)
          .join("\n");
      })
    );

    const subscriberCount = await getActiveSubscriberCount();
    const revenueLine =
      `You currently have ${subscriberCount} active subscriber${subscriberCount === 1 ? "" : "s"} (web + mobile). ` +
      `The prize is a flat AU$${PRIZE_AUD}/month regardless of revenue, so check your Stripe/App Store/Play Console ` +
      `dashboards for that month's actual net revenue before deciding whether to pay — PRIZE_PAYOUTS_ENABLED is ` +
      `your manual hold if a given month can't comfortably cover it.`;

    const payoutStatusLine = PRIZE_PAYOUTS_ENABLED
      ? `#1 is this month's winner — AU$${PRIZE_AUD}. Nothing has been sent to them yet and no public announcement ` +
        `has gone out: review the details below — including their process note, so you can confirm this is genuine ` +
        `creative work and not a repost or a meme that just farmed likes — then go to astryks.com/admin/prizes and ` +
        `click "Approve & notify winner" when you're ready. That page also lets you pick a different nominee instead ` +
        `if #1 doesn't hold up. That's what actually emails/messages them the congratulations and lets the ` +
        `public banner show them as the winner — until then, only you know.\nOnce you've sent the AU$${PRIZE_AUD} ` +
        `yourself, mark it paid on that same page. Reminder if they're overseas: transfers from Australia may be ` +
        `subject to market FX rates and international transfer fees — check with your bank/provider before sending.`
      : `⚠️ PAYOUT ON HOLD: PRIZE_PAYOUTS_ENABLED is set to false in functions/index.js, so this winner has been ` +
        `recorded (astryks.com/admin/prizes) but NOT paid and NOT publicly announced yet. This is a manual, ` +
        `deliberate hold — review the winner and the current Official Rules (astryks.com/prize-rules), then flip ` +
        `PRIZE_PAYOUTS_ENABLED to true and approve #1 from astryks.com/admin/prizes when you're ready.`;

    await sendSupportEmail(
      `Astryks creative prize — ${monthLabel}: ${candidates.length} nominee${candidates.length === 1 ? "" : "s"}`,
      `Ranked by likes, for creative posts posted in ${monthLabel} that didn't opt out — the winner needed at ` +
        `least ${PRIZE_LIKE_THRESHOLD} likes to qualify.\n${payoutStatusLine}\n\n${revenueLine}\n\n${lines.join("\n\n")}`
    );
  }
);

// On-demand version of the report above, for when you don't want to wait for the 1st of the
// month. Admin-only (same allowlist as the other admin tools). Goes through every post created
// so far in the CURRENT calendar month, ranks them by likes the same way the automatic monthly
// job does, and emails you the full list — it does NOT persist a prizeWinners record or touch
// PRIZE_PAYOUTS_ENABLED, since the month isn't over yet and this is just a manual check-in.
const _legacy_runPrizeReportNow = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth || !(ADMIN_EMAILS.includes(request.auth.token.email ?? "") && request.auth.token.email_verified === true)) {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLabel = monthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

    const snap = await db
      .collection("posts")
      .where("createdAt", ">=", monthStart)
      .where("createdAt", "<=", now)
      .get();

    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.prizeEligible && !p.prizeOptOut)
      .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));

    if (candidates.length === 0) {
      await sendSupportEmail(
        `Astryks creative prize — ${monthLabel} so far: no qualifying posts yet`,
        `No eligible creative posts in ${monthLabel} (through ${now.toLocaleDateString("en-AU")}) yet.`
      );
      return { count: 0 };
    }

    const lines = await Promise.all(
      candidates.map(async (p, i) => {
        let email = "unknown";
        try {
          const authUser = await admin.auth().getUser(p.ownerId);
          email = authUser.email || "unknown";
        } catch {
          // Account may have been deleted since — fall back to "unknown".
        }
        const title = p.title || p.body?.slice(0, 60) || `(${p.type} post)`;
        return [
          `${i + 1}. ${p.ownerName || "Member"} (${email}) — ${p.likeCount} likes — "${title}"`,
          `   https://astryks.com/post/${p.id}`,
        ].join("\n");
      })
    );

    const subscriberCount = await getActiveSubscriberCount();
    const leader = candidates[0];
    const leaderMeetsThreshold = (leader.likeCount ?? 0) >= PRIZE_LIKE_THRESHOLD;
    const thresholdLine = leaderMeetsThreshold
      ? `The current leader has cleared the ${PRIZE_LIKE_THRESHOLD}-like minimum needed to win.`
      : `⚠️ The current leader has only ${leader.likeCount ?? 0} likes — short of the ${PRIZE_LIKE_THRESHOLD}-like ` +
        `minimum needed to win. If nobody clears that bar by month end, no winner is picked for ${monthLabel}.`;

    await sendSupportEmail(
      `Astryks creative prize — ${monthLabel} so far: ${candidates.length} nominee${candidates.length === 1 ? "" : "s"} ` +
        `(as of ${now.toLocaleDateString("en-AU")})`,
      `Ranked by likes, for creative posts posted in ${monthLabel} through today that didn't opt out — a post ` +
        `needs at least ${PRIZE_LIKE_THRESHOLD} likes to actually win. This is a live snapshot, not the final ` +
        `monthly winner — the automatic report on the 1st of next month is what actually determines and records ` +
        `the winner.\n\n${thresholdLine}\n\n` +
        `The prize is a flat AU$${PRIZE_AUD}/month. You currently have ${subscriberCount} active subscriber` +
        `${subscriberCount === 1 ? "" : "s"} (web + mobile) — check your Stripe/App Store/Play Console dashboards ` +
        `for actual net revenue so far this month as a sanity check.` +
        `\n\n${lines.join("\n\n")}`
    );

    return {
      count: candidates.length,
      leader: leader.ownerName || "Member",
      leaderLikeCount: leader.likeCount ?? 0,
      leaderMeetsThreshold,
      subscriberCount,
    };
  }
);
