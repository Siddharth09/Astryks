import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Shared by every "message this person" entry point (messages list, user profile, post card).
// Conversation doc ID is deterministic (sorted uid pair) so repeat calls just reuse it instead
// of creating duplicates.
export async function ensureConversation(
  myUid: string,
  myDisplayName: string,
  otherUid: string,
  otherName: string
): Promise<string> {
  const conversationId = [myUid, otherUid].sort().join("_");
  const ref = doc(db, "conversations", conversationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [myUid, otherUid].sort(),
      participantNames: [myUid, otherUid].sort().map((id) => (id === otherUid ? otherName : myDisplayName)),
      lastMessage: "",
      lastMessageAt: new Date(),
    });
  }
  return conversationId;
}
