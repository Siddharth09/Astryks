import { useEffect, useState } from "react";
import { TouchableOpacity, Text } from "react-native";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function SaveButton({ postId, currentUserId }: { postId: string; currentUserId: string | null }) {
  const [saved, setSaved] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveId = currentUserId ? `${currentUserId}_${postId}` : null;

  useEffect(() => {
    if (!saveId) return setChecked(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "saves", saveId));
        setSaved(snap.exists());
      } catch {
        // Treat any hiccup checking save status the same as "not saved" rather than crashing.
        setSaved(false);
      }
      setChecked(true);
    })();
  }, [saveId]);

  async function toggle() {
    if (!saveId || !currentUserId || busy) return;
    setBusy(true);
    try {
      const ref = doc(db, "saves", saveId);
      if (saved) {
        await deleteDoc(ref);
        setSaved(false);
      } else {
        await setDoc(ref, { uid: currentUserId, postId, createdAt: serverTimestamp() });
        setSaved(true);
      }
    } catch {
      // Not fatal — local state just stays as it was, matching what's still true in Firestore
      // since the write never landed.
    } finally {
      setBusy(false);
    }
  }

  return (
    <TouchableOpacity onPress={toggle} disabled={!checked || !currentUserId || busy}>
      <Text style={{ fontSize: 19 }}>{saved ? "🔖" : "📑"}</Text>
    </TouchableOpacity>
  );
}
