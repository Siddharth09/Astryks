"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  getDoc,
  setDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { useRouter } from "next/navigation";
import { db, storage, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { signOut, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import PageBackground from "@/components/PageBackground";
import ReferralAndBilling from "@/components/ReferralAndBilling";

const fetchLinkPreview = httpsCallable(functions, "fetchLinkPreview");
const deleteMyAccount = httpsCallable(functions, "deleteMyAccount");

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

function tierFor(pct: number): { emoji: string; label: string } | null {
  if (pct >= 100) return { emoji: "🏆", label: "Mastered" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway there" };
  if (pct >= 25) return { emoji: "🥉", label: "Getting started" };
  return null;
}

export default function MePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useState<"posts" | "links" | "saved">("posts");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ streakCount?: number; xp?: number; masteredSubjects?: string[] }>({});
  const [subjects, setSubjects] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(new Set());
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // My posts: add photo/video
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [showAddMedia, setShowAddMedia] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaPublic, setMediaPublic] = useState(true);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Shared links: paste a link
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      await signOut(auth);
      router.push("/");
    } catch (err: any) {
      setDeleteError(err.message ?? "Couldn't delete your account. Please try again or contact support.");
      setDeleting(false);
    }
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || !user) return;
    setNameSaving(true);
    setNameError(null);
    try {
      await updateProfile(user, { displayName: trimmed });
      await setDoc(doc(db, "users", user.uid), { displayName: trimmed }, { merge: true });
      setNameOverride(trimmed);
      setEditingName(false);
    } catch (err: any) {
      setNameError(err.message ?? "Couldn't update your name.");
    } finally {
      setNameSaving(false);
    }
  }

  useEffect(() => {
    if (user) setAvatarUrl(user.photoURL);
  }, [user]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const path = `avatars/${user.uid}/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const url = await getDownloadURL(storageRef);
      await updateProfile(user, { photoURL: url });
      await setDoc(doc(db, "users", user.uid), { photoURL: url }, { merge: true });
      setAvatarUrl(url);
    } catch (err: any) {
      setAvatarError(err.message ?? "Couldn't update your picture.");
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function loadProfileData() {
    if (!user) return;
    const userSnap = await getDoc(doc(db, "users", user.uid));
    setProfile(userSnap.data() ?? {});

    const subjSnap = await getDocs(query(collection(db, "subjects"), orderBy("order", "asc")));
    setSubjects(subjSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    const lessonsSnap = await getDocs(collection(db, "lessons"));
    setLessons(lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    const progressSnap = await getDocs(
      query(collection(db, "lessonProgress"), where("uid", "==", user.uid))
    );
    setCompletedLessonIds(new Set(progressSnap.docs.map((d) => d.data().lessonId)));

    const mediaSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("ownerId", "==", user.uid),
        where("type", "in", ["photo", "video"]),
        orderBy("createdAt", "desc")
      )
    );
    setPosts(mediaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    const linkSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("ownerId", "==", user.uid),
        where("type", "==", "link"),
        orderBy("createdAt", "desc")
      )
    );
    setLinks(linkSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    const savesSnap = await getDocs(query(collection(db, "saves"), where("uid", "==", user.uid)));
    const savedPosts = await Promise.all(
      savesSnap.docs.map(async (s) => {
        // A saved post can become unreadable (e.g. deleted, or made private by someone
        // else) after it was saved — treat that as "no longer available" rather than
        // letting one bad post fail the whole saved list.
        try {
          const postSnap = await getDoc(doc(db, "posts", s.data().postId));
          return postSnap.exists() ? { id: postSnap.id, ...postSnap.data() } : null;
        } catch {
          return null;
        }
      })
    );
    setSaved(savedPosts.filter(Boolean));
  }

  useEffect(() => {
    if (!user) return;
    loadProfileData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleAddMedia() {
    if (!mediaFile || !user) return;
    setMediaUploading(true);
    setMediaError(null);
    try {
      const type = mediaFile.type.startsWith("video") ? "video" : "photo";
      // Same fix as ShareComposer.tsx: the postId has to be embedded in the storage path
      // *before* upload, not after, so storage.rules' postIsPrivate() check has something to
      // look up. This upload path used to write to the old flat posts/{uid}/{fileName} layout,
      // which storage.rules keeps world-readable for backward compatibility — so a post marked
      // "Private" here still had a fully public, unauthenticated file URL underneath it.
      const postRef = doc(collection(db, "posts"));
      const path = `posts/${user.uid}/${postRef.id}/${crypto.randomUUID()}-${mediaFile.name}`;
      const storageRef = ref(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, mediaFile);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const mediaUrl = await getDownloadURL(storageRef);

      await setDoc(postRef, {
        type,
        title: mediaTitle || null,
        mediaUrl,
        mediaPath: path,
        visibility: mediaPublic ? "public" : "private",
        ownerId: user.uid,
        ownerName: nameOverride ?? user.displayName ?? "Member",
        createdAt: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
      });

      setShowAddMedia(false);
      setMediaFile(null);
      setMediaTitle("");
      setMediaPublic(true);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      await loadProfileData();
    } catch (err: any) {
      setMediaError(err.message ?? "Upload failed.");
    } finally {
      setMediaUploading(false);
    }
  }

  async function handleAddLink() {
    if (!linkInput.trim() || !user) return;
    setLinkSaving(true);
    setLinkError(null);
    try {
      const result = await fetchLinkPreview({ url: linkInput.trim() });
      const preview = result.data as { title: string; image: string | null; domain: string };

      await addDoc(collection(db, "posts"), {
        type: "link",
        linkUrl: linkInput.trim(),
        linkTitle: preview.title,
        linkImage: preview.image,
        linkDomain: preview.domain,
        ownerId: user.uid,
        ownerName: nameOverride ?? user.displayName ?? "Member",
        createdAt: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
      });

      setShowAddLink(false);
      setLinkInput("");
      await loadProfileData();
    } catch (err: any) {
      setLinkError(err.message ?? "Couldn't fetch that link.");
    } finally {
      setLinkSaving(false);
    }
  }

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  return (
    <div className="pb-16">
      <PageBackground color="#ECE8F7" />
      <div className="flex items-center gap-3 mb-2">
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />
        <button
          onClick={() => avatarInputRef.current?.click()}
          className="relative w-12 h-12 rounded-full flex-shrink-0 group"
          aria-label="Change profile picture"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium"
              style={{ background: "#E85D5D" }}
            >
              {(user.displayName ?? "M")[0]}
            </div>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-ink text-white text-[10px] flex items-center justify-center border-2 border-paper">
            {avatarUploading ? "…" : "✎"}
          </span>
        </button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="input py-1 px-2 text-sm flex-1 min-w-0"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={40}
              />
              <button onClick={handleSaveName} disabled={nameSaving} className="text-xs text-brand font-medium flex-shrink-0">
                {nameSaving ? "…" : "Save"}
              </button>
              <button onClick={() => setEditingName(false)} className="text-xs text-ink/40 flex-shrink-0">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setNameInput(nameOverride ?? user.displayName ?? "");
                setEditingName(true);
              }}
              className="flex items-center gap-1.5 group"
            >
              <p className="font-medium">{nameOverride ?? user.displayName ?? "Member"}</p>
              <span className="text-ink/30 text-xs group-hover:text-ink/60">✎</span>
            </button>
          )}
          {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs text-ink/50">{posts.length + links.length} posts</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-highlight/20 text-ink text-[11px] font-medium px-2 py-0.5">
              ⭐ {profile.xp ?? 0} xp
            </span>
            {(profile.streakCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brandLight text-brandDark text-[11px] font-medium px-2 py-0.5">
                🔥 {profile.streakCount} day{profile.streakCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => signOut(auth).catch(() => alert("Couldn't log out — please try again."))}
          className="ml-auto text-sm text-ink/40"
        >
          Log out
        </button>
      </div>
      {avatarError && <p className="text-xs text-red-600 mb-4">{avatarError}</p>}

      <div className="mb-4">
        {showDeleteConfirm ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
            <p className="font-medium mb-1">Permanently delete your account?</p>
            <p className="mb-3">
              This deletes your posts, saved items, lesson progress, and login — it can't be undone.
              {" "}If you have an active Stripe subscription, it's canceled automatically as part of
              deleting your account, so you won't be billed again.
            </p>
            {deleteError && <p className="text-red-700 mb-2">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="rounded-lg bg-red-600 text-white text-xs font-medium px-3 py-1.5"
              >
                {deleting ? "Deleting…" : "Yes, permanently delete"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-lg border border-ink/15 text-xs px-3 py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowDeleteConfirm(true)} className="text-xs text-ink/30 underline">
            Delete my account
          </button>
        )}
      </div>

      {lessons.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">🎓 Learning</p>
            <p className="text-xs text-ink/50">
              {lessons.filter((l) => completedLessonIds.has(l.id)).length} of {lessons.length} lessons complete
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {subjects.map((s) => {
              const subjectLessons = lessons.filter((l) => l.subjectId === s.id);
              if (subjectLessons.length === 0) return null;
              const done = subjectLessons.filter((l) => completedLessonIds.has(l.id)).length;
              const pct = Math.round((done / subjectLessons.length) * 100);
              const tier = tierFor(pct);
              return (
                <Link
                  key={s.id}
                  href={`/learn?subject=${s.id}`}
                  className="flex items-center gap-2 rounded-xl border border-ink/10 bg-paper px-3 py-2 hover:bg-ink/5"
                >
                  <span className="text-lg">{SUBJECT_ICONS[s.id] ?? "⭐"}</span>
                  <div>
                    <p className="text-xs font-medium">{s.name}</p>
                    <p className="text-[11px] text-ink/50">
                      {tier ? `${tier.emoji} ${tier.label}` : `${done}/${subjectLessons.length}`}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4" />
      <ReferralAndBilling />

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("posts")} className={tab === "posts" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          My posts
        </button>
        <button onClick={() => setTab("links")} className={tab === "links" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          Shared links
        </button>
        <button onClick={() => setTab("saved")} className={tab === "saved" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          Saved
        </button>
      </div>

      {tab === "posts" ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-ink/50">{posts.length} photos &amp; videos</p>
            {showAddMedia ? (
              <button onClick={() => setShowAddMedia(false)} className="text-xs text-ink/40">
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setShowAddMedia(true)}
                className="w-7 h-7 rounded-full flex items-center justify-center bg-ink text-white text-sm"
                aria-label="Add a photo or video"
              >
                +
              </button>
            )}
          </div>
          {showAddMedia && (
            <div className="card p-4 mb-4 space-y-3">
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <input
                className="input"
                placeholder="Title (optional)"
                value={mediaTitle}
                onChange={(e) => setMediaTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setMediaPublic(true)}
                  className={mediaPublic ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
                >
                  🌍 Public
                </button>
                <button
                  onClick={() => setMediaPublic(false)}
                  className={!mediaPublic ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}
                >
                  🔒 Private
                </button>
              </div>
              {mediaError && <p className="text-sm text-red-600">{mediaError}</p>}
              <button
                onClick={handleAddMedia}
                disabled={mediaUploading || !mediaFile}
                className="btn-primary w-full"
              >
                {mediaUploading ? "Posting…" : "Post"}
              </button>
            </div>
          )}
          {posts.length === 0 ? (
            <p className="text-ink/50 text-sm text-center py-10">No posts yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {posts.map((p) => (
                <Link
                  key={p.id}
                  href={`/post/${p.id}`}
                  className="aspect-square rounded-lg overflow-hidden bg-ink flex items-center justify-center relative"
                >
                  {p.type === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-xl">▶</span>
                  )}
                  {p.visibility === "private" && (
                    <span className="absolute top-1 right-1 text-xs bg-black/50 rounded-full w-5 h-5 flex items-center justify-center">
                      🔒
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : tab === "links" ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-ink/50">{links.length} shared links</p>
            {showAddLink ? (
              <button onClick={() => setShowAddLink(false)} className="text-xs text-ink/40">
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setShowAddLink(true)}
                className="w-7 h-7 rounded-full flex items-center justify-center bg-ink text-white text-sm"
                aria-label="Add a link"
              >
                +
              </button>
            )}
          </div>
          {showAddLink && (
            <div className="card p-4 mb-4 space-y-3">
              <input
                autoFocus
                className="input"
                placeholder="Paste a YouTube or other link"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
              />
              {linkError && <p className="text-sm text-red-600">{linkError}</p>}
              <button onClick={handleAddLink} disabled={linkSaving || !linkInput.trim()} className="btn-primary w-full">
                {linkSaving ? "Sharing…" : "Share"}
              </button>
            </div>
          )}
          {links.length === 0 ? (
            <p className="text-ink/50 text-sm text-center py-10">No shared links yet.</p>
          ) : (
            <div className="space-y-2">
              {links.map((l) => (
                <Link key={l.id} href={`/post/${l.id}`} className="flex items-center gap-3 border border-line/15 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-lg bg-brandLight flex items-center justify-center">🔗</div>
                  <div className="min-w-0">
                    <p className="text-xs text-ink/50">{l.linkDomain}</p>
                    <p className="text-sm font-medium truncate">{l.linkTitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : saved.length === 0 ? (
        <p className="text-ink/50 text-sm text-center py-10">Nothing saved yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {saved.map((p) => (
            <Link key={p.id} href={`/post/${p.id}`} className="aspect-square rounded-lg overflow-hidden bg-ink flex items-center justify-center">
              {p.type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xl">{p.type === "link" ? "🔗" : "▶"}</span>
              )}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-ink/10 text-center text-xs text-ink/40">
        <p>
          <Link href="/privacy" className="hover:text-ink/70 hover:underline">Privacy</Link>
          {" · "}
          <Link href="/terms" className="hover:text-ink/70 hover:underline">Terms</Link>
          {" · "}
          <Link href="/prize-rules" className="hover:text-ink/70 hover:underline">Prize Rules</Link>
          {" · "}
          <Link href="/support" className="hover:text-ink/70 hover:underline">Support</Link>
        </p>
        <p className="mt-1">© 2026 Astryks. All rights reserved.</p>
      </div>
    </div>
  );
}
