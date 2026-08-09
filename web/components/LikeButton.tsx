"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, writeBatch, increment, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function LikeButton({
  postId,
  initialCount,
  currentUserId,
}: {
  postId: string;
  initialCount: number;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    if (!currentUserId) {
      router.push("/login");
      return;
    }
    setBusy(true);
    const postRef = doc(db, "posts", postId);
    const likeRef = doc(db, "posts", postId, "likes", currentUserId);
    const batch = writeBatch(db);

    if (liked) {
      batch.delete(likeRef);
      batch.update(postRef, { likeCount: increment(-1) });
      await batch.commit();
      setLiked(false);
      setCount((c) => c - 1);
    } else {
      batch.set(likeRef, { createdAt: serverTimestamp() });
      batch.update(postRef, { likeCount: increment(1) });
      await batch.commit();
      setLiked(true);
      setCount((c) => c + 1);
    }
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={!checked}
      className={`hover:text-ink transition-colors ${liked ? "text-ink" : ""}`}
    >
      {liked ? "♥" : "♡"} {count}
    </button>
  );
}
