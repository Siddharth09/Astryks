import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from "react-native";
import { Video, ResizeMode } from "expo-av";
import { WebView } from "react-native-webview";
import { router } from "expo-router";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import LikeButton from "@/components/LikeButton";
import SaveButton from "@/components/SaveButton";
import FollowButton from "@/components/FollowButton";
import ReportModal from "@/components/ReportModal";
import PrizeInfoModal from "@/components/PrizeInfoModal";
import ShareMenu from "@/components/ShareMenu";
import { colors } from "@/lib/styles";
import { useResizedImageUrl } from "@/lib/resizedImage";

const deletePostFn = httpsCallable(functions, "deletePost");
const submitReportFn = httpsCallable(functions, "submitReport");
const ADMIN_EMAILS = ["mehta.siddharth09@gmail.com"];

export default function PostCard({
  post,
  currentUserId,
  isActive = true,
  onDeleted,
}: {
  post: any;
  currentUserId: string | null;
  isActive?: boolean;
  onDeleted?: (postId: string) => void;
}) {
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [prizeOpen, setPrizeOpen] = useState(false);
  // Optimistic local override so opting back in updates the trophy/modal immediately — `post`
  // is a prop from the parent's feed data, which won't itself refresh until the next reload.
  const [optedInOverride, setOptedInOverride] = useState(false);
  const prizeOptOut = post.prizeOptOut && !optedInOverride;
  const canDelete = user && (user.uid === post.ownerId || ADMIN_EMAILS.includes(user.email ?? ""));
  const displayMediaUrl = useResizedImageUrl(post.type === "photo" ? post.mediaPath : null, post.mediaUrl);

  async function handleReport(reason: string, details: string) {
    await submitReportFn({ targetType: "post", targetId: post.id, reason, details });
  }

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
            onDeleted?.(post.id);
          } catch (err: any) {
            Alert.alert("Couldn't delete", err.message ?? "Something went wrong.");
            setDeleting(false);
          }
        },
      },
    ]);
  }

  const createdDate = post.createdAt?.toDate
    ? post.createdAt.toDate()
    : typeof post.createdAt === "number"
    ? new Date(post.createdAt)
    : new Date();
  const videoRef = useRef<Video>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      videoRef.current.playAsync().catch(() => {});
    } else {
      videoRef.current.pauseAsync().catch(() => {});
    }
  }, [isActive]);

  async function openConversation() {
    if (!currentUserId || currentUserId === post.ownerId) return;
    const conversationId = [currentUserId, post.ownerId].sort().join("_");
    const ref = doc(db, "conversations", conversationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [currentUserId, post.ownerId].sort(),
        participantNames: [currentUserId, post.ownerId]
          .sort()
          .map((id) => (id === post.ownerId ? post.ownerName : "You")),
        lastMessage: "",
        lastMessageAt: new Date(),
      });
    }
    router.push(`/messages/${conversationId}`);
  }

  return (
    // Shadow lives on this outer wrapper rather than on `s.card` itself — RN clips shadows away
    // entirely on iOS when `overflow: "hidden"` (needed below to round off the media/photo
    // corners) is set on the same view that also draws the shadow.
    <View style={s.cardShadow}>
    <View style={s.card}>
      <TouchableOpacity onPress={() => router.push(`/post/${post.id}`)} activeOpacity={0.9}>
        {post.type === "video" && post.bunnyVideoId && (
          <WebView
            source={{ uri: `https://iframe.mediadelivery.net/embed/${post.bunnyLibraryId}/${post.bunnyVideoId}` }}
            style={s.media}
          />
        )}
        {post.type === "video" && !post.bunnyVideoId && (
          <View>
            <Video
              ref={videoRef}
              source={{ uri: post.mediaUrl }}
              style={s.media}
              resizeMode={ResizeMode.COVER}
              isLooping
              isMuted={muted}
              shouldPlay={isActive}
            />
            <TouchableOpacity
              onPress={() => setMuted((m) => !m)}
              style={{ position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "white", fontSize: 16 }}>{muted ? "🔇" : "🔊"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {post.type === "photo" && <Image source={{ uri: displayMediaUrl }} style={s.media} />}
        {post.type === "text" && (
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink }}>{post.body}</Text>
          </View>
        )}
        {post.type === "link" && (
          // Compact card, not a full-size banner — photos/videos are the "large" content in the
          // feed (Instagram-style), and a shared link is a small aside next to that, not a
          // same-size peer. Fixed small thumbnail + title/domain in a row.
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
            {post.linkImage ? (
              <Image source={{ uri: post.linkImage }} style={s.linkThumb} />
            ) : (
              <View style={[s.linkThumb, { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandLight }]}>
                <Text style={{ fontSize: 24 }}>🔗</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: colors.muted }}>{post.linkDomain}</Text>
              <Text style={{ fontSize: 17, fontWeight: "600" }} numberOfLines={1}>{post.linkTitle}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
      <View style={s.body}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Text style={s.meta}>
            <Text onPress={() => router.push(`/user/${post.ownerId}`)} style={{ textDecorationLine: "underline" }}>
              {post.ownerName ?? "Member"}
            </Text>
            {" · "}
            {createdDate.toLocaleDateString()}
          </Text>
          <FollowButton targetUserId={post.ownerId} currentUserId={currentUserId} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginLeft: "auto" }}>
            {currentUserId && currentUserId !== post.ownerId && (
              <TouchableOpacity onPress={openConversation} accessibilityLabel="Message" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 18 }}>✉️</Text>
              </TouchableOpacity>
            )}
            {currentUserId && currentUserId !== post.ownerId && (
              <TouchableOpacity onPress={() => setReportOpen(true)} accessibilityLabel="Report" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 18 }}>🚩</Text>
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity onPress={confirmDelete} disabled={deleting} accessibilityLabel="Delete" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 18, opacity: deleting ? 0.5 : 1 }}>🗑️</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {post.title ? <Text style={s.title}>{post.title}</Text> : null}
        <View style={s.row}>
          <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={currentUserId} postOwnerId={post.ownerId} />
          <TouchableOpacity onPress={() => router.push(`/post/${post.id}`)}>
            <Text style={s.meta}>💬 {post.commentCount ?? 0}</Text>
          </TouchableOpacity>
          <SaveButton postId={post.id} currentUserId={currentUserId} />
          {/* `prizeEligible` is set true on nearly every photo/video post the moment it's created
              (see nominateForPrize in functions/index.js) — it means "entered", not "in the
              running to actually win." Showing the trophy on every single post made it
              meaningless noise; only show it once a post has actually crossed the 30-like
              qualifying bar (PRIZE_LIKE_THRESHOLD server-side) and hasn't been opted out — EXCEPT
              for the post's own owner, who can still tap in on an opted-out post to opt back in
              (otherwise opting out became a one-way door with no UI left to undo it from here). */}
          {(post.type === "photo" || post.type === "video") &&
            ((post.prizeEligible && !prizeOptOut && (post.likeCount ?? 0) >= 30) ||
              (prizeOptOut && currentUserId === post.ownerId)) && (
              <TouchableOpacity onPress={() => setPrizeOpen(true)}>
                <Text style={{ fontSize: 19 }}>🏆</Text>
              </TouchableOpacity>
            )}
          <ShareMenu postId={post.id} title={post.title} />
        </View>
      </View>
      <ReportModal visible={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
      <PrizeInfoModal
        visible={prizeOpen}
        onClose={() => setPrizeOpen(false)}
        postId={post.id}
        likeCount={post.likeCount ?? 0}
        eligible={post.prizeEligible}
        optedOut={prizeOptOut}
        onOptedIn={() => setOptedInOverride(true)}
      />
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  cardShadow: {
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: "white",
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  card: { backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.line + "1A" },
  media: { width: "100%", height: 220, backgroundColor: colors.ink },
  linkThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.ink },
  body: { padding: 14 },
  meta: { color: colors.muted, fontSize: 16, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
});
