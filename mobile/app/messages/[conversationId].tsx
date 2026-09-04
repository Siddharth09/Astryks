import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { doc, getDoc, collection, query, orderBy, onSnapshot, addDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PrivacyLockScreen from "@/components/PrivacyLockScreen";
import { colors } from "@/lib/styles";
import { BOT_UIDS } from "@/lib/botUsers";
import BrandMark from "@/components/BrandMark";

const getPublicProfile = httpsCallable(functions, "getPublicProfile");

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { user } = useAuth();
  const { locked: privacyLocked } = usePrivacyLock();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  // Blocking only ever stopped a NEW conversation from being started (see user/[userId].tsx and
  // the Messages tab's search) — this screen itself never checked block status at all, so an
  // existing conversation between two people stayed fully usable in both directions even after
  // one of them blocked the other. Fetch the other participant's block status the same way the
  // profile screen does, and use it to shut down sending here too.
  const [isBlocked, setIsBlocked] = useState(false);
  const [otherName, setOtherName] = useState<string | null>(null);
  const [otherIsBot, setOtherIsBot] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!user || !conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const convoSnap = await getDoc(doc(db, "conversations", conversationId));
        const data = convoSnap.data();
        const participants: string[] = data?.participants ?? [];
        const otherIndex = participants.findIndex((id) => id !== user.uid);
        const otherId = participants[otherIndex];
        if (!otherId) return;
        if (!cancelled) {
          setOtherName(data?.participantNames?.[otherIndex] ?? "Member");
          setOtherIsBot(BOT_UIDS.includes(otherId));
        }
        if (BOT_UIDS.includes(otherId)) return; // not a real profile — nothing to block-check
        const result = await getPublicProfile({ uid: otherId });
        const profile = result.data as { blockedByMe?: boolean; blockedMe?: boolean };
        if (!cancelled) setIsBlocked(!!(profile?.blockedByMe || profile?.blockedMe));
      } catch {
        // Best-effort — if this fails we fall back to allowing sending, same as before this check
        // existed, rather than locking someone out of a conversation over a network hiccup.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, conversationId]);

  useEffect(() => {
    const q = query(collection(db, "conversations", conversationId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [conversationId]);

  async function handleSend() {
    if (!body.trim() || !user || isBlocked) return;
    await addDoc(collection(db, "conversations", conversationId, "messages"), {
      senderId: user.uid,
      senderName: user.displayName ?? "Member",
      text: body,
      createdAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, "conversations", conversationId),
      { lastMessage: body, lastMessageAt: serverTimestamp() },
      { merge: true }
    );
    setBody("");
  }

  if (privacyLocked) {
    return <PrivacyLockScreen label="Messages" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <TouchableOpacity
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/messages"))}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, marginBottom: 8 }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={{ fontSize: 22 }}>←</Text>
        <Text style={{ fontSize: 19, color: colors.ink }}>Back</Text>
      </TouchableOpacity>
      {otherName && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, marginBottom: 8 }}>
          {otherIsBot ? (
            <BrandMark size={36} />
          ) : (
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>{otherName[0]}</Text>
            </View>
          )}
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>{otherName}</Text>
        </View>
      )}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View
            style={{
              maxWidth: "75%",
              alignSelf: item.senderId === user?.uid ? "flex-end" : "flex-start",
              backgroundColor: item.senderId === user?.uid ? colors.ink : "white",
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: item.senderId === user?.uid ? "white" : colors.ink, fontSize: 18 }}>{item.text}</Text>
            {/* Old prizeNomination messages (Creative Prize, retired) used to render interactive
                opt-out/payout forms right here. The prize is gone and the backend callables
                behind those forms are no longer deployed (see the RETIRED banner in functions/
                index.js), so any such message left in someone's history now just renders as a
                plain, non-interactive past message like any other. */}
          </View>
        )}
      />
      {isBlocked ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderTopColor: colors.line + "1A",
            backgroundColor: colors.paper,
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 16, textAlign: "center" }}>
            You can't send messages in this conversation.
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: colors.line + "1A",
            backgroundColor: colors.paper,
          }}
        >
          <TextInput
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.line + "1A",
              borderRadius: 22,
              paddingHorizontal: 16,
              paddingVertical: 10,
              backgroundColor: "white",
              fontSize: 19,
              minHeight: 44,
              maxHeight: 120,
            }}
            placeholder="Message…"
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!body.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brand,
              opacity: body.trim() ? 1 : 0.4,
            }}
          >
            <Text style={{ color: "white", fontSize: 18, transform: [{ rotate: "-90deg" }] }}>▶</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
