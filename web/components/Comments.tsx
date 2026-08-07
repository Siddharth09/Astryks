"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, collection, writeBatch, increment, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

const bumpStreak = httpsCallable(functions, "bumpStreak");

export default function Comments({
  postId,
  initialComments,
}: {
  postId: string;
  initialComments: any[];
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    if (!user) {
      router.push("/login");
      return;
    }
    setPosting(true);

    const postRef = doc(db, "posts", postId);
    const commentsRef = collection(db, "posts", postId, "comments");
    const newCommentRef = doc(commentsRef);

    const batch = writeBatch(db);
    batch.set(newCommentRef, {
      body,
      userId: user.uid,
      userName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
    });
    batch.update(postRef, { commentCount: increment(1) });
    await batch.commit();

    setComments((prev) => [...prev, { id: newCommentRef.id, body, userName: user.displayName ?? "Member" }]);
    setBody("");
    setPosting(false);
    bumpStreak().catch(() => {});
  }

  return (
    <div className="mt-6">
      <h3 className="font-display font-semibold mb-3">Comments</h3>
      <div className="space-y-3 mb-4">
        {comments.length === 0 && <p className="text-sm text-ink/50">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium">{c.userName}</span> <span className="text-ink/70">{c.body}</span>
          </div>
        ))}
      </div>
      {user ? (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input className="input flex-1" placeholder="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" disabled={posting} className="btn-primary">
            Post
          </button>
        </form>
      ) : (
        <p className="text-sm text-ink/50">
          <a href="/login" className="underline">Log in</a> to comment.
        </p>
      )}
    </div>
  );
}
