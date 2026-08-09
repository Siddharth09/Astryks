import { useEffect, useState } from "react";
import { TouchableOpacity, Text } from "react-native";
import { router } from "expo-router";
import { doc, getDoc, writeBatch, increment, serverTimestamp } from "firebase/firestore";
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
    <TouchableOpacity onPress={toggle} disabled={!checked}>
      <Text style={{ color: liked ? "#E85D5D" : colors.muted, fontSize: 13 }}>{liked ? "♥" : "♡"} {count}</Text>
    </TouchableOpacity>
  );
}
