"use client";

import { useEffect, useState } from "react";
import * as tus from "tus-js-client";
import { httpsCallable } from "firebase/functions";
import { collection, addDoc, doc, updateDoc, getDocs, query, orderBy } from "firebase/firestore";
import { functions, db } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const SUBJECT_LABEL: Record<string, string> = { music: "Music", art: "Art" };

const createBunnyUpload = httpsCallable(functions, "createBunnyUpload");
const deleteLessonFn = httpsCallable(functions, "deleteLesson");

export default function LessonUploadPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [subjectId, setSubjectId] = useState("music");
  const [title, setTitle] = useState("");
  const [order, setOrder] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [pinned, setPinned] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [existingLessons, setExistingLessons] = useState<any[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdminUser = !authLoading && isAdmin(user?.email);

  async function loadExisting() {
    const snap = await getDocs(query(collection(db, "lessons"), orderBy("createdAt", "desc")));
    setExistingLessons(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    if (isAdminUser) loadExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminUser]);

  async function togglePin(lessonId: string, current: boolean) {
    try {
      await updateDoc(doc(db, "lessons", lessonId), { pinned: !current });
      setExistingLessons((prev) => (prev ?? []).map((l) => (l.id === lessonId ? { ...l, pinned: !current } : l)));
    } catch (err: any) {
      // Admin-only tool, but same silent-failure pattern as everywhere else fixed tonight — no
      // error meant a failed pin toggle just looked like the click did nothing.
      alert(err.message ?? "Couldn't update that lesson — please try again.");
    }
  }

  async function updateOrder(lessonId: string, newOrder: number) {
    if (!Number.isFinite(newOrder)) return;
    try {
      await updateDoc(doc(db, "lessons", lessonId), { order: newOrder });
      setExistingLessons((prev) => (prev ?? []).map((l) => (l.id === lessonId ? { ...l, order: newOrder } : l)));
    } catch (err: any) {
      alert(err.message ?? "Couldn't update that lesson's order — please try again.");
    }
  }

  async function handleDeleteLesson(lessonId: string, title: string) {
    if (!confirm(`Delete "${title}"? This removes its video and everyone's progress on it. This can't be undone.`)) return;
    setDeletingId(lessonId);
    try {
      await deleteLessonFn({ lessonId });
      setExistingLessons((prev) => (prev ?? []).filter((l) => l.id !== lessonId));
    } catch (err: any) {
      alert(err.message ?? "Couldn't delete this lesson.");
    } finally {
      setDeletingId(null);
    }
  }

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdminUser) {
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

      setStatus("Saving lesson…");
      await addDoc(collection(db, "lessons"), {
        subjectId,
        title,
        order,
        pinned,
        bunnyVideoId: videoId,
        bunnyLibraryId: libraryId,
        createdAt: new Date(),
      });

      setStatus("Done!");
      setFile(null);
      setTitle("");
      setPinned(false);
      loadExisting();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-semibold mb-6">Add a lesson</h1>
      <form onSubmit={handleUpload} className="space-y-4">
        <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="music">Music</option>
          <option value="art">Art</option>
        </select>
        <input className="input" placeholder="Lesson title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input
          className="input"
          type="number"
          placeholder="Order (1, 2, 3…)"
          value={order}
          onChange={(e) => setOrder(Number(e.target.value))}
        />
        <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        <label className="flex items-center gap-2 text-sm text-ink/70">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to top of this subject (new subscribers see it first)
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {status && <p className="text-sm text-ink/50">{status}{progress !== null && status === "Uploading video…" ? ` ${progress}%` : ""}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Uploading…" : "Add lesson"}
        </button>
      </form>

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold mb-3">Manage lessons</h2>
        {existingLessons === null ? (
          <p className="text-sm text-ink/40">Loading…</p>
        ) : existingLessons.length === 0 ? (
          <p className="text-sm text-ink/40">No lessons yet.</p>
        ) : (
          <div className="space-y-2">
            {[...existingLessons]
              .sort((a, b) => (a.subjectId ?? "").localeCompare(b.subjectId ?? "") || (a.order ?? 0) - (b.order ?? 0))
              .map((l) => (
              <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-ink/10 bg-white">
                <input
                  type="number"
                  defaultValue={l.order ?? 1}
                  onBlur={(e) => {
                    const next = parseInt(e.target.value, 10);
                    if (next !== l.order) updateOrder(l.id, next);
                  }}
                  title="Order within this subject — lower numbers come first"
                  className="w-14 text-sm text-center rounded-lg border border-ink/10 py-1.5 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{l.title}</p>
                  <p className="text-xs text-ink/40">{SUBJECT_LABEL[l.subjectId] ?? l.subjectId}</p>
                </div>
                <button
                  onClick={() => togglePin(l.id, !!l.pinned)}
                  className={l.pinned ? "btn-primary text-xs px-3 py-1.5" : "btn-secondary text-xs px-3 py-1.5"}
                >
                  {l.pinned ? "📌 Pinned" : "Pin"}
                </button>
                <button
                  onClick={() => handleDeleteLesson(l.id, l.title)}
                  disabled={deletingId === l.id}
                  className="text-xs text-red-600 hover:underline px-2"
                >
                  {deletingId === l.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
