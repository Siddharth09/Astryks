import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { doc, collection, query, orderBy, onSnapshot, addDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    const q = query(collection(db, "conversations", conversationId, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [conversationId]);

  async function handleSend() {
    if (!body.trim() || !user) return;
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
        <Text style={{ fontSize: 20 }}>←</Text>
        <Text style={{ fontSize: 15, color: colors.ink }}>Back</Text>
      </TouchableOpacity>
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
            <Text style={{ color: item.senderId === user?.uid ? "white" : colors.ink, fontSize: 14 }}>{item.text}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
        <TextInput
          style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 16, backgroundColor: "white" }}
          placeholder="Message…"
          value={body}
          onChangeText={setBody}
        />
        <TouchableOpacity onPress={handleSend} style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 18, justifyContent: "center" }}>
          <Text style={{ color: "white", fontWeight: "600" }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
