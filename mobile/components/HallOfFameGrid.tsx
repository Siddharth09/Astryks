import { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, FlatList, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { colors } from "@/lib/styles";

const getHallOfFameFn = httpsCallable(functions, "getHallOfFame");

type HallOfFameEntry = {
  id: string;
  ownerId: string;
  ownerName: string;
  type: string;
  mediaUrl: string | null;
  bunnyVideoId: string | null;
  bunnyLibraryId: string | null;
  title: string | null;
  likeCount: number;
  hallOfFameSource: "manual" | "monthly-top";
  hallOfFameMonth: string | null;
};

export default function HallOfFameGrid() {
  const [entries, setEntries] = useState<HallOfFameEntry[] | null>(null);

  useEffect(() => {
    getHallOfFameFn()
      .then((res) => setEntries((res.data as any).entries))
      .catch((err) => {
        console.error("Couldn't load the Hall of Fame", err);
        setEntries([]);
      });
  }, []);

  return (
    <FlatList
      data={entries ?? []}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      columnWrapperStyle={{ gap: 8 }}
      ListHeaderComponent={
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Hall of Fame
          </Text>
          <Text style={{ fontSize: 16, color: colors.muted, lineHeight: 20 }}>
            The community's best work — some posts our team picked to spotlight, plus each
            month's 5 most-liked posts, added automatically.
          </Text>
        </View>
      }
      ListEmptyComponent={
        entries === null ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 20 }} />
        ) : (
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>
            Nothing featured yet — check back soon.
          </Text>
        )
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={() => router.push(`/post/${item.id}`)}
          style={{ flex: 1, aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: colors.ink, marginBottom: 8 }}
        >
          {item.mediaUrl ? (
            <Image source={{ uri: item.mediaUrl }} style={{ width: "100%", height: "100%" }} />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "white", fontSize: 24 }}>{item.type === "video" ? "▶" : "📷"}</Text>
            </View>
          )}
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 8, backgroundColor: "rgba(0,0,0,0.45)" }}>
            <Text style={{ color: "white", fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{item.ownerName}</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>{item.likeCount} likes</Text>
          </View>
          {item.hallOfFameSource === "manual" && (
            <Text style={{ position: "absolute", top: 6, right: 6, fontSize: 14 }}>🏛️</Text>
          )}
        </TouchableOpacity>
      )}
    />
  );
}
