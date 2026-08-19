import { useEffect, useRef, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { collection, getDocs, query, where, addDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, storage, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import PostCard from "@/components/PostCard";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import TrailersSection from "@/components/TrailersSection";
import { FeedSkeleton } from "@/components/Skeleton";
import BrandMark from "@/components/BrandMark";
import SuggestionsRow from "@/components/SuggestionsRow";
import PrizeInfoModal from "@/components/PrizeInfoModal";
import { colors } from "@/lib/styles";

const fetchLinkPreview = httpsCallable(functions, "fetchLinkPreview");
const getFeed = httpsCallable(functions, "getFeed");

// Same public/private choice for every post type (text, link, photo/video) — shared here since
// it's now shown in three different composer steps below instead of duplicating the same
// buttons three times.
function VisibilityToggle({ isPublic, setIsPublic }: { isPublic: boolean; setIsPublic: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity
        onPress={() => setIsPublic(true)}
        style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: isPublic ? colors.ink : "white", borderWidth: isPublic ? 0 : 1, borderColor: colors.line }}
      >
        <Text style={{ color: isPublic ? "white" : colors.ink, fontSize: 14, fontWeight: "600" }}>🌍 Public</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setIsPublic(false)}
        style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: !isPublic ? colors.ink : "white", borderWidth: !isPublic ? 0 : 1, borderColor: colors.line }}
      >
        <Text style={{ color: !isPublic ? "white" : colors.ink, fontSize: 14, fontWeight: "600" }}>🔒 Private</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allPosts, setAllPosts] = useState<any[] | null>(null);
  const [posts, setPosts] = useState<any[] | null>(null);
  const [scope, setScope] = useState<"everyone" | "following">("everyone");
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string | null>(null);
  // A picked-but-not-yet-posted photo/video, waiting on the public/private choice below before
  // it actually uploads — previously shareMedia() uploaded and posted the instant something was
  // picked, with no chance to choose visibility at all (unlike web, which always showed this
  // choice for photo/video posts).
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: "photo" | "video" } | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [prizeInfoOpen, setPrizeInfoOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) setActiveId(viewableItems[0].item.id);
  }).current;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading]);

  async function load() {
    // Fetched via a Cloud Function rather than a direct Firestore query: Firestore security
    // rules can't filter a list query, so a broad "all posts" read has to be done server-side
    // (with the Admin SDK) to correctly hide other people's private posts.
    // "Following" filters this same feed client-side, so it asks for a wider page up front
    // (still capped server-side) rather than the small page "Everyone" pages through — otherwise
    // it'd usually come back empty since most of a small first page won't be people you follow.
    const result = await getFeed(scope === "following" ? { pageSize: 100 } : {});
    const data = result.data as any;
    setAllPosts(data.posts);
    setCursor(data.nextCursor);
    setHasMore(data.hasMore);
  }

  useEffect(() => {
    if (user) load();
  }, [user, scope]);

  async function loadMore() {
    if (!user || loadingMore || !hasMore || !cursor) return;
    setLoadingMore(true);
    try {
      const result = await getFeed(scope === "following" ? { cursor, pageSize: 100 } : { cursor });
      const data = result.data as any;
      setAllPosts((prev) => (prev ? [...prev, ...data.posts] : data.posts));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

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

  async function pickMedia() {
    // Was quality: 1 (uncompressed) — a modern phone photo at full quality can be 5-10MB+,
    // meaning every single photo post in the feed had to fully download that before it could
    // even display, no resizing or thumbnail anywhere in the pipeline. 0.7 matches what me.tsx
    // already uses for profile photos and cuts typical file size dramatically with no visible
    // quality loss at feed-card size.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
    });
    if (result.canceled || !user) return;
    const asset = result.assets[0];
    setPendingMedia({ uri: asset.uri, type: asset.type === "video" ? "video" : "photo" });
    setIsPublic(true);
  }

  async function postMedia() {
    if (!pendingMedia || !user) return;
    const { uri, type } = pendingMedia;
    const response = await fetch(uri);
    const blob = await response.blob();
    // Pre-generate the post's Firestore doc ID and fold it into the storage path (rather than
    // a bare timestamp) so storage.rules can look up *this exact post's* visibility before
    // serving the file — see the posts/{userId}/{postId}/{fileName} match block there. Without
    // the postId in the path, Storage has no way to know which post a file belongs to, so a
    // "private" post's media stayed just as publicly fetchable as a public one's.
    const postRef = doc(collection(db, "posts"));
    const path = `posts/${user.uid}/${postRef.id}/${Date.now()}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, blob);

    await new Promise<void>((resolve, reject) => {
      task.on("state_changed", undefined, reject, () => resolve());
    });
    const mediaUrl = await getDownloadURL(storageRef);

    await setDoc(postRef, {
      type,
      title: null,
      mediaUrl,
      mediaPath: path,
      visibility: isPublic ? "public" : "private",
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
    setPendingMedia(null);
    load();
  }

  async function shareText() {
    if (!textInput || !textInput.trim() || !user) return;
    await addDoc(collection(db, "posts"), {
      type: "text",
      body: textInput,
      visibility: isPublic ? "public" : "private",
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
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
      visibility: isPublic ? "public" : "private",
      ownerId: user.uid,
      ownerName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
    });
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
        <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <BrandMark size={24} />
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

  // Everything above the post list used to be rendered as fixed siblings next to the FlatList,
  // so only the posts themselves scrolled — swiping down on a photo just scrolled that one card
  // instead of moving through the feed, since half the screen (header, banner, composer,
  // search, suggestions) never moved. Moving all of it into ListHeaderComponent makes the whole
  // screen one continuous scrollable list, the way Instagram's feed works.
  const listHeader = (
    <>
      <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <BrandMark size={24} />
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
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
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
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
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
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
        </View>
      ) : pendingMedia !== null ? (
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={{ fontSize: 15, color: colors.muted }}>
            {pendingMedia.type === "video" ? "🎥 Video ready to post" : "🖼️ Photo ready to post"}
          </Text>
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity onPress={() => setPendingMedia(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: "white" }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={postMedia} style={{ flex: 1, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "white" }}
        >
          <TouchableOpacity onPress={() => setTextInput("")} style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 15 }}>Share something…</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickMedia}><Text style={{ fontSize: 16 }}>📷</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setLinkInput("")}><Text style={{ fontSize: 16 }}>🔗</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setPrizeInfoOpen(true)} accessibilityLabel="About the creative prize">
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
        </View>
      )}

      <PrizeInfoModal visible={prizeInfoOpen} onClose={() => setPrizeInfoOpen(false)} generic />

      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search posts by person, text, or link…"
          style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", fontSize: 15 }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
        <TouchableOpacity
          onPress={() => setScope("everyone")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "everyone" ? colors.ink : "transparent", borderWidth: scope === "everyone" ? 0 : 1, borderColor: colors.line }}
        >
          <Text style={{ fontSize: 14, color: scope === "everyone" ? "white" : colors.ink }}>Everyone</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setScope("following")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "following" ? colors.ink : "transparent", borderWidth: scope === "following" ? 0 : 1, borderColor: colors.line }}
        >
          <Text style={{ fontSize: 14, color: scope === "following" ? "white" : colors.ink }}>Following</Text>
        </TouchableOpacity>
      </View>

      {scope === "everyone" && <SuggestionsRow currentUserId={user.uid} />}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <FlatList
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          // Horizontal padding lives here (on each post) rather than on contentContainerStyle,
          // since the header sections above already carry their own padding — putting it on the
          // shared container too would double it up for the header content.
          <View style={{ paddingHorizontal: 16 }}>
            <PostCard
              post={item}
              currentUserId={user.uid}
              isActive={item.id === activeId}
              onDeleted={(id) => {
                setAllPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
                setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
              }}
            />
          </View>
        )}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
        onEndReached={searchQ ? undefined : loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: 20 }} color={colors.ink} /> : null
        }
        ListEmptyComponent={
          <Text style={{ textAlign: "center", color: colors.muted, marginTop: 40 }}>
            {searchQ ? `No posts match "${searchQuery}".` : "Nothing here yet."}
          </Text>
        }
      />
    </View>
  );
}
