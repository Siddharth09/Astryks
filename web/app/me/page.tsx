"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where, orderBy, doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { signOut, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import PageBackground from "@/components/PageBackground";
import ReferralAndBilling from "@/components/ReferralAndBilling";

export default function MePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useState<"posts" | "links" | "notes" | "saved">("posts");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ streakCount?: number; xp?: number }>({});

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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      setProfile(userSnap.data() ?? {});

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

      const notesSnap = await getDocs(
        query(
          collection(db, "posts"),
          where("ownerId", "==", user.uid),
          where("type", "==", "text"),
          orderBy("createdAt", "desc")
        )
      );
      setNotes(notesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const savesSnap = await getDocs(query(collection(db, "saves"), where("uid", "==", user.uid)));
      const savedPosts = await Promise.all(
        savesSnap.docs.map(async (s) => {
          const postSnap = await getDoc(doc(db, "posts", s.data().postId));
          return postSnap.exists() ? { id: postSnap.id, ...postSnap.data() } : null;
        })
      );
      setSaved(savedPosts.filter(Boolean));
    })();
  }, [user]);

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
        <button onClick={() => avatarInputRef.current?.click()} className="text-left flex-1">
          <p className="font-medium">{user.displayName ?? "Member"}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs text-ink/50">{posts.length + links.length + notes.length} posts</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-highlight/20 text-ink text-[11px] font-medium px-2 py-0.5">
              ⭐ {profile.xp ?? 0} xp
            </span>
            {(profile.streakCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brandLight text-brandDark text-[11px] font-medium px-2 py-0.5">
                🔥 {profile.streakCount} day{profile.streakCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </button>
        <button onClick={() => signOut(auth)} className="ml-auto text-sm text-ink/40">
          Log out
        </button>
      </div>
      {avatarError && <p className="text-xs text-red-600 mb-4">{avatarError}</p>}

      <div className="mb-4" />
      <ReferralAndBilling />

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("posts")} className={tab === "posts" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          My posts
        </button>
        <button onClick={() => setTab("links")} className={tab === "links" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          Shared links
        </button>
        <button onClick={() => setTab("notes")} className={tab === "notes" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          Notes
        </button>
        <button onClick={() => setTab("saved")} className={tab === "saved" ? "btn-primary flex-1 text-xs" : "btn-secondary flex-1 text-xs"}>
          Saved
        </button>
      </div>

      {tab === "posts" ? (
        posts.length === 0 ? (
          <p className="text-ink/50 text-sm text-center py-10">No posts yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {posts.map((p) => (
              <div key={p.id} className="aspect-square rounded-lg overflow-hidden bg-ink flex items-center justify-center">
                {p.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-xl">▶</span>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "links" ? (
        links.length === 0 ? (
          <p className="text-ink/50 text-sm text-center py-10">No shared links yet.</p>
        ) : (
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border border-line/15 rounded-xl p-3">
                <div className="w-10 h-10 rounded-lg bg-brandLight flex items-center justify-center">🔗</div>
                <div className="min-w-0">
                  <p className="text-xs text-ink/50">{l.linkDomain}</p>
                  <p className="text-sm font-medium truncate">{l.linkTitle}</p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === "notes" ? (
        notes.length === 0 ? (
          <p className="text-ink/50 text-sm text-center py-10">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <Link key={n.id} href={`/post/${n.id}`} className="block border border-line/15 rounded-xl p-3">
                <p className="text-sm line-clamp-3 whitespace-pre-wrap">{n.body}</p>
              </Link>
            ))}
          </div>
        )
      ) : saved.length === 0 ? (
        <p className="text-ink/50 text-sm text-center py-10">Nothing saved yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {saved.map((p) => (
            <div key={p.id} className="aspect-square rounded-lg overflow-hidden bg-ink flex items-center justify-center">
              {p.type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xl">{p.type === "link" ? "🔗" : "▶"}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
