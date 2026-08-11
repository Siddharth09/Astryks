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
}: {
  postId: string;
  initialCount: number;
  currentUserId: string | null;
}) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!currentUserId) return setChecked(true);
      const snap = await getDoc(doc(db, "posts", postId, "likes", currentUserId));
      setLiked(snap.exists());
      setChecked(true);
    })();
  }, [postId, currentUserId]);

  async function toggle() {
    if (busy) return;
    if (!currentUserId) return router.push("/login");
    setBusy(true);
    // likeCount itself is maintained server-side (onLikeCreated/onLikeDeleted in
    // functions/index.js) — the client only creates/deletes its own like doc now, and just
    // optimistically bumps the on-screen count for instant feedback.
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
    <TouchableOpacity onPress={toggle} disabled={!checked}>
      <Text style={{ color: liked ? "#E85D5D" : colors.muted, fontSize: 15 }}>{liked ? "♥" : "♡"} {count}</Text>
    </TouchableOpacity>
  );
}
