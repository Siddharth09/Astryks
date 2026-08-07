import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { collection, getDocs, query, where, orderBy, doc, getDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { signOut, updateProfile } from "firebase/auth";
import { db, auth, storage } from "@/lib/firebase";
import ReferralAndBilling from "@/components/ReferralAndBilling";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

export default function MeScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"posts" | "links" | "notes" | "saved">("posts");
  const [posts, setPosts] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ streakCount?: number; xp?: number }>({});
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

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
      console.log("Avatar upload failed:", err);
    } finally {
      setAvatarUploading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      setProfile(userSnap.data() ?? {});

      const mediaSnap = await getDocs(
        query(collection(db, "posts"), where("ownerId", "==", user.uid), where("type", "in", ["photo", "video"]), orderBy("createdAt", "desc"))
      );
      setPosts(mediaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const linkSnap = await getDocs(
        query(collection(db, "posts"), where("ownerId", "==", user.uid), where("type", "==", "link"), orderBy("createdAt", "desc"))
      );
      setLinks(linkSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const notesSnap = await getDocs(
        query(collection(db, "posts"), where("ownerId", "==", user.uid), where("type", "==", "text"), orderBy("createdAt", "desc"))
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
              <Text style={{ color: "white", fontSize: 10 }}>✎</Text>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={handleChangeAvatar} disabled={avatarUploading}>
          <Text style={{ fontWeight: "600" }}>{user.displayName ?? "Member"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {posts.length + links.length + notes.length} posts
            </Text>
            <View style={{ backgroundColor: "#FBF0D9", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.ink }}>⭐ {profile.xp ?? 0} xp</Text>
            </View>
            {(profile.streakCount ?? 0) > 0 && (
              <View style={{ backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.brandDark }}>
                  🔥 {profile.streakCount} day{profile.streakCount === 1 ? "" : "s"}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => signOut(auth)}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Log out</Text>
        </TouchableOpacity>
      </View>

      <ReferralAndBilling />

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <TouchableOpacity
          onPress={() => setTab("posts")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "posts" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line }}
        >
          <Text style={{ color: tab === "posts" ? "white" : colors.ink, fontSize: 12 }}>My posts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("links")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "links" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line }}
        >
          <Text style={{ color: tab === "links" ? "white" : colors.ink, fontSize: 12 }}>Shared links</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("notes")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "notes" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line }}
        >
          <Text style={{ color: tab === "notes" ? "white" : colors.ink, fontSize: 12 }}>Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab("saved")}
          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: tab === "saved" ? colors.ink : "white", borderWidth: 1, borderColor: colors.line }}
        >
          <Text style={{ color: tab === "saved" ? "white" : colors.ink, fontSize: 12 }}>Saved</Text>
        </TouchableOpacity>
      </View>

      {tab === "posts" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {posts.map((p) => (
            <View key={p.id} style={{ width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink }}>
              {p.type === "photo" ? (
                <Image source={{ uri: p.mediaUrl }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white" }}>▶</Text>
                </View>
              )}
            </View>
          ))}
          {posts.length === 0 && <Text style={{ color: colors.muted }}>No posts yet.</Text>}
        </View>
      ) : tab === "links" ? (
        <View style={{ gap: 8 }}>
          {links.map((l) => (
            <View key={l.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 18 }}>🔗</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{l.linkDomain}</Text>
                <Text style={{ fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{l.linkTitle}</Text>
              </View>
            </View>
          ))}
          {links.length === 0 && <Text style={{ color: colors.muted }}>No shared links yet.</Text>}
        </View>
      ) : tab === "notes" ? (
        <View style={{ gap: 8 }}>
          {notes.map((n) => (
            <TouchableOpacity key={n.id} onPress={() => router.push(`/post/${n.id}`)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 }}>
              <Text numberOfLines={3} style={{ fontSize: 14 }}>{n.body}</Text>
            </TouchableOpacity>
          ))}
          {notes.length === 0 && <Text style={{ color: colors.muted }}>No notes yet.</Text>}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {saved.map((p) => (
            <View key={p.id} style={{ width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
              {p.type === "photo" ? (
                <Image source={{ uri: p.mediaUrl }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <Text style={{ color: "white" }}>{p.type === "link" ? "🔗" : "▶"}</Text>
              )}
            </View>
          ))}
          {saved.length === 0 && <Text style={{ color: colors.muted }}>Nothing saved yet.</Text>}
        </View>
      )}
    </ScrollView>
  );
}
