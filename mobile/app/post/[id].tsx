import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Image, Linking, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Video, ResizeMode } from "expo-av";
import { WebView } from "react-native-webview";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import LikeButton from "@/components/LikeButton";
import Comments from "@/components/Comments";
import { colors } from "@/lib/styles";

const deletePostFn = httpsCallable(functions, "deletePost");
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      let snap;
      try {
        snap = await getDoc(doc(db, "posts", id));
      } catch (err: any) {
        // A private post that isn't ours surfaces as permission-denied rather than "not found".
        if (err?.code === "permission-denied") {
          setBlocked(true);
          setLoading(false);
          return;
        }
        throw err;
      }
      if (snap.exists()) {
        setPost({ id: snap.id, ...snap.data() });
        const commentsSnap = await getDocs(query(collection(db, "posts", id, "comments"), orderBy("createdAt", "asc")));
        setComments(commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, [id]);

  if (blocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
          style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
        >
          <Text style={{ fontSize: 20 }}>←</Text>
          <Text style={{ fontSize: 15, color: colors.ink }}>Back</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>This post is private.</Text>
      </View>
    );
  }

  if (loading || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
          style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
        >
          <Text style={{ fontSize: 20 }}>←</Text>
          <Text style={{ fontSize: 15, color: colors.ink }}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </View>
    );
  }

  const createdDate = post.createdAt?.toDate ? post.createdAt.toDate() : new Date();
  const canDelete = user && (user.uid === post.ownerId || ADMIN_EMAILS.includes(user.email ?? ""));

  function confirmDelete() {
    Alert.alert("Delete this post?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deletePostFn({ postId: post.id });
            router.replace("/(tabs)/home");
          } catch (err: any) {
            Alert.alert("Couldn't delete", err.message ?? "Something went wrong.");
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
      <TouchableOpacity
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={{ fontSize: 20 }}>←</Text>
        <Text style={{ fontSize: 15, color: colors.ink }}>Back</Text>
      </TouchableOpacity>
      {post.type === "video" && post.bunnyVideoId && (
        <WebView source={{ uri: `https://iframe.mediadelivery.net/embed/${post.bunnyLibraryId}/${post.bunnyVideoId}` }} style={{ width: "100%", height: 240, borderRadius: 16 }} />
      )}
      {post.type === "video" && !post.bunnyVideoId && (
        <Video source={{ uri: post.mediaUrl }} style={{ width: "100%", height: 240, borderRadius: 16 }} useNativeControls resizeMode={ResizeMode.CONTAIN} />
      )}
      {post.type === "photo" && <Image source={{ uri: post.mediaUrl }} style={{ width: "100%", height: 260, borderRadius: 16 }} />}
      {post.type === "text" && (
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{post.body}</Text>
      )}
      {post.type === "link" && (
        <TouchableOpacity onPress={() => Linking.openURL(post.linkUrl)} style={{ flexDirection: "row", gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 12 }}>
          {post.linkImage && <Image source={{ uri: post.linkImage }} style={{ width: 64, height: 64, borderRadius: 10 }} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>{post.linkDomain}</Text>
            <Text style={{ fontWeight: "600" }}>{post.linkTitle}</Text>
          </View>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{post.ownerName ?? "Member"} · {createdDate.toLocaleDateString()}</Text>
        {canDelete && (
          <TouchableOpacity onPress={confirmDelete} disabled={deleting} style={{ marginLeft: "auto" }}>
            <Text style={{ color: "#B91C1C", fontSize: 13 }}>{deleting ? "Deleting…" : "Delete"}</Text>
          </TouchableOpacity>
        )}
      </View>
      {post.title ? <Text style={{ fontSize: 20, fontWeight: "700", marginTop: 6, marginBottom: 6 }}>{post.title}</Text> : null}
      <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={user?.uid ?? null} />

      <Comments postId={post.id} initialComments={comments} />
    </ScrollView>
  );
}
