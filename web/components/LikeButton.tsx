"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function LikeButton({
  postId,
  initialCount,
  currentUserId,
  postOwnerId,
}: {
  postId: string;
  initialCount: number;
  currentUserId: string | null;
  // Optional only so existing call sites don't break at compile time — but every call site
  // should pass this. Without it, someone could like their own post and inflate their own
  // real-money Creative Prize likeCount (firestore.rules now blocks the write server-side
  // too; this is what stops the button from just hanging on a denied request).
  postOwnerId?: string;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwnPost = !!currentUserId && currentUserId === postOwnerId;

  useEffect(() => {
    async function check() {
      if (!currentUserId) {
        setChecked(true);
        return;
      }
      const snap = await getDoc(doc(db, "posts", postId, "likes", currentUserId));
      setLiked(snap.exists());
      setChecked(true);
    }
    check();
  }, [postId, currentUserId]);

  async function toggle() {
    if (busy || isOwnPost) return;
    if (!currentUserId) {
      router.push("/login");
      return;
    }
    setBusy(true);
    // likeCount itself is maintained server-side (onLikeCreated/onLikeDeleted in
    // functions/index.js) as the source of truth — the client only ever creates/deletes its own
    // like doc now, and just optimistically bumps the on-screen count for instant feedback.
    const likeRef = doc(db, "posts", postId, "likes", currentUserId);

    try {
      if (liked) {
        await deleteDoc(likeRef);
        setLiked(false);
        setCount((c) => c - 1);
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() });
        setLiked(true);
        setCount((c) => c + 1);
      }
    } catch {
      // Denied (e.g. rules rejected it) or a network blip — leave liked/count as they were
      // rather than showing a like that didn't actually happen.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={!checked || isOwnPost}
      title={isOwnPost ? "You can't like your own post" : undefined}
      className={`hover:text-ink transition-colors ${liked ? "text-ink" : ""} ${isOwnPost ? "opacity-50 cursor-default" : ""}`}
    >
      {liked ? "♥" : "♡"} {count}
    </button>
  );
}
