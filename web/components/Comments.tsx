"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, collection, writeBatch, increment, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import ReportModal from "@/components/ReportModal";

const submitReportFn = httpsCallable(functions, "submitReport");

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
  const [reportingComment, setReportingComment] = useState<{ id: string; userId: string } | null>(null);

  async function handleReportComment(reason: string, details: string) {
    if (!reportingComment) return;
    await submitReportFn({ targetType: "comment", targetId: reportingComment.id, postId, reason, details });
  }

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

    setComments((prev) => [...prev, { id: newCommentRef.id, body, userId: user.uid, userName: user.displayName ?? "Member" }]);
    setBody("");
    setPosting(false);
  }

  return (
    <div className="mt-6">
      <h3 className="font-display font-semibold mb-3">Comments</h3>
      <div className="space-y-3 mb-4">
        {comments.length === 0 && <p className="text-sm text-ink/50">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className="text-sm flex items-start gap-2">
            <span className="flex-1">
              <span className="font-medium">{c.userName}</span> <span className="text-ink/70">{c.body}</span>
            </span>
            {user && user.uid !== c.userId && (
              <button
                onClick={() => setReportingComment({ id: c.id, userId: c.userId })}
                className="text-xs text-ink/30 hover:text-ink/60 flex-shrink-0"
              >
                Report
              </button>
            )}
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
      <ReportModal
        open={reportingComment !== null}
        onClose={() => setReportingComment(null)}
        onSubmit={handleReportComment}
      />
    </div>
  );
}
