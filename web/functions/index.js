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

// Same pattern, for the automated creative-prize nomination messages.
const PRIZE_BOT_UID = "astryks-prizes";
const PRIZE_BOT_NAME = "Astryks Prizes";

// Flat monthly prize amount — a fixed commitment regardless of that month's subscription
// revenue. Entry stays free for any account either way (see nominateForPrize below for why
// that matters); PRIZE_PAYOUTS_ENABLED below is the actual safety valve if a given month's
// revenue doesn't comfortably cover this.
const PRIZE_AUD = 1000;

// Kill switch for actually paying out the Creative Prize. The like-tracking, leaderboard, and
// monthly winner-selection logic all keep running regardless (so you can see the mechanism
// work end to end) — this only gates the messaging that promises a specific payment, and
// flags every winner record as held. Entry is free for any account (see nominateForPrize),
// which is what keeps the promotion compliant broadly across AU/US/UK/Canada without needing
// per-jurisdiction legal sign-off — but manual review before any real money moves is still
// good practice regardless. Flip to `true` once you've done a final check of the current
// Official Rules (app/prize-rules) against local law and are ready to announce/pay winners.
const PRIZE_PAYOUTS_ENABLED = false;

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

// Marks a brand-new photo/video post eligible for that month's creative prize the moment
// it's posted, and notifies the owner with a way to opt themselves back out. There's no
// minimum like count to qualify — every creative post is automatically in the running from
// the start, and the winner is simply whichever eligible post has the most likes at month end.
//
// IMPORTANT: entry/winning is NOT gated behind a subscription — this is deliberate, not an
// oversight. A paid-subscribers-only, popularity-vote-decided cash prize is legally risky
// (the "prize + chance + consideration" test for an unlawful lottery) in Australia, the US,
// the UK, and Canada alike — see chat history around Aug 2026 for the full research, including
// the Xclusive/LMCT+ unlawful-lottery conviction (SA, March 2026) for a subscription-gated
// prize model. Keeping entry free for any account (and requiring no minimum number of
// subscriber likes either) is what keeps this compliant everywhere at once, without needing
// per-jurisdiction legal review. Do not re-add a subscription requirement, or a "likes must
// come from subscribers" requirement, without redoing that legal review first — both
// reintroduce the same consideration problem, just attached to a different party.
async function nominateForPrize(postId, post) {
  await db.doc(`posts/${postId}`).set(
    { prizeEligible: true, prizeNominatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  await sendPrizeBotMessage(
    post.ownerId,
    post.ownerName,
    `🎉 Your post is officially entered into this month's Astryks Creative Prize — AU$${PRIZE_AUD}! Just one ` +
      `winner is picked each month across every subject (music, art, or anything else) — whoever's entry has ` +
      `the most likes at the end of the month takes it, no minimum likes required to qualify. If you'd rather ` +
      `not be entered, just tap "Opt out" below. You can also share your payout details (bank transfer or PayID) ` +
      `right here now, so we're ready to send the cash instantly if you win — note that international transfers ` +
      `from Australia may be subject to market FX rates and other overseas transfer considerations.`,
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
    if (!ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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

    if (lesson.bunnyVideoId) {
      try {
        await fetch(
          `https://video.bunnycdn.com/library/${lesson.bunnyLibraryId}/videos/${lesson.bunnyVideoId}`,
          { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY.value() } }
        );
      } catch {
        // If Bunny cleanup fails, still proceed with removing the lesson itself.
      }
    }

    // Clean up everyone's progress records for this lesson too.
    const progressSnap = await db.collection("lessonProgress").where("lessonId", "==", lessonId).get();
    const batch = db.batch();
    progressSnap.docs.forEach((d) => batch.delete(d.ref));
    if (!progressSnap.empty) await batch.commit();

    await lessonRef.delete();
    return { ok: true };
  }
);

// ---------- Callable: delete a post (owner or admin), cleaning up Bunny/Storage too ----------

// Shared cleanup used by both deletePost (single post) and deleteUserAccount (all of a user's posts).
async function deletePostInternal(postRef, post, bunnyApiKey) {
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
        { method: "DELETE", headers: { AccessKey: bunnyApiKey } }
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
    const isAdmin = ADMIN_EMAILS.includes(request.auth.token.email ?? "");

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

exports.submitReport = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
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

  await db.collection("reports").add({
    targetType,
    targetId,
    postId: postId ?? null,
    reason: safeReason,
    details: typeof details === "string" ? details.slice(0, 1000) : "",
    reporterId: request.auth.uid,
    reporterName: request.auth.token.name ?? "Member",
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.getReports = onCall(async (request) => {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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
      const report = { id: d.id, ...d.data() };
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
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID] },
  async (request) => {
    if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
      throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
    }
    const { reportId, action } = request.data ?? {};
    if (!reportId || !["delete", "dismiss"].includes(action)) {
      throw new HttpsError("invalid-argument", "reportId and a valid action are required.");
    }

    const reportRef = db.doc(`reports/${reportId}`);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      throw new HttpsError("not-found", "This report no longer exists.");
    }
    const report = reportSnap.data();

    if (action === "delete") {
      if (report.targetType === "post") {
        const postRef = db.doc(`posts/${report.targetId}`);
        const postSnap = await postRef.get();
        if (postSnap.exists) {
          await deletePostInternal(postRef, postSnap.data(), BUNNY_API_KEY.value());
        }
      } else if (report.targetType === "comment") {
        const commentRef = db.doc(`posts/${report.postId}/comments/${report.targetId}`);
        const commentSnap = await commentRef.get();
        if (commentSnap.exists) {
          await commentRef.delete();
          await db.doc(`posts/${report.postId}`).update({ commentCount: admin.firestore.FieldValue.increment(-1) });
        }
      }
      // Reported users aren't auto-deleted — an admin reviews their profile/posts directly.
    }

    await reportRef.update({
      status: "resolved",
      resolvedAction: action,
      resolvedBy: request.auth.token.email,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);

// ---------- Callable: let a post's owner opt themselves out of the creative prize ----------

exports.optOutOfPrize = onCall(async (request) => {
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

// ---------- Callable: this month's top creative posts, for the in-app leaderboard ----------
// Scoped to posts created since the start of the current calendar month (mirrors the monthly
// report's "this month's own posts only" rule) — a client can't list-query `posts` directly
// (see the comment above `reports`), so this reads with the Admin SDK and returns just the
// public fields a leaderboard needs.

exports.getPrizeLeaderboard = onCall(async (request) => {
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
        eligible: !!p.prizeEligible,
      };
    })
  );

  return { leaderboard };
});

// ---------- Callable: last completed month's creative-prize winner, for the public banner ----------

exports.getLatestPrizeWinner = onCall(async () => {
  // Skip any winner whose payout is on hold (see PRIZE_PAYOUTS_ENABLED) — don't publicly
  // announce a cash prize we haven't actually confirmed we can legally pay out yet. Look back
  // a few months in case the most recent one (or several) are held.
  const snap = await db.collection("prizeWinners").orderBy("month", "desc").limit(6).get();
  const winnerDoc = snap.docs.find((d) => !d.data().payoutHeld);
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

exports.submitPrizePayoutDetails = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
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
  return { ok: true };
});

// ---------- Callable: admin-only — every month's creative-prize winner + payout/paid status ----------

exports.getPrizeWinners = onCall(async (request) => {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
    throw new HttpsError("permission-denied", "This action is for the Astryks team only.");
  }
  const snap = await db.collection("prizeWinners").orderBy("month", "desc").limit(60).get();
  const winners = await Promise.all(
    snap.docs.map(async (d) => {
      const w = { id: d.id, ...d.data() };
      let payout = null;
      let countryCode = null;
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
      return { ...w, payout, countryCode };
    })
  );
  return { winners };
});

// ---------- Callable: admin-only — mark a month's prize as paid (or undo that) ----------

exports.markPrizeWinnerPaid = onCall(async (request) => {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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

// ---------- Shared: permanently delete a uid's posts, edges, and account ----------
//
// Used by both the admin tool (deleteUserAccount, by email) and the self-service
// "Delete my account" button (deleteMyAccount, deletes the caller's own uid) — this is also
// what App Store/Play Store now require: an in-app path for a user to delete their own
// account and data, not just an admin-only tool.
async function deleteAccountInternal(uid, bunnyApiKey) {
  // Delete all of this user's posts, with the same cleanup deletePost does for each one.
  const postsSnap = await db.collection("posts").where("ownerId", "==", uid).get();
  for (const postDoc of postsSnap.docs) {
    await deletePostInternal(postDoc.ref, postDoc.data(), bunnyApiKey);
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

  // Delete their Firestore user doc, then their actual login.
  await db.doc(`users/${uid}`).delete();
  await admin.auth().deleteUser(uid);
}

// ---------- Callable: admin-only — permanently delete a user's account and their content ----------

exports.deleteUserAccount = onCall(
  { secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    if (!ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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

    await deleteAccountInternal(targetUser.uid, BUNNY_API_KEY.value());
    return { ok: true, deletedUid: targetUser.uid };
  }
);

// ---------- Callable: self-service — a user permanently deletes their own account ----------
//
// Required by Google Play's Data Safety policy (and good practice generally): anyone who can
// create an account in-app must also be able to delete it and their data in-app, without
// having to email support. Web: called from app/me/page.tsx. Mobile: called from
// app/(tabs)/me.tsx.
exports.deleteMyAccount = onCall({ secrets: [BUNNY_API_KEY, BUNNY_LIBRARY_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await deleteAccountInternal(request.auth.uid, BUNNY_API_KEY.value());
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

function isVisibleTo(post, callerUid) {
  return post.visibility !== "private" || post.ownerId === callerUid;
}

exports.getFeed = onCall(async (request) => {
  const callerUid = request.auth?.uid || null;
  const snap = await db.collection("posts").orderBy("createdAt", "desc").get();
  const posts = snap.docs.map(serializePost).filter((p) => isVisibleTo(p, callerUid));
  return { posts };
});

exports.getUserPosts = onCall(async (request) => {
  const callerUid = request.auth?.uid || null;
  const userId = request.data?.userId;
  if (!userId) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }
  const isAdmin = ADMIN_EMAILS.includes(request.auth?.token?.email ?? "");

  const snap = await db
    .collection("posts")
    .where("ownerId", "==", userId)
    .where("type", "in", ["photo", "video"])
    .orderBy("createdAt", "desc")
    .get();

  const posts = snap.docs
    .map(serializePost)
    .filter((p) => p.visibility !== "private" || p.ownerId === callerUid || isAdmin);
  return { posts };
});

// One-time maintenance callable: older posts (created before the public/private
// toggle existed) have no `visibility` field at all. The app already treats a
// missing field as "public" everywhere, so this just makes that explicit in the
// data itself. Safe to run more than once — it's a no-op once every post has
// the field set. Admin-only; trigger it once from the browser console
// (see the note in the delivery message) rather than exposing it in the UI.
exports.backfillPostVisibility = onCall(async (request) => {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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
  const uid = request.auth.uid;

  const [lessonsSnap, progressSnap, convosSnap, usersSnap] = await Promise.all([
    db.collection("lessons").get(),
    db.collection("lessonProgress").get(),
    db.collection("conversations").where("participants", "array-contains", uid).get(),
    db.collection("users").limit(200).get(),
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

  const candidates = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.id !== uid && !alreadyMessaging.has(u.id));

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

// ---------- Trigger: enter every new creative post into that month's prize ----------
// Fires immediately on post creation (not on reaching any like count — see nominateForPrize's
// comment for why there's no minimum). Scoped to actual creative uploads (photo/video) — plain
// text posts and shared links don't count, since the prize is specifically for creative work.
exports.onPostCreated = onDocumentCreated("posts/{postId}", async (event) => {
  const postId = event.params.postId;
  const post = event.data?.data();
  if (!post || !["photo", "video"].includes(post.type) || post.prizeOptOut) return;
  await nominateForPrize(postId, post);
});

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

// Shared secret you set in the Qonversion dashboard (Project Settings > Integrations >
// Webhooks > "Header Authorization-Token Value") so we can confirm a webhook call really came
// from Qonversion and not just anyone who found this URL. Qonversion sends this back verbatim
// in an `Authorization: Basic <token>` header — note it's NOT base64-encoded the way real HTTP
// Basic auth normally is, it's just their chosen header format for a plain shared secret.
const qonversionWebhookAuth = defineSecret("QONVERSION_WEBHOOK_AUTH");

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
      // Required (not just "auto") so every subscriber's billing country is captured —
      // the webhook below saves it as the authoritative countryCode on their profile.
      // If the Price this Product uses has per-currency amounts configured in the Stripe
      // dashboard (Product → Price → "Add another currency"), Checkout automatically shows
      // and charges in that local currency based on the same billing details — no extra
      // code needed here for that part.
      billing_address_collection: "required",
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
  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Basic ${qonversionWebhookAuth.value()}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  const event = req.body || {};
  const uid = event.custom_user_id || event.user_id;
  if (!uid) {
    res.status(400).send("Missing custom_user_id/user_id");
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
    await db.doc(`users/${uid}`).set({ subscriptionStatus: "canceled" }, { merge: true });
  }

  res.json({ received: true });
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

// ---------- Scheduled: email the admin the previous month's creative-prize nominees ----------
//
// Fires the morning of the 1st of every month. Looks at posts CREATED during the month that
// just ended (not just "posts with 50+ likes right now") so a popular older post can't keep
// "winning" every month forever — each month's draw is scoped to that month's own posts.
// This only ever emails a ranked candidate list; picking the actual winner and sending the
// AU$1,000 is still a manual step for the admin, same as the referral payouts above.
exports.sendMonthlyPrizeReport = onSchedule(
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

    const winner = candidates[0];
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
        nominees: candidates.slice(0, 10).map((p) => ({
          postId: p.id,
          ownerName: p.ownerName || "Member",
          likeCount: p.likeCount ?? 0,
        })),
        paid: false,
        paidAt: null,
        payoutHeld: !PRIZE_PAYOUTS_ENABLED,
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
        return [
          `${i + 1}. ${p.ownerName || "Member"} (${email}) — ${p.likeCount} likes — "${title}"`,
          `   https://astryks.com/post/${p.id}`,
          payoutLine,
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
      ? `#1 is this month's winner — send them AU$${PRIZE_AUD}. It's now tracked on astryks.com/admin/prizes so ` +
        `you can mark it paid.\nReminder if they're overseas: transfers from Australia may be subject to market ` +
        `FX rates and international transfer fees — check with your bank/provider before sending.`
      : `⚠️ PAYOUT ON HOLD: PRIZE_PAYOUTS_ENABLED is set to false in functions/index.js, so this winner has been ` +
        `recorded (astryks.com/admin/prizes) but NOT paid and NOT publicly announced yet. This is a manual, ` +
        `deliberate hold — review the winner and the current Official Rules (astryks.com/prize-rules), then flip ` +
        `PRIZE_PAYOUTS_ENABLED to true and announce/pay #1 when you're ready.`;

    await sendSupportEmail(
      `Astryks creative prize — ${monthLabel}: ${candidates.length} nominee${candidates.length === 1 ? "" : "s"}`,
      `Ranked by likes, for creative posts posted in ${monthLabel} that didn't opt out — no minimum like count ` +
        `required to qualify.\n${payoutStatusLine}\n\n${revenueLine}\n\n${lines.join("\n\n")}`
    );
  }
);

// On-demand version of the report above, for when you don't want to wait for the 1st of the
// month. Admin-only (same allowlist as the other admin tools). Goes through every post created
// so far in the CURRENT calendar month, ranks them by likes the same way the automatic monthly
// job does, and emails you the full list — it does NOT persist a prizeWinners record or touch
// PRIZE_PAYOUTS_ENABLED, since the month isn't over yet and this is just a manual check-in.
exports.runPrizeReportNow = onCall(
  { secrets: [SUPPORT_EMAIL_USER, SUPPORT_EMAIL_PASS, SUPPORT_EMAIL_TO] },
  async (request) => {
    if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email ?? "")) {
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

    await sendSupportEmail(
      `Astryks creative prize — ${monthLabel} so far: ${candidates.length} nominee${candidates.length === 1 ? "" : "s"} ` +
        `(as of ${now.toLocaleDateString("en-AU")})`,
      `Ranked by likes, for creative posts posted in ${monthLabel} through today that didn't opt out — no minimum ` +
        `like count required to qualify. This is a live snapshot, not the final monthly winner — the automatic ` +
        `report on the 1st of next month is what actually determines and records the winner.\n\n` +
        `The prize is a flat AU$${PRIZE_AUD}/month. You currently have ${subscriberCount} active subscriber` +
        `${subscriberCount === 1 ? "" : "s"} (web + mobile) — check your Stripe/App Store/Play Console dashboards ` +
        `for actual net revenue so far this month as a sanity check.` +
        `\n\n${lines.join("\n\n")}`
    );

    return { count: candidates.length, leader: candidates[0].ownerName || "Member", subscriberCount };
  }
);
