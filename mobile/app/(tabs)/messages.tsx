import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, TextInput, Image, ScrollView } from "react-native";
import { router } from "expo-router";
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

const getMessageSuggestions = httpsCallable(functions, "getMessageSuggestions");
const listPublicProfiles = httpsCallable(functions, "listPublicProfiles");
const SUBJECT_NAMES: Record<string, string> = { music: "Music", art: "Art", finance: "Finance" };
const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

export default function MessagesScreen() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[] | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [allUsers, setAllUsers] = useState<any[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);

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

  useEffect(() => {
    if (!user) return;
    getMessageSuggestions()
      .then((result) => setSuggestions((result.data as any).suggestions))
      .catch(() => setSuggestions([]));
  }, [user]);

  async function openSearch() {
    setShowSearch(true);
    if (allUsers === null && user) {
      // Was a direct `collection("users").limit(200)` query — before firestore.rules
      // restricted users/{uid} reads to each doc's own owner, that handed back everyone's
      // full profile document (stripeCustomerId/payoutOwed included) to search through. This
      // Cloud Function returns only displayName/photoURL for each person.
      const result = await listPublicProfiles({ limit: 200 });
      const profiles = (result.data as any).profiles as { uid: string; displayName: string | null; photoURL: string | null }[];
      setAllUsers(
        profiles.map((p) => ({ id: p.uid, displayName: p.displayName, photoURL: p.photoURL })).filter((u) => u.id !== user.uid)
      );
    }
  }

  async function startConversation(otherId: string, otherName: string) {
    if (!user || starting) return;
    setStarting(otherId);
    try {
      const conversationId = [user.uid, otherId].sort().join("_");
      const ref = doc(db, "conversations", conversationId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          participants: [user.uid, otherId].sort(),
          participantNames: [user.uid, otherId].sort().map((id) => (id === otherId ? otherName : user.displayName ?? "You")),
          lastMessage: "",
          lastMessageAt: new Date(),
        });
      }
      setShowSearch(false);
      router.push(`/messages/${conversationId}`);
    } finally {
      setStarting(null);
    }
  }

  if (!user) return null;

  const q = searchQuery.trim().toLowerCase();
  const matches = !q ? allUsers ?? [] : (allUsers ?? []).filter((u) => u.displayName?.toLowerCase().includes(q));

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 14 }}>
        <Text style={{ fontSize: 20, fontWeight: "700" }}>Messages</Text>
        {showSearch ? (
          <TouchableOpacity onPress={() => setShowSearch(false)}>
            <Text style={{ color: colors.muted, fontSize: 15 }}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={openSearch}
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ fontSize: 14 }}>+ New message</Text>
          </TouchableOpacity>
        )}
      </View>

      {showSearch ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <TextInput
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search people by name…"
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 12 }}
          />
          <FlatList
            data={matches.slice(0, 30)}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              allUsers === null ? (
                <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>Loading people…</Text>
              ) : (
                <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>No one matches "{searchQuery}".</Text>
              )
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => startConversation(item.id, item.displayName ?? "Member")}
                disabled={starting === item.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.line }}
              >
                {item.photoURL ? (
                  <Image source={{ uri: item.photoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                ) : (
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "white", fontWeight: "600" }}>{(item.displayName ?? "M")[0]}</Text>
                  </View>
                )}
                <Text style={{ fontWeight: "600", fontSize: 16 }}>{item.displayName ?? "Member"}</Text>
                {starting === item.id && <Text style={{ marginLeft: "auto", color: colors.muted, fontSize: 14 }}>Opening…</Text>}
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        <FlatList
          data={conversations ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          ListHeaderComponent={
            suggestions !== null && suggestions.length > 0 ? (
              <View style={{ marginBottom: 18 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8 }}>✨ People you may want to message</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {suggestions.map((s) => {
                    const topSubject = s.sharedSubjects?.[0];
                    return (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => startConversation(s.id, s.displayName ?? "Member")}
                        disabled={starting === s.id}
                        style={{ width: 116, marginRight: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", padding: 10, alignItems: "center", gap: 6 }}
                      >
                        {s.photoURL ? (
                          <Image source={{ uri: s.photoURL }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                        ) : (
                          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "white", fontWeight: "600" }}>{(s.displayName ?? "M")[0]}</Text>
                          </View>
                        )}
                        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600" }}>{s.displayName ?? "Member"}</Text>
                        <Text numberOfLines={2} style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>
                          {topSubject
                            ? `${SUBJECT_ICONS[topSubject] ?? "⭐"} Also learning ${SUBJECT_NAMES[topSubject] ?? topSubject}`
                            : "Suggested for you"}
                        </Text>
                        {starting === s.id && <Text style={{ fontSize: 12, color: colors.muted }}>Opening…</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
              No conversations yet. Tap "+ New message" to start one.
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
                  <Text style={{ fontWeight: "600", fontSize: 16 }}>{otherName}</Text>
                  <Text style={{ color: colors.muted, fontSize: 14 }} numberOfLines={1}>{item.lastMessage}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
