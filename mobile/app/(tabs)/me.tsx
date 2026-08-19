import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator, TextInput, Linking, Alert } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
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
import { signOut, updateProfile } from "firebase/auth";
import { db, auth, storage, functions } from "@/lib/firebase";
import { useResizedImageUrl } from "@/lib/resizedImage";

// Small grid thumbnail — needs its own component (not inline in a .map()) since it calls a hook
// to swap in the resized 800x800 WebP copy once available, falling back to the full-res original.
function PostThumb({ post }: { post: any }) {
  const displayUrl = useResizedImageUrl(post.mediaPath, post.mediaUrl);
  return <Image source={{ uri: displayUrl }} style={{ width: "100%", height: "100%" }} />;
}
import ReferralAndBilling from "@/components/ReferralAndBilling";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

const fetchLinkPreview = httpsCallable(functions, "fetchLinkPreview");
const deleteMyAccount = httpsCallable(functions, "deleteMyAccount");
const notifySignOut = httpsCallable(functions, "notifySignOut");

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨" };

function tierFor(pct: number): { emoji: string; label: string } | null {
  if (pct >= 100) return { emoji: "🏆", label: "Mastered" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway there" };
  if (pct >= 25) return { emoji: "🥉", label: "Getting started" };
  return null;
}

export default function MeScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"posts" | "links" | "saved">("posts");
  const [posts, setPosts] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ streakCount?: number; xp?: number; masteredSubjects?: string[] }>({});
  const [subjects, setSubjects] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(new Set());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [showAddMedia, setShowAddMedia] = useState(false);
  const [mediaAsset, setMediaAsset] = useState<{ uri: string; type: "photo" | "video" } | null>(null);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaPublic, setMediaPublic] = useState(true);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [showAddLink, setShowAddLink] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkCaptionInput, setLinkCaptionInput] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      await signOut(auth);
      // Root layout's auth check redirects to /login once user is null.
    } catch (err: any) {
      setDeleteError(err.message ?? "Couldn't delete your account. Please try again or contact support.");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (user) setAvatarUrl(user.photoURL ?? null);
  }, [user]);

  async function handleChangeAvatar() {
    if (!user) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;

    setAvatarUploading(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `avatars/${user.uid}/${Date.now()}`;
      const storageRef = ref(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const url = await getDownloadURL(storageRef);
      await updateProfile(user, { photoURL: url });
      await setDoc(doc(db, "users", user.uid), { photoURL: url }, { merge: true });
      setAvatarUrl(url);
    } catch (err) {
      // Previously this only logged to the console — a failed upload (bad network, storage
      // rule rejection, etc.) just silently stopped the spinner with zero explanation, so
      // tapping "Change photo" looked like it had done nothing at all.
      Alert.alert("Couldn't update your photo", "Please check your connection and try again.");
    } finally {
      setAvatarUploading(false);
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
      query(collection(db, "posts"), where("ownerId", "==", user.uid), where("type", "in", ["photo", "video"]), orderBy("createdAt", "desc"))
    );
    setPosts(mediaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    const linkSnap = await getDocs(
      query(collection(db, "posts"), where("ownerId", "==", user.uid), where("type", "==", "link"), orderBy("createdAt", "desc"))
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

  async function pickMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setMediaAsset({ uri: asset.uri, type: asset.type === "video" ? "video" : "photo" });
  }

  async function handleAddMedia() {
    if (!mediaAsset || !user) return;
    setMediaUploading(true);
    setMediaError(null);
    try {
      const response = await fetch(mediaAsset.uri);
      const blob = await response.blob();
      // Same fix as home.tsx: the postId has to be embedded in the storage path *before*
      // upload, not after, so storage.rules' postIsPrivate() check has something to look up.
      // This upload path used to write to the old flat posts/{uid}/{fileName} layout, which
      // storage.rules keeps world-readable for backward compatibility — so a post marked
      // "Private" here still had a fully public, unauthenticated file URL underneath it.
      const postRef = doc(collection(db, "posts"));
      const path = `posts/${user.uid}/${postRef.id}/${Date.now()}`;
      const storageRef = ref(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const mediaUrl = await getDownloadURL(storageRef);

      await setDoc(postRef, {
        type: mediaAsset.type,
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
      setMediaAsset(null);
      setMediaTitle("");
      setMediaPublic(true);
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
        title: linkCaptionInput.trim() || null,
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
      setLinkCaptionInput("");
      await loadProfileData();
    } catch (err: any) {
      setLinkError(err.message ?? "Couldn't fetch that link.");
    } finally {
      setLinkSaving(false);
    }
  }

  if (!user) return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <TouchableOpacity onPress={handleChangeAvatar} style={{ position: "relative" }} disabled={avatarUploading}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={{ width: 52, height: 52, borderRadius: 26 }} />
          ) : (
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>{(user.displayName ?? "M")[0]}</Text>
            </View>
          )}
          <View style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.paper }}>
            {avatarUploading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={{ color: "white", fontSize: 14 }}>✎</Text>
            )}
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {editingName ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                autoFocus
                value={nameInput}
                onChangeText={setNameInput}
                maxLength={40}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 18 }}
              />
              <TouchableOpacity onPress={handleSaveName} disabled={nameSaving}>
                <Text style={{ color: "#E85D5D", fontWeight: "600", fontSize: 17 }}>{nameSaving ? "…" : "Save"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingName(false)}>
                <Text style={{ color: colors.muted, fontSize: 17 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setNameInput(nameOverride ?? user.displayName ?? "");
                setEditingName(true);
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Text style={{ fontWeight: "600" }}>{nameOverride ?? user.displayName ?? "Member"}</Text>
              <Text style={{ color: colors.muted, fontSize: 16 }}>✎</Text>
            </TouchableOpacity>
          )}
          {nameError && <Text style={{ color: "#DC2626", fontSize: 16, marginTop: 2 }}>{nameError}</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>
              {posts.length + links.length} posts
            </Text>
            <View style={{ backgroundColor: "#FBF0D9", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>⭐ {profile.xp ?? 0} xp</Text>
            </View>
            {(profile.streakCount ?? 0) > 0 && (
              <View style={{ backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.brandDark }}>
                  🔥 {profile.streakCount} day{profile.streakCount === 1 ? "" : "s"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => {
            // Fire-and-forget, and called before signOut() while the auth token is still valid —
            // notifySignOut needs request.auth, which is gone the instant signOut() completes.
            notifySignOut().catch(() => {});
            signOut(auth);
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 17 }}>Log out</Text>
        </TouchableOpacity>
      </View>

      {showDeleteConfirm ? (
        <View style={{ borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <Text style={{ fontSize: 17, fontWeight: "600", color: "#7F1D1D", marginBottom: 4 }}>
            Permanently delete your account?
          </Text>
          <Text style={{ fontSize: 16, color: "#7F1D1D", marginBottom: 10 }}>
            This deletes your posts, saved items, lesson progress, and login — it can't be undone.
            {"\n\n"}Mobile subscriptions go through Apple/Google, not Astryks directly, so this can't
            cancel them for you — cancel first in your iPhone/Android subscription settings, or you'll
            keep being charged even after your account is gone.
          </Text>
          {deleteError && <Text style={{ fontSize: 16, color: "#B91C1C", marginBottom: 8 }}>{deleteError}</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={deleting}
              style={{ backgroundColor: "#DC2626", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                {deleting ? "Deleting…" : "Yes, permanently delete"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 16 }}>
          <TouchableOpacity onPress={() => router.push("/blocked-accounts")}>
            <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }}>Blocked accounts</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDeleteConfirm(true)}>
            <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }}>Delete my account</Text>
          </TouchableOpacity>
        </View>
      )}

      {lessons.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: "600" }}>🎓 Learning</Text>
            <Text style={{ fontSize: 15, color: colors.muted }}>
              {lessons.filter((l) => completedLessonIds.has(l.id)).length} of {lessons.length} complete
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {subjects.map((s) => {
              const subjectLessons = lessons.filter((l) => l.subjectId === s.id);
              if (subjectLessons.length === 0) return null;
              const done = subjectLessons.filter((l) => completedLessonIds.has(l.id)).length;
              const pct = Math.round((done / subjectLessons.length) * 100);
              const tier = tierFor(pct);
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => router.push({ pathname: "/learn", params: { subject: s.id } })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}
                >
                  <Text style={{ fontSize: 18 }}>{SUBJECT_ICONS[s.id] ?? "⭐"}</Text>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: "600" }}>{s.name}</Text>
                    <Text style={{ fontSize: 14, color: colors.muted }}>
                      {tier ? `${tier.emoji} ${tier.label}` : `${done}/${subjectLessons.length}`}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <ReferralAndBilling />

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <TouchableOpacity
          onPress={() => setTab("posts")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "posts" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ color: tab === "posts" ? "white" : colors.ink, fontSize: 16 }}>My posts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("links")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "links" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ color: tab === "links" ? "white" : colors.ink, fontSize: 16 }}>Shared links</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("saved")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "saved" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ color: tab === "saved" ? "white" : colors.ink, fontSize: 16 }}>Saved</Text>
        </TouchableOpacity>
      </View>

      {tab === "posts" ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>{posts.length} photos &amp; videos</Text>
            {showAddMedia ? (
              <TouchableOpacity onPress={() => setShowAddMedia(false)}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setShowAddMedia(true)}
                style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "white", fontSize: 19 }}>+</Text>
              </TouchableOpacity>
            )}
          </View>
          {showAddMedia && (
            <View style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, padding: 12, marginBottom: 14, gap: 10 }}>
              <TouchableOpacity
                onPress={pickMedia}
                style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingVertical: 10, alignItems: "center" }}
              >
                <Text style={{ fontSize: 17 }}>{mediaAsset ? "Change photo/video" : "Choose a photo or video"}</Text>
              </TouchableOpacity>
              {mediaAsset?.type === "photo" && (
                <Image source={{ uri: mediaAsset.uri }} style={{ width: "100%", height: 140, borderRadius: 8 }} />
              )}
              <TextInput
                placeholder="Title (optional)"
                value={mediaTitle}
                onChangeText={setMediaTitle}
                style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 18 }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setMediaPublic(true)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: mediaPublic ? colors.ink : "white", borderWidth: 1, borderColor: colors.line + "1A" }}
                >
                  <Text style={{ color: mediaPublic ? "white" : colors.ink, fontSize: 16 }}>🌍 Public</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setMediaPublic(false)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: !mediaPublic ? colors.ink : "white", borderWidth: 1, borderColor: colors.line + "1A" }}
                >
                  <Text style={{ color: !mediaPublic ? "white" : colors.ink, fontSize: 16 }}>🔒 Private</Text>
                </TouchableOpacity>
              </View>
              {mediaError && <Text style={{ color: "#DC2626", fontSize: 16 }}>{mediaError}</Text>}
              <TouchableOpacity
                onPress={handleAddMedia}
                disabled={mediaUploading || !mediaAsset}
                style={{ backgroundColor: "#E85D5D", borderRadius: 8, paddingVertical: 10, alignItems: "center", opacity: mediaUploading || !mediaAsset ? 0.5 : 1 }}
              >
                <Text style={{ color: "white", fontWeight: "600", fontSize: 17 }}>{mediaUploading ? "Posting…" : "Post"}</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {posts.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => router.push(`/post/${p.id}`)}
                style={{ width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink }}
              >
                {p.type === "photo" ? (
                  <PostThumb post={p} />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "white" }}>▶</Text>
                  </View>
                )}
                {p.visibility === "private" && (
                  <View style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13 }}>🔒</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            {posts.length === 0 && !showAddMedia && <Text style={{ color: colors.muted }}>No posts yet.</Text>}
          </View>
        </View>
      ) : tab === "links" ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>{links.length} shared links</Text>
            {showAddLink ? (
              <TouchableOpacity onPress={() => setShowAddLink(false)}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setShowAddLink(true)}
                style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "white", fontSize: 19 }}>+</Text>
              </TouchableOpacity>
            )}
          </View>
          {showAddLink && (
            <View style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, padding: 12, marginBottom: 14, gap: 10 }}>
              <TextInput
                autoFocus
                placeholder="Paste a YouTube or other link"
                value={linkInput}
                onChangeText={setLinkInput}
                style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 18 }}
              />
              <TextInput
                placeholder="Say something about it (optional)"
                value={linkCaptionInput}
                onChangeText={setLinkCaptionInput}
                multiline
                style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 18, minHeight: 60, textAlignVertical: "top" }}
              />
              {linkError && <Text style={{ color: "#DC2626", fontSize: 16 }}>{linkError}</Text>}
              <TouchableOpacity
                onPress={handleAddLink}
                disabled={linkSaving || !linkInput.trim()}
                style={{ backgroundColor: "#E85D5D", borderRadius: 8, paddingVertical: 10, alignItems: "center", opacity: linkSaving || !linkInput.trim() ? 0.5 : 1 }}
              >
                <Text style={{ color: "white", fontWeight: "600", fontSize: 17 }}>{linkSaving ? "Sharing…" : "Share"}</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ gap: 8 }}>
            {links.map((l) => (
              <TouchableOpacity
                key={l.id}
                onPress={() => router.push(`/post/${l.id}`)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, padding: 10 }}
              >
                {l.linkImage ? (
                  <Image source={{ uri: l.linkImage }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.ink }} />
                ) : (
                  <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 20 }}>🔗</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, color: colors.muted }}>{l.linkDomain}</Text>
                  <Text style={{ fontSize: 18, fontWeight: "600" }} numberOfLines={1}>{l.linkTitle}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {links.length === 0 && !showAddLink && <Text style={{ color: colors.muted }}>No shared links yet.</Text>}
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {saved.map((p) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => router.push(`/post/${p.id}`)}
              style={{ width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
            >
              {p.type === "photo" ? (
                <PostThumb post={p} />
              ) : (
                <Text style={{ color: "white" }}>{p.type === "link" ? "🔗" : "▶"}</Text>
              )}
            </TouchableOpacity>
          ))}
          {saved.length === 0 && <Text style={{ color: colors.muted }}>Nothing saved yet.</Text>}
        </View>
      )}

      <View style={{ marginTop: 32, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.line + "1A", alignItems: "center" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
          <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/privacy")}>
            Privacy
          </Text>
          <Text style={{ fontSize: 15, color: colors.muted }}> · </Text>
          <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/terms")}>
            Terms
          </Text>
          <Text style={{ fontSize: 15, color: colors.muted }}> · </Text>
          <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/prize-rules")}>
            Prize Rules
          </Text>
          <Text style={{ fontSize: 15, color: colors.muted }}> · </Text>
          <Text style={{ fontSize: 15, color: colors.muted, textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://astryks.com/support")}>
            Support
          </Text>
        </View>
        <Text style={{ fontSize: 15, color: colors.muted, marginTop: 6 }}>© 2026 Astryks. All rights reserved.</Text>
      </View>
    </ScrollView>
  );
}
