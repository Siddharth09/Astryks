"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import LikeButton from "@/components/LikeButton";
import SaveButton from "@/components/SaveButton";
import FollowButton from "@/components/FollowButton";
import ReportModal from "@/components/ReportModal";
import ShareMenu from "@/components/ShareMenu";
import { useResizedImageUrl } from "@/lib/resizedImage";
import { ADMIN_EMAILS } from "@/lib/admin";
import { ensureConversation } from "@/lib/conversations";

const deletePostFn = httpsCallable(functions, "deletePost");
const submitReportFn = httpsCallable(functions, "submitReport");
const addToHallOfFameFn = httpsCallable(functions, "addToHallOfFame");
const removeFromHallOfFameFn = httpsCallable(functions, "removeFromHallOfFame");

export default function PostCard({
  post,
  currentUserId,
  onDeleted,
}: {
  post: any;
  currentUserId: string | null;
  onDeleted?: (postId: string) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [togglingHallOfFame, setTogglingHallOfFame] = useState(false);
  // Optimistic local override so the badge/button updates immediately — `post` is a prop from
  // the parent's feed data, which won't itself refresh until the next reload.
  const [hallOfFameOverride, setHallOfFameOverride] = useState<boolean | null>(null);
  const inHallOfFame = hallOfFameOverride ?? !!post.hallOfFame;
  const isAdmin = user && ADMIN_EMAILS.includes(user.email ?? "");
  const canDelete = user && (user.uid === post.ownerId || isAdmin);
  const displayMediaUrl = useResizedImageUrl(post.type === "photo" ? post.mediaPath : null, post.mediaUrl);

  async function handleReport(reason: string, details: string) {
    await submitReportFn({ targetType: "post", targetId: post.id, reason, details });
  }

  async function handleToggleHallOfFame(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (togglingHallOfFame) return;
    setTogglingHallOfFame(true);
    try {
      if (inHallOfFame) {
        await removeFromHallOfFameFn({ postId: post.id });
        setHallOfFameOverride(false);
      } else {
        await addToHallOfFameFn({ postId: post.id });
        setHallOfFameOverride(true);
      }
    } catch (err: any) {
      alert(err.message ?? "Couldn't update the Hall of Fame.");
    } finally {
      setTogglingHallOfFame(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this post? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deletePostFn({ postId: post.id });
      onDeleted?.(post.id);
    } catch (err: any) {
      alert(err.message ?? "Couldn't delete this post.");
      setDeleting(false);
    }
  }
  const createdDate = post.createdAt?.toDate
    ? post.createdAt.toDate()
    : typeof post.createdAt === "number"
    ? new Date(post.createdAt)
    : new Date();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  async function openConversation() {
    if (!currentUserId || currentUserId === post.ownerId || messaging) return;
    setMessaging(true);
    try {
      const conversationId = await ensureConversation(currentUserId, "You", post.ownerId, post.ownerName);
      router.push(`/messages/${conversationId}`);
    } catch (err: any) {
      // Previously this had no loading state and no error handling at all — a slow network call
      // gave zero feedback (looked like the click didn't register), and any failure was silently
      // swallowed with the button left in its normal, clickable-again state but no explanation.
      alert(err.message ?? "Couldn't open that conversation — please try again.");
      setMessaging(false);
    }
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <article className="card overflow-hidden">
      <Link href={`/post/${post.id}`}>
        {post.type === "video" && post.bunnyVideoId && (
          <iframe
            src={`https://iframe.mediadelivery.net/embed/${post.bunnyLibraryId}/${post.bunnyVideoId}`}
            className="w-full aspect-video bg-ink"
            style={{ border: "none" }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen
          />
        )}
        {post.type === "video" && !post.bunnyVideoId && (
          <div className="relative">
            <video
              ref={videoRef}
              src={post.mediaUrl}
              className="w-full aspect-video bg-ink object-cover"
              loop
              muted={muted}
              playsInline
              preload="metadata"
            />
            <button
              onClick={(e) => {
                e.preventDefault();
                setMuted((m) => !m);
              }}
              className="absolute bottom-2 right-2 bg-black/50 text-white text-xs rounded-full w-7 h-7 flex items-center justify-center"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        )}
        {post.type === "photo" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayMediaUrl} alt={post.title || "Post"} loading="lazy" className="w-full aspect-video object-cover bg-ink" />
        )}
        {post.type === "text" && (
          <p className="font-display text-lg font-bold p-4 whitespace-pre-wrap">{post.body}</p>
        )}
        {post.type === "link" && (
          // Compact card, not a full-size banner — photos/videos are the "large" content in the
          // feed (Instagram-style), and a shared link is a small aside next to that, not a
          // same-size peer. Fixed small thumbnail + title/domain in a row.
          <div className="flex items-center gap-3 p-3">
            {post.linkImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.linkImage} alt="" loading="lazy" className="w-16 h-16 rounded-lg object-cover bg-ink flex-shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-brandLight flex items-center justify-center text-2xl flex-shrink-0">
                🔗
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-ink/50 truncate">{post.linkDomain}</p>
              <p className="text-sm font-medium truncate">{post.linkTitle || post.linkUrl}</p>
            </div>
          </div>
        )}
      </Link>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-ink/50">
          <Link href={`/user/${post.ownerId}`} className="hover:text-ink hover:underline">
            {post.ownerName ?? "Member"}
          </Link>
          <span>·</span>
          <time>{createdDate.toLocaleDateString()}</time>
          <FollowButton targetUserId={post.ownerId} currentUserId={currentUserId} />
          {currentUserId && currentUserId !== post.ownerId && (
            <button onClick={openConversation} disabled={messaging} className="text-xs text-ink/40 hover:text-ink disabled:opacity-50">
              {messaging ? "Opening…" : "Message"}
            </button>
          )}
          {currentUserId && currentUserId !== post.ownerId && (
            <button onClick={() => setReportOpen(true)} className="text-xs text-ink/40 hover:text-ink">
              Report
            </button>
          )}
          {isAdmin && (post.type === "photo" || post.type === "video") && (
            <button
              onClick={handleToggleHallOfFame}
              disabled={togglingHallOfFame}
              className="text-xs hover:underline flex-shrink-0 disabled:opacity-50"
            >
              {togglingHallOfFame ? "…" : inHallOfFame ? "Remove from Hall of Fame" : "🏛️ Add to Hall of Fame"}
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="ml-auto text-xs text-red-600 hover:underline flex-shrink-0"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
        {post.title && (
          <Link href={`/post/${post.id}`}>
            <h2 className="font-display text-lg font-semibold mb-1">{post.title}</h2>
          </Link>
        )}
        <div className="flex items-center gap-4 text-sm text-ink/50">
          <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={currentUserId} postOwnerId={post.ownerId} />
          <Link href={`/post/${post.id}`} className="hover:text-ink">
            💬 {post.commentCount ?? 0}
          </Link>
          <SaveButton postId={post.id} currentUserId={currentUserId} />
          <div className="ml-auto flex items-center gap-3">
            {inHallOfFame && (
              <span className="text-xs text-ink/50" title="Featured in the Hall of Fame">
                🏛️ Hall of Fame
              </span>
            )}
            <ShareMenu postId={post.id} title={post.title} />
          </div>
        </div>
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
    </article>
  );
}
