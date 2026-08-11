import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { WebView } from "react-native-webview";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colors } from "@/lib/styles";

type Trailer = {
  id: string;
  title: string;
  subjectTag: "music" | "art" | "finance";
  bunnyVideoId: string;
  bunnyLibraryId: string;
};

const SUBJECT_STYLE: Record<string, { border: string; tagBg: string; tagText: string; label: string }> = {
  music: { border: colors.music, tagBg: colors.musicLight, tagText: colors.music, label: "Music" },
  art: { border: colors.art, tagBg: colors.artLight, tagText: colors.art, label: "Art" },
  finance: { border: colors.finance, tagBg: colors.financeLight, tagText: colors.finance, label: "Finance" },
};

export default function TrailersSection({ compact = false }: { compact?: boolean }) {
  const [trailers, setTrailers] = useState<Trailer[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "trailers"), orderBy("createdAt", "desc")));
      setTrailers(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Trailer[]);
    })();
  }, []);

  if (trailers === null || trailers.length === 0) return null;

  return (
    <View style={{ marginHorizontal: compact ? 0 : 16, marginTop: compact ? 10 : 0, marginBottom: compact ? 0 : 16 }}>
      {!compact && <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8 }}>Watch a trailer</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {trailers.map((t) => {
          const style = SUBJECT_STYLE[t.subjectTag] ?? SUBJECT_STYLE.music;
          const isPlaying = playingId === t.id;
          return (
            <View
              key={t.id}
              style={{
                width: 168,
                marginRight: 10,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: "white",
                borderTopWidth: 4,
                borderTopColor: style.border,
              }}
            >
              {isPlaying ? (
                <WebView
                  source={{ uri: `https://iframe.mediadelivery.net/embed/${t.bunnyLibraryId}/${t.bunnyVideoId}?autoplay=true` }}
                  style={{ width: "100%", height: 94, backgroundColor: colors.ink }}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                />
              ) : (
                <TouchableOpacity
                  onPress={() => setPlayingId(t.id)}
                  style={{ width: "100%", height: 94, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: colors.ink }}>▶</Text>
                  </View>
                </TouchableOpacity>
              )}
              <View style={{ padding: 10 }}>
                <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: style.tagBg, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: style.tagText }}>{style.label}</Text>
                </View>
                <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                  {t.title}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
