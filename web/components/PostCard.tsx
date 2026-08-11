"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import LikeButton from "@/components/LikeButton";
import SaveButton from "@/components/SaveButton";
import FollowButton from "@/components/FollowButton";
import ReportModal from "@/components/ReportModal";
import PrizeInfoModal from "@/components/PrizeInfoModal";
import ShareMenu from "@/components/ShareMenu";

const deletePostFn = httpsCallable(functions, "deletePost");
const submitReportFn = httpsCallable(functions, "submitReport");
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

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
  const [prizeOpen, setPrizeOpen] = useState(false);
  const canDelete = user && (user.uid === post.ownerId || ADMIN_EMAILS.includes(user.email ?? ""));

  async function handleReport(reason: string, details: string) {
    await submitReportFn({ targetType: "post", targetId: post.id, reason, details });
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
    if (!currentUserId || currentUserId === post.ownerId) return;
    const conversationId = [currentUserId, post.ownerId].sort().join("_");
    const ref = doc(db, "conversations", conversationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [currentUserId, post.ownerId].sort(),
        participantNames: [currentUserId, post.ownerId].sort().map((id) => (id === post.ownerId ? post.ownerName : "You")),
        lastMessage: "",
        lastMessageAt: new Date(),
      });
    }
    router.push(`/messages/${conversationId}`);
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
          <img src={post.mediaUrl} alt={post.title || "Post"} className="w-full aspect-video object-cover bg-ink" />
        )}
        {post.type === "text" && (
          <p className="font-display text-lg font-bold p-4 whitespace-pre-wrap">{post.body}</p>
        )}
        {post.type === "link" && (
          // Full-width preview banner (same aspect ratio as photo/video posts) instead of a
          // small 56px thumbnail crammed next to the title — this is what makes a shared YouTube
          // link actually read as a proper preview card rather than a bookmark-list row.
          <div>
            {post.linkImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.linkImage} alt="" className="w-full aspect-video object-cover bg-ink" />
            ) : (
              <div className="w-full aspect-video bg-brandLight flex items-center justify-center text-4xl">
                🔗
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-line/10">
              <div className="min-w-0">
                <p className="text-xs text-ink/50 truncate">{post.linkDomain}</p>
                <p className="text-sm font-medium truncate">{post.linkTitle || post.linkUrl}</p>
              </div>
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
            <button onClick={openConversation} className="text-xs text-ink/40 hover:text-ink">
              Message
            </button>
          )}
          {currentUserId && currentUserId !== post.ownerId && (
            <button onClick={() => setReportOpen(true)} className="text-xs text-ink/40 hover:text-ink">
              Report
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
            {(post.type === "photo" || post.type === "video") && (
              <button onClick={() => setPrizeOpen(true)} className="hover:text-ink" title="Creative prize">
                🏆
              </button>
            )}
            <ShareMenu postId={post.id} title={post.title} />
          </div>
        </div>
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
      <PrizeInfoModal
        open={prizeOpen}
        onClose={() => setPrizeOpen(false)}
        likeCount={post.likeCount ?? 0}
        eligible={post.prizeEligible}
        optedOut={post.prizeOptOut}
      />
    </article>
  );
}
