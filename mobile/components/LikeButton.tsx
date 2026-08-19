import { useEffect, useState } from "react";
import { TouchableOpacity, Text } from "react-native";
import { router } from "expo-router";
import { doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colors } from "@/lib/styles";

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
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwnPost = !!currentUserId && currentUserId === postOwnerId;

  useEffect(() => {
    (async () => {
      if (!currentUserId) return setChecked(true);
      const snap = await getDoc(doc(db, "posts", postId, "likes", currentUserId));
      setLiked(snap.exists());
      setChecked(true);
    })();
  }, [postId, currentUserId]);

  async function toggle() {
    if (busy || isOwnPost) return;
    if (!currentUserId) return router.push("/login");
    setBusy(true);
    // likeCount itself is maintained server-side (onLikeCreated/onLikeDeleted in
    // functions/index.js) — the client only creates/deletes its own like doc now, and just
    // optimistically bumps the on-screen count for instant feedback.
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
    <TouchableOpacity onPress={toggle} disabled={!checked || isOwnPost}>
      <Text style={{ color: liked ? "#E85D5D" : colors.muted, fontSize: 17, opacity: isOwnPost ? 0.5 : 1 }}>
        {liked ? "♥" : "♡"} {count}
      </Text>
    </TouchableOpacity>
  );
}
