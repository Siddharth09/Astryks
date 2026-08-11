import { useEffect, useState } from "react";
import { TouchableOpacity, Text } from "react-native";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function FollowButton({
  targetUserId,
  currentUserId,
  style,
  textStyle,
}: {
  targetUserId: string;
  currentUserId: string | null;
  style?: any;
  textStyle?: any;
}) {
  const [following, setFollowing] = useState(false);
  const [checked, setChecked] = useState(false);
  const followId = currentUserId ? `${currentUserId}_${targetUserId}` : null;

  useEffect(() => {
    if (!followId) return setChecked(true);
    (async () => {
      const snap = await getDoc(doc(db, "follows", followId));
      setFollowing(snap.exists());
      setChecked(true);
    })();
  }, [followId]);

  if (!currentUserId || currentUserId === targetUserId) return null;

  async function toggle() {
    if (!followId || !currentUserId) return;
    const ref = doc(db, "follows", followId);
    if (following) {
      await deleteDoc(ref);
      setFollowing(false);
    } else {
      await setDoc(ref, { followerId: currentUserId, followingId: targetUserId, createdAt: serverTimestamp() });
      setFollowing(true);
    }
  }

  return (
    <TouchableOpacity
      onPress={toggle}
      disabled={!checked}
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: following ? "transparent" : "#E85D5D",
          borderWidth: following ? 1 : 0,
          borderColor: "#ccc",
        },
        style,
      ]}
    >
      <Text style={[{ fontSize: 12, color: following ? "#666" : "white" }, textStyle]}>
        {following ? "Following" : "Follow"}
      </Text>
    </TouchableOpacity>
  );
}
