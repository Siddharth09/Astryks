import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

export default function MessagesScreen() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setConversations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", paddingHorizontal: 16, marginBottom: 14 }}>Messages</Text>
      <FlatList
        data={conversations ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
            No conversations yet. Tap Message on a post to start one.
          </Text>
        }
        renderItem={({ item }) => {
          const otherName =
            item.participantNames?.find((n: string, i: number) => item.participants[i] !== user.uid) ?? "Member";
          return (
            <TouchableOpacity
              onPress={() => router.push(`/messages/${item.id}`)}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 8 }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "white", fontWeight: "600" }}>{otherName[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", fontSize: 14 }}>{otherName}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{item.lastMessage}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
