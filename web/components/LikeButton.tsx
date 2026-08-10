"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
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
    // likeCount itself is maintained server-side (onLikeCreated/onLikeDeleted in
    // functions/index.js) as the source of truth — the client only ever creates/deletes its own
    // like doc now, and just optimistically bumps the on-screen count for instant feedback.
    const likeRef = doc(db, "posts", postId, "likes", currentUserId);

    if (liked) {
      await deleteDoc(likeRef);
      setLiked(false);
      setCount((c) => c - 1);
    } else {
      await setDoc(likeRef, { createdAt: serverTimestamp() });
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
