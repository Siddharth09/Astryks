import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import FollowButton from "@/components/FollowButton";
import ReportModal from "@/components/ReportModal";
import { colors } from "@/lib/styles";

const getUserPosts = httpsCallable(functions, "getUserPosts");
const submitReportFn = httpsCallable(functions, "submitReport");

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  async function handleReportUser(reason: string, details: string) {
    await submitReportFn({ targetType: "user", targetId: userId, reason, details });
  }

  useEffect(() => {
    if (!currentUser || !userId) return;
    if (userId === currentUser.uid) {
      router.replace("/(tabs)/me");
      return;
    }
    (async () => {
      const snap = await getDoc(doc(db, "users", userId));
      if (!snap.exists()) {
        setMissing(true);
        setLoading(false);
        return;
      }
      setProfile(snap.data());

      // Fetched via a Cloud Function rather than a direct Firestore query: Firestore security
      // rules can't filter a list query, so hiding this person's private posts from anyone but
      // themselves (or an admin) has to happen server-side with the Admin SDK.
      const [result, followersSnap, followingSnap] = await Promise.all([
        getUserPosts({ userId }),
        getDocs(query(collection(db, "follows"), where("followingId", "==", userId))),
        getDocs(query(collection(db, "follows"), where("followerId", "==", userId))),
      ]);
      setPosts((result.data as any).posts);
      setFollowerCount(followersSnap.size);
      setFollowingCount(followingSnap.size);
      setLoading(false);
    })();
  }, [currentUser, userId]);

  async function openConversation() {
    if (!currentUser || messaging) return;
    setMessaging(true);
    try {
      const conversationId = [currentUser.uid, userId].sort().join("_");
      const ref = doc(db, "conversations", conversationId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          participants: [currentUser.uid, userId].sort(),
          participantNames: [currentUser.uid, userId]
            .sort()
            .map((id) => (id === userId ? profile?.displayName ?? "Member" : "You")),
          lastMessage: "",
          lastMessageAt: new Date(),
        });
      }
      router.push(`/messages/${conversationId}`);
    } finally {
      setMessaging(false);
    }
  }

  const BackBar = (
    <TouchableOpacity
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6 }}
    >
      <Text style={{ fontSize: 20 }}>←</Text>
      <Text style={{ fontSize: 15, color: colors.ink }}>Back</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56, paddingHorizontal: 16 }}>
        {BackBar}
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </View>
    );
  }

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56, paddingHorizontal: 16 }}>
        {BackBar}
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
          This person's profile couldn't be found.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
      {BackBar}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 }}>
        {profile.photoURL ? (
          <Image source={{ uri: profile.photoURL }} style={{ width: 80, height: 80, borderRadius: 40 }} />
        ) : (
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "white", fontSize: 26, fontWeight: "600" }}>{(profile.displayName ?? "M")[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-around" }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{posts.length}</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>Posts</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{followerCount}</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>Followers</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{followingCount}</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>Following</Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Text style={{ fontSize: 17, fontWeight: "700" }}>{profile.displayName ?? "Member"}</Text>
        <TouchableOpacity onPress={() => setReportOpen(true)}>
          <Text style={{ fontSize: 12, color: colors.muted }}>Report</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
        <FollowButton
          targetUserId={userId}
          currentUserId={currentUser?.uid ?? null}
          style={{ flex: 1, paddingVertical: 9, alignItems: "center" }}
          textStyle={{ fontSize: 13, fontWeight: "600" }}
        />
        <TouchableOpacity
          onPress={openConversation}
          disabled={messaging}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 9, alignItems: "center" }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600" }}>{messaging ? "Opening…" : "Message"}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 18 }}>
        {posts.length === 0 ? (
          <View style={{ alignItems: "center", gap: 10, paddingVertical: 40 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: "rgba(0,0,0,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 26, opacity: 0.4 }}>📷</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600" }}>No shared posts</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {posts.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => router.push(`/post/${p.id}`)}
                style={{ width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
              >
                {p.type === "photo" ? (
                  <Image source={{ uri: p.mediaUrl }} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <Text style={{ color: "white" }}>▶</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <ReportModal visible={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReportUser} />
    </ScrollView>
  );
}
