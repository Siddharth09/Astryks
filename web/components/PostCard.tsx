"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import LikeButton from "@/components/LikeButton";
import SaveButton from "@/components/SaveButton";
import FollowButton from "@/components/FollowButton";

export default function PostCard({ post, currentUserId }: { post: any; currentUserId: string | null }) {
  const router = useRouter();
  const createdDate = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
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
          <div className="flex items-center gap-3 p-3">
            {post.linkImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.linkImage} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-brandLight flex items-center justify-center flex-shrink-0 text-xl">
                🔗
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-ink/50">{post.linkDomain}</p>
              <p className="text-sm font-medium truncate">{post.linkTitle || post.linkUrl}</p>
            </div>
          </div>
        )}
      </Link>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-ink/50">
          <span>{post.ownerName ?? "Member"}</span>
          <span>·</span>
          <time>{createdDate.toLocaleDateString()}</time>
          <FollowButton targetUserId={post.ownerId} currentUserId={currentUserId} />
          {currentUserId && currentUserId !== post.ownerId && (
            <button onClick={openConversation} className="text-xs text-ink/40 hover:text-ink">
              Message
            </button>
          )}
        </div>
        {post.title && (
          <Link href={`/post/${post.id}`}>
            <h2 className="font-display text-lg font-semibold mb-1">{post.title}</h2>
          </Link>
        )}
        <div className="flex items-center gap-4 text-sm text-ink/50">
          <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={currentUserId} />
          <Link href={`/post/${post.id}`} className="hover:text-ink">
            💬 {post.commentCount ?? 0}
          </Link>
          <SaveButton postId={post.id} currentUserId={currentUserId} />
        </div>
      </div>
    </article>
  );
}
