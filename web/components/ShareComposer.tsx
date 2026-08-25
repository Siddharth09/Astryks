"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, addDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { storage, db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import PrizeInfoModal from "@/components/PrizeInfoModal";

const fetchLinkPreview = httpsCallable(functions, "fetchLinkPreview");

export default function ShareComposer({ onPosted }: { onPosted?: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "text" | "media" | "link">("closed");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prizeInfoOpen, setPrizeInfoOpen] = useState(false);

  if (!user) return null;

  async function postText() {
    if (!body.trim() || !user) return;
    setLoading(true);
    setError(null);

    try {
      await addDoc(collection(db, "posts"), {
        type: "text",
        body,
        visibility: isPublic ? "public" : "private",
        ownerId: user.uid,
        ownerName: user.displayName ?? "Member",
        createdAt: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
      });

      reset();
      onPosted?.();
    } catch (err: any) {
      setError(err.message ?? "Couldn't post that.");
    } finally {
      setLoading(false);
    }
  }

  async function postMedia() {
    if (!file || !user) return;
    setLoading(true);
    setError(null);

    const type = file.type.startsWith("video") ? "video" : "photo";
    // Pre-generate the post's Firestore doc ID and fold it into the storage path (rather than
    // a bare random filename) so storage.rules can look up *this exact post's* visibility
    // before serving the file — see the posts/{userId}/{postId}/{fileName} match block there.
    // Without the postId in the path, Storage has no way to know which post a file belongs to,
    // so a "private" post's media stayed just as publicly fetchable as a public one's.
    const postRef = doc(collection(db, "posts"));
    const path = `posts/${user.uid}/${postRef.id}/${crypto.randomUUID()}-${file.name}`;
    const storageRef = ref(storage, path);

    try {
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const mediaUrl = await getDownloadURL(storageRef);

      await setDoc(postRef, {
        type,
        title: title || null,
        mediaUrl,
        mediaPath: path,
        visibility: isPublic ? "public" : "private",
        ownerId: user.uid,
        ownerName: user.displayName ?? "Member",
        createdAt: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
      });

      reset();
      onPosted?.();
    } catch (err: any) {
      setError(err.message ?? "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  async function postLink() {
    if (!linkUrl || !user) return;
    setLoading(true);
    setError(null);

    try {
      const result = await fetchLinkPreview({ url: linkUrl });
      const preview = result.data as { title: string; image: string | null; domain: string };

      await addDoc(collection(db, "posts"), {
        type: "link",
        title: title || null,
        linkUrl,
        linkTitle: preview.title,
        linkImage: preview.image,
        linkDomain: preview.domain,
        visibility: isPublic ? "public" : "private",
        ownerId: user.uid,
        ownerName: user.displayName ?? "Member",
        createdAt: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
      });

      reset();
      onPosted?.();
    } catch (err: any) {
      setError(err.message ?? "Couldn't fetch that link.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMode("closed");
    setFile(null);
    setTitle("");
    setBody("");
    setLinkUrl("");
    setIsPublic(true);
    setError(null);
  }

  if (mode === "closed") {
    return (
      <>
        <div className="flex items-center gap-2 border border-line/15 rounded-full pl-4 pr-2 py-2 mb-4 bg-white">
          <button onClick={() => setMode("text")} className="text-sm text-ink/40 flex-1 text-left">
            Share something…
          </button>
          <button onClick={() => setMode("media")} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-ink/5" aria-label="Share a photo or video">
            📷
          </button>
          <button onClick={() => setMode("link")} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-ink/5" aria-label="Share a link">
            🔗
          </button>
          <button
            onClick={() => setPrizeInfoOpen(true)}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-ink/5"
            aria-label="About the creative prize"
            title="About the creative prize"
          >
            🏆
          </button>
        </div>
        <PrizeInfoModal open={prizeInfoOpen} onClose={() => setPrizeInfoOpen(false)} generic />
      </>
    );
  }

  // Same public/private choice for every post type — this used to only exist for photo/video
  // posts, which meant a text post or a shared link could never be made private no matter what
  // someone picked (there was nothing to pick), even though the backend (firestore.rules) has
  // always supported a private posts/{postId}.visibility value for any post type.
  const visibilityToggle = (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setIsPublic(true)}
        className={isPublic ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
      >
        🌍 Public
      </button>
      <button
        type="button"
        onClick={() => setIsPublic(false)}
        className={!isPublic ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
      >
        🔒 Private
      </button>
    </div>
  );

  return (
    <div className="card p-4 mb-4">
      <PrizeInfoModal open={prizeInfoOpen} onClose={() => setPrizeInfoOpen(false)} generic />
      {mode === "text" ? (
        <div className="space-y-3">
          <textarea
            className="input min-h-24 resize-none"
            placeholder="Write something…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
          {visibilityToggle}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-secondary flex-1">Cancel</button>
            <button onClick={postText} disabled={loading || !body.trim()} className="btn-primary flex-1">
              {loading ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : mode === "media" ? (
        <div className="space-y-3">
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          <input className="input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button
            type="button"
            onClick={() => setPrizeInfoOpen(true)}
            className="text-xs underline text-ink/50 hover:text-ink"
          >
            🏆 This could win the AU$1,000 creative prize — learn how
          </button>
          {visibilityToggle}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-secondary flex-1">Cancel</button>
            <button onClick={postMedia} disabled={loading || !file} className="btn-primary flex-1">
              {loading ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Paste a YouTube or other link"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <input
            className="input"
            placeholder="Say something about it (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {visibilityToggle}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-secondary flex-1">Cancel</button>
            <button onClick={postLink} disabled={loading || !linkUrl} className="btn-primary flex-1">
              {loading ? "Sharing…" : "Share"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
