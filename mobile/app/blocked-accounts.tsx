import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Image, FlatList, ActivityIndicator, Alert } from "react-native";
import { router } from "expo-router";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { colors } from "@/lib/styles";

const getBlockedUsers = httpsCallable(functions, "getBlockedUsers");
const unblockUserFn = httpsCallable(functions, "unblockUser");

type BlockedUser = { uid: string; displayName: string | null; photoURL: string | null };

export default function BlockedAccountsScreen() {
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBlockedUsers()
      .then((result) => {
        if (!cancelled) setUsers((result.data as any).users);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnblock(uid: string) {
    setUnblockingId(uid);
    try {
      await unblockUserFn({ targetUid: uid });
      setUsers((prev) => (prev ?? []).filter((u) => u.uid !== uid));
    } catch (err: any) {
      Alert.alert("Couldn't unblock", err.message ?? "Something went wrong.");
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 6, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))}
          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Text style={{ fontSize: 22 }}>←</Text>
          <Text style={{ fontSize: 19, color: colors.ink }}>Back</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ fontSize: 22, fontWeight: "700", paddingHorizontal: 16, marginBottom: 14 }}>Blocked accounts</Text>

      {users === null ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          ListEmptyComponent={
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
              You haven't blocked anyone.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 8 }}>
              {item.photoURL ? (
                <Image source={{ uri: item.photoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} />
              ) : (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white", fontWeight: "600" }}>{(item.displayName ?? "M")[0]}</Text>
                </View>
              )}
              <Text style={{ flex: 1, fontWeight: "600", fontSize: 18 }}>{item.displayName ?? "Member"}</Text>
              <TouchableOpacity
                onPress={() => handleUnblock(item.uid)}
                disabled={unblockingId === item.uid}
                style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 16, fontWeight: "600" }}>{unblockingId === item.uid ? "…" : "Unblock"}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}
