import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Image, Linking, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { WebView } from "react-native-webview";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PrivacyLockScreen from "@/components/PrivacyLockScreen";
import LikeButton from "@/components/LikeButton";
import Comments from "@/components/Comments";
import ShareMenu from "@/components/ShareMenu";
import PersistentTabBar from "@/components/PersistentTabBar";
import { colors } from "@/lib/styles";
import { ADMIN_EMAILS } from "@/lib/admin";

const deletePostFn = httpsCallable(functions, "deletePost");

// "link" posts store an arbitrary URL supplied by whoever created the post — Firestore rules
// only check the post's type/ownerId, not the contents of linkUrl. Without this check, any
// signed-in user could make a link post pointing at something other than a normal http(s) page
// (e.g. an intent:// URI on Android) and have it open silently on someone else's device just
// from viewing the post. Restrict to plain http/https before ever calling Linking.openURL.
function openIfSafeUrl(url?: string) {
  if (!url) return;
  try {
    const scheme = new URL(url).protocol;
    if (scheme === "http:" || scheme === "https:") {
      Linking.openURL(url);
    }
  } catch {
    // Not a parseable URL — ignore rather than hand it to Linking.openURL.
  }
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { locked: privacyLocked } = usePrivacyLock();
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // expo-av's <Video> doesn't reliably render/play under the New Architecture (app.json has
  // newArchEnabled: true) — see the same migration note in components/PostCard.tsx. Called
  // unconditionally (before the early returns below) since hooks can't be conditional; source
  // is just null until `post` has loaded.
  const isNativeVideo = post?.type === "video" && !post?.bunnyVideoId;
  const player = useVideoPlayer(isNativeVideo ? post.mediaUrl : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snap;
      try {
        snap = await getDoc(doc(db, "posts", id));
      } catch (err: any) {
        // A private post that isn't ours surfaces as permission-denied rather than "not found".
        if (err?.code === "permission-denied") {
          if (!cancelled) {
            setBlocked(true);
            setLoading(false);
          }
          return;
        }
        throw err;
      }
      if (cancelled) return;
      if (snap.exists()) {
        setPost({ id: snap.id, ...snap.data() });
        const commentsSnap = await getDocs(query(collection(db, "posts", id, "comments"), orderBy("createdAt", "asc")));
        if (cancelled) return;
        setComments(commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (privacyLocked) {
    return <PrivacyLockScreen label="This" />;
  }

  if (blocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={{ flex: 1, paddingTop: 56, paddingHorizontal: 16 }}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
            style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
          >
            <Text style={{ fontSize: 22 }}>←</Text>
            <Text style={{ fontSize: 19, color: colors.ink }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>This post is private.</Text>
        </View>
        <PersistentTabBar />
      </View>
    );
  }

  if (loading || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={{ flex: 1, paddingTop: 56, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
          style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
        >
          <Text style={{ fontSize: 22 }}>←</Text>
          <Text style={{ fontSize: 19, color: colors.ink }}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.ink} />
        </View>
        </View>
        <PersistentTabBar />
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
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
      <TouchableOpacity
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={{ fontSize: 22 }}>←</Text>
        <Text style={{ fontSize: 19, color: colors.ink }}>Back</Text>
      </TouchableOpacity>
      {post.type === "video" && post.bunnyVideoId && (
        <WebView source={{ uri: `https://iframe.mediadelivery.net/embed/${post.bunnyLibraryId}/${post.bunnyVideoId}` }} style={{ width: "100%", height: 240, borderRadius: 16 }} />
      )}
      {post.type === "video" && !post.bunnyVideoId && (
        <VideoView player={player} style={{ width: "100%", height: 240, borderRadius: 16 }} nativeControls contentFit="contain" />
      )}
      {post.type === "photo" && <Image source={{ uri: post.mediaUrl }} style={{ width: "100%", height: 260, borderRadius: 16 }} />}
      {post.type === "text" && (
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.ink }}>{post.body}</Text>
      )}
      {post.type === "link" && (
        <TouchableOpacity onPress={() => openIfSafeUrl(post.linkUrl)} style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 16, overflow: "hidden" }}>
          {post.linkImage ? (
            <Image source={{ uri: post.linkImage }} style={{ width: "100%", height: 200 }} />
          ) : (
            <View style={{ width: "100%", height: 200, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 33 }}>🔗</Text>
            </View>
          )}
          <View style={{ padding: 12 }}>
            <Text style={{ fontSize: 16, color: colors.muted }}>{post.linkDomain}</Text>
            <Text style={{ fontWeight: "600" }}>{post.linkTitle}</Text>
          </View>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
        <Text style={{ color: colors.muted, fontSize: 16 }}>{post.ownerName ?? "Member"} · {createdDate.toLocaleDateString()}</Text>
        {canDelete && (
          <TouchableOpacity onPress={confirmDelete} disabled={deleting} style={{ marginLeft: "auto" }}>
            <Text style={{ color: "#B91C1C", fontSize: 17 }}>{deleting ? "Deleting…" : "Delete"}</Text>
          </TouchableOpacity>
        )}
      </View>
      {post.title ? <Text style={{ fontSize: 22, fontWeight: "700", marginTop: 6, marginBottom: 6 }}>{post.title}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={user?.uid ?? null} postOwnerId={post.ownerId} />
        <View style={{ marginLeft: "auto" }}>
          <ShareMenu postId={post.id} title={post.title} />
        </View>
      </View>

      <Comments postId={post.id} initialComments={comments} />
    </ScrollView>
    <PersistentTabBar />
    </View>
  );
}
