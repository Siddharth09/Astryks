import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { doc, collection, query, orderBy, onSnapshot, addDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

const optOutOfPrizeFn = httpsCallable(functions, "optOutOfPrize");
const submitPrizePayoutDetailsFn = httpsCallable(functions, "submitPrizePayoutDetails");

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [optOutState, setOptOutState] = useState<Record<string, "loading" | "done">>({});
  const [payoutOpen, setPayoutOpen] = useState<Record<string, boolean>>({});
  const [payoutMethod, setPayoutMethod] = useState<Record<string, "bank" | "payid">>({});
  const [payoutDetails, setPayoutDetails] = useState<Record<string, string>>({});
  const [payoutState, setPayoutState] = useState<Record<string, "loading" | "done">>({});
  const listRef = useRef<FlatList>(null);

  async function handleOptOut(messageId: string, postId: string) {
    setOptOutState((prev) => ({ ...prev, [messageId]: "loading" }));
    try {
      await optOutOfPrizeFn({ postId });
      setOptOutState((prev) => ({ ...prev, [messageId]: "done" }));
    } catch (err: any) {
      setOptOutState((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      Alert.alert("Couldn't opt out", err.message ?? "Try again.");
    }
  }

  async function handleSubmitPayout(messageId: string, postId: string) {
    const details = (payoutDetails[messageId] ?? "").trim();
    if (!details) return;
    const method = payoutMethod[messageId] ?? "bank";
    setPayoutState((prev) => ({ ...prev, [messageId]: "loading" }));
    try {
      await submitPrizePayoutDetailsFn({ postId, method, details });
      setPayoutState((prev) => ({ ...prev, [messageId]: "done" }));
    } catch (err: any) {
      setPayoutState((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      Alert.alert("Couldn't save payout details", err.message ?? "Try again.");
    }
  }

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
            {item.type === "prizeNomination" && item.senderId !== user?.uid && item.postId && (
              <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 }}>
                {optOutState[item.id] === "done" || item.prizeOptOutHandled ? (
                  <Text style={{ fontSize: 12, color: colors.muted }}>You've opted this post out.</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                    <TouchableOpacity
                      onPress={() => handleOptOut(item.id, item.postId)}
                      disabled={optOutState[item.id] === "loading"}
                    >
                      <Text style={{ fontSize: 12, color: colors.ink, textDecorationLine: "underline", opacity: optOutState[item.id] === "loading" ? 0.5 : 1 }}>
                        {optOutState[item.id] === "loading" ? "Opting out…" : "Opt out of this nomination"}
                      </Text>
                    </TouchableOpacity>
                    {payoutState[item.id] !== "done" && (
                      <TouchableOpacity
                        onPress={() => setPayoutOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                      >
                        <Text style={{ fontSize: 12, color: colors.ink, textDecorationLine: "underline" }}>
                          {payoutOpen[item.id] ? "Cancel" : "Share payout details"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {payoutState[item.id] === "done" && (
                  <Text style={{ fontSize: 12, color: colors.muted }}>Payout details saved — thanks!</Text>
                )}

                {payoutOpen[item.id] && payoutState[item.id] !== "done" && (
                  <View style={{ backgroundColor: colors.paper, borderRadius: 10, padding: 10, gap: 8 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["bank", "payid"] as const).map((m) => (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setPayoutMethod((prev) => ({ ...prev, [item.id]: m }))}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            backgroundColor: (payoutMethod[item.id] ?? "bank") === m ? colors.ink : "white",
                            borderWidth: 1,
                            borderColor: colors.line,
                          }}
                        >
                          <Text style={{ fontSize: 11, color: (payoutMethod[item.id] ?? "bank") === m ? "white" : colors.ink }}>
                            {m === "bank" ? "Bank transfer" : "PayID"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      value={payoutDetails[item.id] ?? ""}
                      onChangeText={(t) => setPayoutDetails((prev) => ({ ...prev, [item.id]: t }))}
                      placeholder={
                        (payoutMethod[item.id] ?? "bank") === "bank"
                          ? "BSB, account number, account name"
                          : "PayID (phone, email, or ABN)"
                      }
                      style={{
                        borderWidth: 1,
                        borderColor: colors.line,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        backgroundColor: "white",
                        fontSize: 12,
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => handleSubmitPayout(item.id, item.postId)}
                      disabled={payoutState[item.id] === "loading" || !(payoutDetails[item.id] ?? "").trim()}
                      style={{
                        backgroundColor: colors.ink,
                        borderRadius: 8,
                        paddingVertical: 8,
                        alignItems: "center",
                        opacity: payoutState[item.id] === "loading" || !(payoutDetails[item.id] ?? "").trim() ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 12, color: "white", fontWeight: "600" }}>
                        {payoutState[item.id] === "loading" ? "Saving…" : "Save payout details"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.paper,
        }}
      >
        <TextInput
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 22,
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: "white",
            fontSize: 15,
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
          <Text style={{ color: "white", fontSize: 16, transform: [{ rotate: "-90deg" }] }}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
