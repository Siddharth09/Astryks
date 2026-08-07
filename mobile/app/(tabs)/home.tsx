import { useEffect, useRef, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { collection, getDocs, orderBy, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, storage, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import PostCard from "@/components/PostCard";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import TrailersSection from "@/components/TrailersSection";
import { FeedSkeleton } from "@/components/Skeleton";
import { colors } from "@/lib/styles";

const fetchLinkPreview = httpsCallable(functions, "fetchLinkPreview");
const bumpStreak = httpsCallable(functions, "bumpStreak");

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allPosts, setAllPosts] = useState<any[] | null>(null);
  const [posts, setPosts] = useState<any[] | null>(null);
  const [scope, setScope] = useState<"everyone" | "following">("everyone");
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) setActiveId(viewableItems[0].item.id);
  }).current;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading]);

  async function load() {
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    setAllPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    if (!user || allPosts === null) return;
    (async () => {
      if (scope === "everyone") {
        setPosts(allPosts);
        return;
      }
      const followsSnap = await getDocs(query(collection(db, "follows"), where("followerId", "==", user.uid)));
      const followingIds = new Set(followsSnap.docs.map((d) => d.data().followingId));
      followingIds.add(user.uid);
      setPosts(allPosts.filter((p) => followingIds.has(p.ownerId)));
    })();
  }, [scope, allPosts, user]);

  async function shareMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
    });
    if (result.canceled || !user) return;

    const asset = result.assets[0];
    const type = asset.type === "video" ? "video" : "photo";
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const path = `posts/${user.uid}/${Date.now()}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, blob);

    await new Promise<void>((resolve, reject) => {
      task.on("state_changed", undefined, reject, () => resolve());
    });
    const mediaUrl = await getDownloadURL(storageRef);

    await addDoc(collection(db, "posts"), {
      type,
      title: null,
      mediaUrl,
      mediaPath: path,
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
    bumpStreak().catch(() => {});
    load();
  }

  async function shareText() {
    if (!textInput || !textInput.trim() || !user) return;
    await addDoc(collection(db, "posts"), {
      type: "text",
      body: textInput,
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
    bumpStreak().catch(() => {});
    setTextInput(null);
    load();
  }

  async function shareLink() {
    if (!linkInput || !user) return;
    const result = await fetchLinkPreview({ url: linkInput });
    const preview = result.data as { title: string; image: string | null; domain: string };

    await addDoc(collection(db, "posts"), {
      type: "link",
      linkUrl: linkInput,
      linkTitle: preview.title,
      linkImage: preview.image,
      linkDomain: preview.domain,
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
    bumpStreak().catch(() => {});
    setLinkInput(null);
    load();
  }

  if (authLoading || !user) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (allPosts === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <Text style={{ fontSize: 18, fontWeight: "700" }}>Astryks</Text>
        </View>
        <View style={{ padding: 16 }}>
          <FeedSkeleton />
        </View>
      </View>
    );
  }

  const searchQ = searchQuery.trim().toLowerCase();
  const visiblePosts = !searchQ
    ? posts ?? []
    : (posts ?? []).filter((p) =>
        [p.ownerName, p.body, p.title, p.linkTitle, p.linkDomain].some((field) =>
          field?.toLowerCase().includes(searchQ)
        )
      );

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Astryks</Text>
      </View>

      <SubscriptionBanner />

      <View style={{ marginTop: 12 }}>
        <TrailersSection />
      </View>

      {textInput !== null ? (
        <View style={{ padding: 12, gap: 8 }}>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", minHeight: 80, textAlignVertical: "top" }}
            placeholder="Write something…"
            value={textInput}
            onChangeText={setTextInput}
            multiline
            autoFocus
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity onPress={() => setTextInput(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: "white" }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareText} style={{ flex: 1, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : linkInput !== null ? (
        <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
          <TextInput
            style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, backgroundColor: "white" }}
            placeholder="Paste a link"
            value={linkInput}
            onChangeText={setLinkInput}
          />
          <TouchableOpacity onPress={() => setLinkInput(null)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "white" }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareLink} style={{ backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" }}>
            <Text style={{ color: "white", fontWeight: "600" }}>Share</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "white" }}
        >
          <TouchableOpacity onPress={() => setTextInput("")} style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Share something…</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareMedia}><Text style={{ fontSize: 16 }}>📷</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setLinkInput("")}><Text style={{ fontSize: 16 }}>🔗</Text></TouchableOpacity>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search posts by person, text, or link…"
          style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", fontSize: 13 }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
        <TouchableOpacity
          onPress={() => setScope("everyone")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "everyone" ? colors.ink : "transparent", borderWidth: scope === "everyone" ? 0 : 1, borderColor: colors.line }}
        >
          <Text style={{ fontSize: 12, color: scope === "everyone" ? "white" : colors.ink }}>Everyone</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setScope("following")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "following" ? colors.ink : "transparent", borderWidth: scope === "following" ? 0 : 1, borderColor: colors.line }}
        >
          <Text style={{ fontSize: 12, color: scope === "following" ? "white" : colors.ink }}>Following</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        renderItem={({ item }) => <PostCard post={item} currentUserId={user.uid} isActive={item.id === activeId} />}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          <Text style={{ textAlign: "center", color: colors.muted, marginTop: 40 }}>
            {searchQ ? `No posts match "${searchQuery}".` : "Nothing here yet."}
          </Text>
        }
      />
    </View>
  );
}
