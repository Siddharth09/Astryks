"use client";

import { useState } from "react";
import * as tus from "tus-js-client";
import { httpsCallable } from "firebase/functions";
import { collection, addDoc } from "firebase/firestore";
import { functions, db } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const createBunnyUpload = httpsCallable(functions, "createBunnyUpload");

export default function TrailerUploadPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [subjectTag, setSubjectTag] = useState("music");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a video file first.");
      return;
    }
    setLoading(true);
    setError(null);
    setStatus("Preparing upload…");

    try {
      const result = await createBunnyUpload({ title });
      const { videoId, libraryId, signature, expirationTime } = result.data as {
        videoId: string;
        libraryId: string;
        signature: string;
        expirationTime: number;
      };

      setStatus("Uploading video…");
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: "https://video.bunnycdn.com/tusupload",
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: {
            AuthorizationSignature: signature,
            AuthorizationExpire: String(expirationTime),
            VideoId: videoId,
            LibraryId: libraryId,
          },
          metadata: { filetype: file.type, title },
          onError: reject,
          onProgress: (up, total) => setProgress(Math.round((up / total) * 100)),
          onSuccess: () => resolve(),
        });
        upload.start();
      });

      setStatus("Saving trailer…");
      await addDoc(collection(db, "trailers"), {
        subjectTag,
        title,
        bunnyVideoId: videoId,
        bunnyLibraryId: libraryId,
        createdAt: new Date(),
      });

      setStatus("Done! It'll show up on the home feed and subscribe prompt right away.");
      setFile(null);
      setTitle("");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-bold mb-2">Add a trailer</h1>
      <p className="text-sm text-ink/60 mb-6">
        Short preview clips shown on the home feed and next to the subscribe prompt, to help people considering
        the $4.99/week plan see what they'd actually be getting.
      </p>
      <form onSubmit={handleUpload} className="space-y-4">
        <select className="input" value={subjectTag} onChange={(e) => setSubjectTag(e.target.value)}>
          <option value="music">Music</option>
          <option value="art">Art</option>
        </select>
        <input className="input" placeholder="Trailer title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {status && (
          <p className="text-sm text-ink/50">
            {status}
            {progress !== null && status === "Uploading video…" ? ` ${progress}%` : ""}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Uploading…" : "Add trailer"}
        </button>
      </form>
    </div>
  );
}
