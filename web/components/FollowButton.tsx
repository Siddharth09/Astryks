"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function FollowButton({
  targetUserId,
  currentUserId,
  className,
}: {
  targetUserId: string;
  currentUserId: string | null;
  className?: string;
}) {
  const [following, setFollowing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (busy || !followId || !currentUserId) return;
    setBusy(true);
    try {
      const ref = doc(db, "follows", followId);
      if (following) {
        await deleteDoc(ref);
        setFollowing(false);
      } else {
        await setDoc(ref, { followerId: currentUserId, followingId: targetUserId, createdAt: serverTimestamp() });
        setFollowing(true);
      }
    } catch {
      // Without this, a failed write (permission denied, network blip) left `busy` stuck true
      // forever — the button's internal guard above silently no-oped every future click, with
      // nothing visibly wrong (the button never even looked disabled) since `disabled` here was
      // only ever wired to `checked`, not `busy`. Now a failure just means "try again."
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={!checked || busy}
      className={(following ? "btn-secondary" : "btn-primary") + " " + (className ?? "text-xs px-3 py-1")}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
