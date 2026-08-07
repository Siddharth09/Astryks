"use client";

import { useEffect, useState } from "react";
import { useParams, notFound, useRouter } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import LikeButton from "@/components/LikeButton";
import Comments from "@/components/Comments";

const deletePostFn = httpsCallable(functions, "deletePost");
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export default function PostPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, "posts", params.id));
      if (!snap.exists()) {
        setMissing(true);
        setLoading(false);
        return;
      }
      setPost({ id: snap.id, ...snap.data() });

      const commentsSnap = await getDocs(
        query(collection(db, "posts", params.id, "comments"), orderBy("createdAt", "asc"))
      );
      setComments(commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (missing) notFound();
  if (loading || !post) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  const createdDate = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const canDelete = user && (user.uid === post.ownerId || ADMIN_EMAILS.includes(user.email ?? ""));

  async function handleDelete() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deletePostFn({ postId: post.id });
      router.push("/home");
    } catch (err: any) {
      alert(err.message ?? "Couldn't delete this post.");
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto pb-16">
      {post.type === "video" && post.bunnyVideoId && (
        <iframe
          src={`https://iframe.mediadelivery.net/embed/${post.bunnyLibraryId}/${post.bunnyVideoId}`}
          className="w-full aspect-video bg-ink rounded-2xl"
          style={{ border: "none" }}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
        />
      )}
      {post.type === "video" && !post.bunnyVideoId && (
        <video src={post.mediaUrl} className="w-full aspect-video bg-ink rounded-2xl" controls />
      )}
      {post.type === "photo" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.mediaUrl} alt={post.title || "Post"} className="w-full rounded-2xl bg-ink" />
      )}
      {post.type === "text" && (
        <p className="font-display text-2xl font-bold whitespace-pre-wrap">{post.body}</p>
      )}
      {post.type === "link" && (
        <a
          href={post.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 border border-line/15 rounded-2xl p-4"
        >
          {post.linkImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.linkImage} alt="" className="w-16 h-16 rounded-lg object-cover" />
          )}
          <div>
            <p className="text-xs text-ink/50">{post.linkDomain}</p>
            <p className="font-medium">{post.linkTitle}</p>
          </div>
        </a>
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-ink/50">
          <span>{post.ownerName ?? "Member"}</span>
          <span>·</span>
          <time>{createdDate.toLocaleDateString()}</time>
          {canDelete && (
            <button onClick={handleDelete} disabled={deleting} className="ml-auto text-red-600 hover:underline">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
        {post.title && <h1 className="font-display text-2xl font-semibold mb-2">{post.title}</h1>}
        <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={user?.uid ?? null} />
      </div>

      <Comments postId={post.id} initialComments={comments} />
    </div>
  );
}
