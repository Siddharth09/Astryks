"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, query, where, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";
import FollowButton from "@/components/FollowButton";
import ReportModal from "@/components/ReportModal";
import { ensureConversation } from "@/lib/conversations";

const getUserPosts = httpsCallable(functions, "getUserPosts");
const submitReportFn = httpsCallable(functions, "submitReport");
const getPublicProfile = httpsCallable(functions, "getPublicProfile");
const blockUserFn = httpsCallable(functions, "blockUser");
const unblockUserFn = httpsCallable(functions, "unblockUser");

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const { user: currentUser, loading: authLoading } = useRequireAuth();
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [postsBlocked, setPostsBlocked] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const isBlocked = postsBlocked || !!profile?.blockedByMe || !!profile?.blockedMe;

  async function handleReportUser(reason: string, details: string) {
    await submitReportFn({ targetType: "user", targetId: params.userId, reason, details });
  }

  useEffect(() => {
    if (!currentUser) return;
    // Viewing your own profile? Just send them to the full /me page instead.
    if (params.userId === currentUser.uid) {
      router.replace("/me");
      return;
    }
    (async () => {
      // Fetched via a Cloud Function rather than a direct getDoc: firestore.rules restricts
      // users/{uid} reads to that document's own owner (it also holds stripeCustomerId/
      // subscriptionStatus/payoutOwed), so viewing someone else's profile goes through
      // getPublicProfile instead, which only ever returns displayName/photoURL.
      let profileData: any;
      try {
        const result = await getPublicProfile({ uid: params.userId });
        profileData = result.data;
      } catch (err) {
        setMissing(true);
        setLoading(false);
        return;
      }
      setProfile(profileData);

      // Fetched via a Cloud Function rather than a direct Firestore query: Firestore security
      // rules can't filter a list query, so hiding this person's private posts from anyone but
      // themselves (or an admin) has to happen server-side with the Admin SDK.
      const [result, followersSnap, followingSnap] = await Promise.all([
        getUserPosts({ userId: params.userId }),
        getDocs(query(collection(db, "follows"), where("followingId", "==", params.userId))),
        getDocs(query(collection(db, "follows"), where("followerId", "==", params.userId))),
      ]);
      const postsData = result.data as any;
      setPosts(postsData.posts);
      setPostsBlocked(!!postsData.blocked);
      setFollowerCount(followersSnap.size);
      setFollowingCount(followingSnap.size);
      setLoading(false);
    })();
  }, [currentUser, params.userId, router]);

  async function handleBlock() {
    setBlocking(true);
    setBlockError(null);
    try {
      await blockUserFn({ targetUid: params.userId });
      setProfile((p: any) => ({ ...p, blockedByMe: true }));
      setShowBlockConfirm(false);
    } catch (err: any) {
      setBlockError(err.message ?? "Couldn't block this account. Please try again.");
    } finally {
      setBlocking(false);
    }
  }

  async function handleUnblock() {
    if (blocking) return;
    setBlocking(true);
    try {
      await unblockUserFn({ targetUid: params.userId });
      setProfile((p: any) => ({ ...p, blockedByMe: false }));
      // Posts were hidden while blocked, so pull them again now that they may be visible.
      const result = await getUserPosts({ userId: params.userId });
      const postsData = result.data as any;
      setPosts(postsData.posts);
      setPostsBlocked(!!postsData.blocked);
    } catch (err: any) {
      alert(err.message ?? "Couldn't unblock this account. Please try again.");
    } finally {
      setBlocking(false);
    }
  }

  async function openConversation() {
    if (!currentUser || messaging) return;
    setMessaging(true);
    try {
      const conversationId = await ensureConversation(
        currentUser.uid,
        "You",
        params.userId,
        profile?.displayName ?? "Member"
      );
      router.push(`/messages/${conversationId}`);
    } catch (err: any) {
      // Previously `messaging` was never reset on failure, so the button got stuck disabled on
      // "Opening…" forever after any error (permission hiccup, network blip) — identical failure
      // mode to the Subscribe-button bug fixed earlier tonight.
      alert(err.message ?? "Couldn't open that conversation — please try again.");
      setMessaging(false);
    }
  }

  if (authLoading || loading) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  if (missing) {
    return <p className="text-ink/50 text-center py-16">This person's profile couldn't be found.</p>;
  }

  return (
    <div className="pb-16">
      <PageBackground color="#ECE8F7" />
      <div className="flex items-center gap-5 mb-5">
        {profile.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photoURL} alt="" className="w-20 h-20 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-medium flex-shrink-0"
            style={{ background: "#E85D5D" }}
          >
            {(profile.displayName ?? "M")[0]}
          </div>
        )}
        <div className="flex-1 flex justify-around text-center">
          <div>
            <p className="font-display text-lg font-semibold">{posts.length}</p>
            <p className="text-xs text-ink/50">Posts</p>
          </div>
          <div>
            <p className="font-display text-lg font-semibold">{followerCount}</p>
            <p className="text-xs text-ink/50">Followers</p>
          </div>
          <div>
            <p className="font-display text-lg font-semibold">{followingCount}</p>
            <p className="text-xs text-ink/50">Following</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="font-display text-lg font-semibold truncate">{profile.displayName ?? "Member"}</p>
        <div className="flex items-center gap-3 flex-shrink-0">
          {profile.blockedByMe ? (
            <button onClick={handleUnblock} disabled={blocking} className="text-xs text-ink/40 hover:text-ink">
              {blocking ? "…" : "Unblock"}
            </button>
          ) : profile.blockedMe ? (
            <span className="text-xs text-ink/30">Blocked you</span>
          ) : (
            <button onClick={() => setShowBlockConfirm(true)} className="text-xs text-ink/40 hover:text-ink">
              Block
            </button>
          )}
          <button onClick={() => setReportOpen(true)} className="text-xs text-ink/40 hover:text-ink">
            Report
          </button>
        </div>
      </div>

      {showBlockConfirm && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 mb-4">
          <p className="font-medium mb-1">Block {profile.displayName ?? "this account"}?</p>
          <p className="mb-3">
            You won't see each other's posts, and you won't be able to message each other. You can
            unblock them anytime.
          </p>
          {blockError && <p className="text-red-700 mb-2">{blockError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleBlock}
              disabled={blocking}
              className="rounded-lg bg-red-600 text-white text-xs font-medium px-3 py-1.5"
            >
              {blocking ? "Blocking…" : "Yes, block"}
            </button>
            <button
              onClick={() => setShowBlockConfirm(false)}
              disabled={blocking}
              className="rounded-lg border border-ink/15 text-xs px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isBlocked && (
        <div className="flex gap-2 mb-8">
          <FollowButton
            targetUserId={params.userId}
            currentUserId={currentUser?.uid ?? null}
            className="flex-1 text-sm py-2"
          />
          <button
            onClick={openConversation}
            disabled={messaging}
            className="btn-secondary flex-1 text-sm py-2"
          >
            {messaging ? "Opening…" : "Message"}
          </button>
        </div>
      )}
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReportUser} />

      <div className="border-t border-line/10 pt-5">
        {isBlocked ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="w-16 h-16 rounded-full border-2 border-ink/15 flex items-center justify-center text-2xl text-ink/30">
              🚫
            </div>
            <p className="text-ink/50 text-sm font-medium px-6">
              {profile.blockedByMe
                ? "You've blocked this account — you won't see each other's posts or be able to message."
                : "This account has blocked you — you won't see each other's posts or be able to message."}
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14">
            <div className="w-16 h-16 rounded-full border-2 border-ink/15 flex items-center justify-center text-2xl text-ink/30">
              📷
            </div>
            <p className="text-ink/50 text-sm font-medium">No shared posts</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {posts.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/post/${p.id}`)}
                className="aspect-square rounded-lg overflow-hidden bg-ink flex items-center justify-center"
              >
                {p.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-xl">▶</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
