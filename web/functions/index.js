const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const BUNNY_API_KEY = defineSecret("BUNNY_API_KEY");
const BUNNY_LIBRARY_ID = defineSecret("BUNNY_LIBRARY_ID");

// Update with the email(s) allowed to do admin-only things: delete anyone's post,
// upload lessons/trailers.
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

// A fixed pseudo-account representing Astryks support in the Messages UI.
// It's not a real Firebase Auth user — just a shared participant ID so the
// existing conversations/messages schema can be reused as-is.
const SUPPORT_UID = "astryks-support";

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
    if (!ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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

exports.fetchLinkPreview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const url = request.data?.url;
  if (!url || !/^https?:\/\//.test(url)) {
    throw new HttpsError("invalid-argument", "A valid URL is required.");
  }

  let html = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AstryksBot/1.0)" },
    });
    html = await res.text();
  } catch {
    return { title: url, image: null, domain: new URL(url).hostname };
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

  return { title: title.slice(0, 200), image, domain: new URL(url).hostname };
});

// ---------- Callable: record daily activity (post created or lesson completed) ----------

exports.bumpStreak = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await bumpStreakInternal(request.auth.uid);
  return { ok: true };
});

// ---------- Callable: mark a lesson complete ----------

exports.completeLesson = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  const lessonId = request.data?.lessonId;
  if (!lessonId) {
    throw new HttpsError("invalid-argument", "lessonId is required.");
  }

  const progressRef = db.doc(`lessonProgress/${request.auth.uid}_${lessonId}`);
  await progressRef.set({
    uid: request.auth.uid,
    lessonId,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await bumpStreakInternal(request.auth.uid);
  return { ok: true };
});

// ---------- Callable: delete a post (owner or admin), cleaning up Bunny/Storage too ----------

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
    const isAdmin = ADMIN_EMAILS.includes(request.auth.token.email ?? "");

    if (!isOwner && !isAdmin) {
      throw new HttpsError("permission-denied", "You can only delete your own posts.");
    }

    // Clean up likes and comments subcollections.
    for (const sub of ["likes", "comments"]) {
      const subSnap = await postRef.collection(sub).get();
      const batch = db.batch();
      subSnap.docs.forEach((d) => batch.delete(d.ref));
      if (!subSnap.empty) await batch.commit();
    }

    // Clean up the underlying video on Bunny, if this was a lesson-style upload.
    if (post.bunnyVideoId) {
      try {
        await fetch(
          `https://video.bunnycdn.com/library/${post.bunnyLibraryId}/videos/${post.bunnyVideoId}`,
          { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY.value() } }
        );
      } catch {
        // If Bunny cleanup fails, still proceed with removing the post itself.
      }
    }

    // Clean up the file in Firebase Storage, for photo/video posts uploaded there.
    if (post.mediaPath) {
      try {
        await admin.storage().bucket().file(post.mediaPath).delete();
      } catch {
        // File may already be gone — not fatal.
      }
    }

    await postRef.delete();
    return { ok: true };
  }
);



exports.onLikeCreated = onDocumentCreated("posts/{postId}/likes/{userId}", async (event) => {
  const { postId, userId } = event.params;
  const postSnap = await db.doc(`posts/${postId}`).get();
  if (!postSnap.exists) return;

  const post = postSnap.data();
  if (post.ownerId === userId) return;

  const likerSnap = await db.doc(`users/${userId}`).get();
  const likerName = likerSnap.data()?.displayName || "Someone";

  await sendPush(post.ownerId, "New like", `${likerName} liked "${post.title || "your post"}"`);
});

// ---------- Trigger: push notification when someone comments on your post ----------

exports.onCommentCreated = onDocumentCreated("posts/{postId}/comments/{commentId}", async (event) => {
  const { postId } = event.params;
  const comment = event.data.data();
  const postSnap = await db.doc(`posts/${postId}`).get();
  if (!postSnap.exists) return;

  const post = postSnap.data();
  if (post.ownerId === comment.userId) return;

  await sendPush(
    post.ownerId,
    "New comment",
    `${comment.userName || "Someone"}: ${comment.body}`.slice(0, 120)
  );
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
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePriceId = defineSecret("STRIPE_PRICE_ID");

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

exports.createCheckoutSession = onCall(
  { secrets: [stripeSecret, stripePriceId] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "You must be logged in.");
    const stripe = Stripe(stripeSecret.value());
    const uid = request.auth.uid;
    const referralCode = (request.data?.referralCode || "").toUpperCase().trim() || null;

    let discounts = [];
    let referrerUid = null;

    if (referralCode) {
      const codeSnap = await db.doc(`referralCodes/${referralCode}`).get();
      if (codeSnap.exists && codeSnap.data().uid !== uid) {
        referrerUid = codeSnap.data().uid;
        // A Stripe Coupon with the exact ID "REFERRAL20" — 20% off, repeating for 3 months —
        // must be created once in the Stripe dashboard (Product catalog → Coupons).
        discounts = [{ coupon: "REFERRAL20" }];
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripePriceId.value(), quantity: 1 }],
      discounts,
      client_reference_id: uid,
      metadata: { uid, referrerUid: referrerUid || "" },
      success_url: request.data?.successUrl,
      cancel_url: request.data?.cancelUrl,
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
      return_url: request.data?.returnUrl,
    });
    return { url: portal.url };
  }
);

// ---------- Webhook: Stripe tells us about subscription changes ----------

exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = Stripe(stripeSecret.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], stripeWebhookSecret.value());
    } catch (err) {
      res.status(400).send(`Webhook signature error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;
      const referrerUid = session.metadata?.referrerUid;

      await db.doc(`users/${uid}`).set(
        {
          subscriptionStatus: "active",
          stripeCustomerId: session.customer,
          subscriptionStartDate: admin.firestore.FieldValue.serverTimestamp(),
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
    }

    if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const isActive = sub.status === "active" || sub.status === "trialing";
      const usersSnap = await db.collection("users").where("stripeCustomerId", "==", sub.customer).limit(1).get();
      if (!usersSnap.empty) {
        await usersSnap.docs[0].ref.set(
          { subscriptionStatus: isActive ? "active" : "canceled" },
          { merge: true }
        );
      }
    }

    res.json({ received: true });
  }
);

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

    await db.doc(`users/${ref.referrerUid}`).set({ payoutOwed: admin.firestore.FieldValue.increment(50) }, { merge: true });
    await refDoc.ref.set({ paid: true, payoutMarkedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
