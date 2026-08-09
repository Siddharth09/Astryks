"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function SaveButton({ postId, currentUserId }: { postId: string; currentUserId: string | null }) {
  const [saved, setSaved] = useState(false);
  const [checked, setChecked] = useState(false);
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
    if (!saveId || !currentUserId) return;
    const ref = doc(db, "saves", saveId);
    if (saved) {
      await deleteDoc(ref);
      setSaved(false);
    } else {
      await setDoc(ref, { uid: currentUserId, postId, createdAt: serverTimestamp() });
      setSaved(true);
    }
  }

  return (
    <button onClick={toggle} disabled={!checked || !currentUserId} className="hover:text-ink text-ink/50">
      {saved ? "🔖" : "📑"}
    </button>
  );
}
