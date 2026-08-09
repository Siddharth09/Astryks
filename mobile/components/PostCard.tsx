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
import { colors } from "@/lib/styles";

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
  const canDelete = user && (user.uid === post.ownerId || ADMIN_EMAILS.includes(user.email ?? ""));

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
              <Text style={{ color: "white", fontSize: 12 }}>{muted ? "🔇" : "🔊"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {post.type === "photo" && <Image source={{ uri: post.mediaUrl }} style={s.media} />}
        {post.type === "text" && (
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{post.body}</Text>
          </View>
        )}
        {post.type === "link" && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
            {post.linkImage ? (
              <Image source={{ uri: post.linkImage }} style={{ width: 56, height: 56, borderRadius: 10 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 20 }}>🔗</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>{post.linkDomain}</Text>
              <Text style={{ fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{post.linkTitle}</Text>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginLeft: "auto" }}>
            {currentUserId && currentUserId !== post.ownerId && (
              <TouchableOpacity onPress={openConversation}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Message</Text>
              </TouchableOpacity>
            )}
            {currentUserId && currentUserId !== post.ownerId && (
              <TouchableOpacity onPress={() => setReportOpen(true)}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Report</Text>
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity onPress={confirmDelete} disabled={deleting}>
                <Text style={{ fontSize: 11, color: "#B91C1C" }}>{deleting ? "Deleting…" : "Delete"}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {post.title ? <Text style={s.title}>{post.title}</Text> : null}
        <View style={s.row}>
          <LikeButton postId={post.id} initialCount={post.likeCount ?? 0} currentUserId={currentUserId} />
          <TouchableOpacity onPress={() => router.push(`/post/${post.id}`)}>
            <Text style={s.meta}>💬 {post.commentCount ?? 0}</Text>
          </TouchableOpacity>
          <SaveButton postId={post.id} currentUserId={currentUserId} />
          {(post.type === "photo" || post.type === "video") && (
            <TouchableOpacity onPress={() => setPrizeOpen(true)}>
              <Text style={{ fontSize: 15 }}>🏆</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ReportModal visible={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
      <PrizeInfoModal
        visible={prizeOpen}
        onClose={() => setPrizeOpen(false)}
        likeCount={post.likeCount ?? 0}
        eligible={post.prizeEligible}
        optedOut={post.prizeOptOut}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "white", borderRadius: 16, overflow: "hidden", marginBottom: 20, borderWidth: 1, borderColor: colors.line },
  media: { width: "100%", height: 220, backgroundColor: colors.ink },
  body: { padding: 14 },
  meta: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
});
