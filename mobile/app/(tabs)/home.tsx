import { useEffect, useRef, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { collection, getDocs, query, where, addDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, storage, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PrivacyLockScreen from "@/components/PrivacyLockScreen";
import PostCard from "@/components/PostCard";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import TrailersSection from "@/components/TrailersSection";
import { FeedSkeleton } from "@/components/Skeleton";
import BrandMark from "@/components/BrandMark";
import SuggestionsRow from "@/components/SuggestionsRow";
import HallOfFameGrid from "@/components/HallOfFameGrid";
import { colors } from "@/lib/styles";
import { guessMediaUploadInfo } from "@/lib/mediaUpload";

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
        style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: isPublic ? colors.ink : "white", borderWidth: isPublic ? 0 : 1, borderColor: colors.line + "1A" }}
      >
        <Text style={{ color: isPublic ? "white" : colors.ink, fontSize: 16, fontWeight: "600" }}>🌍 Public</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setIsPublic(false)}
        style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: !isPublic ? colors.ink : "white", borderWidth: !isPublic ? 0 : 1, borderColor: colors.line + "1A" }}
      >
        <Text style={{ color: !isPublic ? "white" : colors.ink, fontSize: 16, fontWeight: "600" }}>🔒 Private</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const { locked: privacyLocked } = usePrivacyLock();
  const navigation = useNavigation();
  // "Home" (the feed) vs "Hall of Fame" (the featured gallery) — a sub-tab within Home rather
  // than its own top-level tab, replacing the old separate Prizes tab.
  const [view, setView] = useState<"feed" | "hallOfFame">("feed");

  // Re-tapping the already-active Home tab previously did nothing if you were sitting on the
  // Hall of Fame sub-tab — there was no way back to the feed except manually tapping the "Home"
  // pill. Mirrors the same tabPress pattern learn.tsx already uses to reset itself.
  //
  // Also refetches the feed itself. blockUser (functions/index.js) filters a blocked member's
  // posts server-side in every future getFeed call, but this screen's own already-loaded
  // `allPosts` state doesn't know that — without this, blocking someone from their profile and
  // tapping back to an already-mounted Home tab still showed their posts until the next manual
  // pull-to-refresh. App Store Guideline 1.2 expects blocking to remove content from the feed
  // right away, so re-tapping Home (the natural thing to do right after blocking someone from
  // their profile) is what makes that "instant" in practice.
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener("tabPress", () => {
      setView("feed");
      load();
    });
    return unsubscribe;
  }, [navigation]);
  const [allPosts, setAllPosts] = useState<any[] | null>(null);
  const [posts, setPosts] = useState<any[] | null>(null);
  const [scope, setScope] = useState<"everyone" | "following">("everyone");
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string | null>(null);
  // A picked-but-not-yet-posted photo/video, waiting on the public/private choice below before
  // it actually uploads — previously shareMedia() uploaded and posted the instant something was
  // picked, with no chance to choose visibility at all (unlike web, which always showed this
  // choice for photo/video posts).
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: "photo" | "video"; mimeType?: string | null; fileName?: string | null } | null>(null);
  // Shared caption field for both the photo/video and link composers below — previously neither
  // flow captured any user-written text at all, so a shared link or photo/video posted zero
  // context of your own alongside it.
  const [captionInput, setCaptionInput] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  // Shared across all three compose flows below (text/link/media) — previously none of them
  // had any loading or error state at all, so a failed post (offline, a rules rejection) just
  // silently did nothing: no feedback, and the compose UI stayed open with the pending
  // caption/media as if nothing had been tried.
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Lower than a strict "must be mostly on screen" bar — with the tall header above the feed
  // (brand bar, banner, trailers, composer, toggle, suggestions), the first post often doesn't
  // cross a 60% threshold until the user scrolls, which meant its video never got `isActive` and
  // just sat on its paused first frame looking like a still image.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 25 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) setActiveId(viewableItems[0].item.id);
  }).current;

  // Belt-and-suspenders for the same issue: seed the first post as active as soon as the feed
  // loads, rather than waiting on a viewability callback that may not fire for it at all if it
  // starts out below the fold behind the header content above.
  useEffect(() => {
    if (activeId === null && posts && posts.length > 0) {
      setActiveId(posts[0].id);
    }
  }, [posts, activeId]);

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
    setPendingMedia({
      uri: asset.uri,
      type: asset.type === "video" ? "video" : "photo",
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });
    setIsPublic(true);
  }

  async function postMedia() {
    if (!pendingMedia || !user) return;
    setComposeLoading(true);
    setComposeError(null);
    try {
      const { uri, type } = pendingMedia;
      const response = await fetch(uri);
      const blob = await response.blob();
      // Pre-generate the post's Firestore doc ID and fold it into the storage path (rather than
      // a bare timestamp) so storage.rules can look up *this exact post's* visibility before
      // serving the file — see the posts/{userId}/{postId}/{fileName} match block there. Without
      // the postId in the path, Storage has no way to know which post a file belongs to, so a
      // "private" post's media stayed just as publicly fetchable as a public one's.
      // A real extension + explicit content-type (rather than a bare timestamp and whatever type
      // the blob happened to carry) matters most for video — see guessMediaUploadInfo's comment.
      const { contentType, extension } = guessMediaUploadInfo(pendingMedia);
      const postRef = doc(collection(db, "posts"));
      const path = `posts/${user.uid}/${postRef.id}/${Date.now()}.${extension}`;
      const storageRef = ref(storage, path);
      const task = uploadBytesResumable(storageRef, blob, { contentType });

      await new Promise<void>((resolve, reject) => {
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const mediaUrl = await getDownloadURL(storageRef);

      await setDoc(postRef, {
        type,
        title: captionInput.trim() || null,
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
      setCaptionInput("");
      // A freshly-posted video landing at the top of the feed doesn't naturally trigger
      // onViewableItemsChanged (nothing scrolled — the list just re-rendered with new data at
      // the same scroll position), and the "seed the first post as active" effect below only
      // fires once, the very first time the feed loads (activeId === null) — so without this,
      // a new video sat there as a static first-frame image, playable only once you scrolled
      // enough to trigger a fresh viewability check. postRef.id is already known (generated
      // before the upload, for the storage.rules path above), so just mark it active directly.
      setActiveId(postRef.id);
      load();
    } catch (err: any) {
      setComposeError(err.message ?? "Couldn't post that — please try again.");
    } finally {
      setComposeLoading(false);
    }
  }

  async function shareText() {
    if (!textInput || !textInput.trim() || !user) return;
    setComposeLoading(true);
    setComposeError(null);
    try {
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
    } catch (err: any) {
      setComposeError(err.message ?? "Couldn't post that — please try again.");
    } finally {
      setComposeLoading(false);
    }
  }

  async function shareLink() {
    if (!linkInput || !user) return;
    setComposeLoading(true);
    setComposeError(null);
    try {
      const result = await fetchLinkPreview({ url: linkInput });
      const preview = result.data as { title: string; image: string | null; domain: string };

      await addDoc(collection(db, "posts"), {
        type: "link",
        title: captionInput.trim() || null,
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
      setCaptionInput("");
      load();
    } catch (err: any) {
      setComposeError(err.message ?? "Couldn't fetch that link — please try again.");
    } finally {
      setComposeLoading(false);
    }
  }

  if (privacyLocked) {
    return <PrivacyLockScreen label="Home" />;
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
        <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line + "1A", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <BrandMark size={24} />
          <Text style={{ fontSize: 20, fontWeight: "700" }}>Astryks</Text>
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
      <SubscriptionBanner />

      <View style={{ marginTop: 12 }}>
        <TrailersSection />
      </View>

      {textInput !== null ? (
        <View style={{ padding: 12, gap: 8 }}>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", minHeight: 80, textAlignVertical: "top" }}
            placeholder="Write something…"
            value={textInput}
            onChangeText={setTextInput}
            multiline
            autoFocus
          />
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
          {composeError && <Text style={{ color: "#B3261E", fontSize: 14 }}>{composeError}</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity onPress={() => { setTextInput(null); setComposeError(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: "white" }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareText} disabled={composeLoading} style={{ flex: 1, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 10, alignItems: "center", opacity: composeLoading ? 0.6 : 1 }}>
              <Text style={{ color: "white", fontWeight: "600" }}>{composeLoading ? "Posting…" : "Post"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : linkInput !== null ? (
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "white" }}
              placeholder="Paste a link"
              value={linkInput}
              onChangeText={setLinkInput}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setLinkInput(null); setCaptionInput(""); setComposeError(null); }} style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "white" }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareLink} disabled={composeLoading} style={{ backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center", opacity: composeLoading ? 0.6 : 1 }}>
              <Text style={{ color: "white", fontWeight: "600" }}>{composeLoading ? "Sharing…" : "Share"}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", minHeight: 60, textAlignVertical: "top" }}
            placeholder="Say something about it (optional)"
            value={captionInput}
            onChangeText={setCaptionInput}
            multiline
          />
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
          {composeError && <Text style={{ color: "#B3261E", fontSize: 14 }}>{composeError}</Text>}
        </View>
      ) : pendingMedia !== null ? (
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={{ fontSize: 17, color: colors.muted }}>
            {pendingMedia.type === "video" ? "🎥 Video ready to post" : "🖼️ Photo ready to post"}
          </Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", minHeight: 60, textAlignVertical: "top" }}
            placeholder="Add a caption (optional)"
            value={captionInput}
            onChangeText={setCaptionInput}
            multiline
            autoFocus
          />
          <VisibilityToggle isPublic={isPublic} setIsPublic={setIsPublic} />
          {composeError && <Text style={{ color: "#B3261E", fontSize: 14 }}>{composeError}</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity onPress={() => { setPendingMedia(null); setCaptionInput(""); setComposeError(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: "white" }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={postMedia} disabled={composeLoading} style={{ flex: 1, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 10, alignItems: "center", opacity: composeLoading ? 0.6 : 1 }}>
              <Text style={{ color: "white", fontWeight: "600" }}>{composeLoading ? "Posting…" : "Post"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: 12, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "white" }}
        >
          <TouchableOpacity onPress={() => setTextInput("")} style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 17 }}>Share something…</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickMedia}><Text style={{ fontSize: 18 }}>📷</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setLinkInput("")}><Text style={{ fontSize: 18 }}>🔗</Text></TouchableOpacity>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search posts by person, text, or link…"
          style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white", fontSize: 17 }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
        <TouchableOpacity
          onPress={() => setScope("everyone")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "everyone" ? colors.ink : "transparent", borderWidth: scope === "everyone" ? 0 : 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ fontSize: 16, color: scope === "everyone" ? "white" : colors.ink }}>Everyone</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setScope("following")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: scope === "following" ? colors.ink : "transparent", borderWidth: scope === "following" ? 0 : 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ fontSize: 16, color: scope === "following" ? "white" : colors.ink }}>Following</Text>
        </TouchableOpacity>
      </View>

      {scope === "everyone" && <SuggestionsRow currentUserId={user.uid} />}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line + "1A", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <BrandMark size={24} />
        <Text style={{ fontSize: 20, fontWeight: "700" }}>Astryks</Text>
      </View>

      {/* "Home" (the feed) vs "Hall of Fame" (the featured gallery) — a sub-tab within Home
          rather than its own top-level tab, replacing the old separate Prizes tab. Sits above
          both views so it stays visible regardless of which one's showing. */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
        <TouchableOpacity
          onPress={() => setView("feed")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: view === "feed" ? colors.ink : "transparent", borderWidth: view === "feed" ? 0 : 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ fontSize: 16, color: view === "feed" ? "white" : colors.ink }}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setView("hallOfFame")}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: view === "hallOfFame" ? colors.ink : "transparent", borderWidth: view === "hallOfFame" ? 0 : 1, borderColor: colors.line + "1A" }}
        >
          <Text style={{ fontSize: 16, color: view === "hallOfFame" ? "white" : colors.ink }}>🏛️ Hall of Fame</Text>
        </TouchableOpacity>
      </View>

      {view === "hallOfFame" ? (
        <HallOfFameGrid />
      ) : (
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
      )}
    </View>
  );
}
