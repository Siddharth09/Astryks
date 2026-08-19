import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import { flagEmoji } from "@/lib/geo";

const getPrizeLeaderboardFn = httpsCallable(functions, "getPrizeLeaderboard");
const getLatestPrizeWinnerFn = httpsCallable(functions, "getLatestPrizeWinner");

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizesScreen() {
  const { user, loading: authLoading } = useAuth();
  const [leaderboard, setLeaderboard] = useState<any[] | null>(null);
  const [winner, setWinner] = useState<any | null | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    getPrizeLeaderboardFn().then((res) => setLeaderboard((res.data as any).leaderboard));
    getLatestPrizeWinnerFn().then((res) => setWinner((res.data as any).winner));
  }, [user]);

  if (authLoading || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  const daysLeft = daysLeftInMonth();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        Creative prize
      </Text>
      <Text style={{ fontSize: 29, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>AU$1,000 a month</Text>
      <Text style={{ fontSize: 17, color: colors.ink, opacity: 0.7, marginBottom: 4, lineHeight: 19 }}>
        In a small attempt to incentivise the arts, we give away AU$1,000 in cash every month to
        whoever's post the community loves most. Free to enter for every Astryks member — no
        subscription needed. One winner is picked each
        month, across every subject — music, art, or any other creative project. Whoever's post has
        the most likes at the end of this calendar month wins — the only requirement is reaching at
        least 30 likes, because we want our community cheering each other on. If nothing reaches 30
        likes in a given month, no winner is picked that month. We're running this every month through
        our first 6 months (through February 2027).
      </Text>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.brand, marginBottom: 20 }}>
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month
      </Text>

      {winner && (
        <View style={{ backgroundColor: colors.brandLight, borderRadius: 14, padding: 14, marginBottom: 24 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.brand, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            🏆 {winner.monthLabel} winner
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {winner.mediaUrl && <Image source={{ uri: winner.mediaUrl }} style={{ width: 52, height: 52, borderRadius: 10 }} />}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>
                {winner.ownerName} {flagEmoji(winner.countryCode)}
              </Text>
              <Text style={{ fontSize: 16, color: colors.muted }}>
                {winner.likeCount} likes{winner.title ? ` · "${winner.title}"` : ""}
              </Text>
            </View>
            {winner.postId && (
              <TouchableOpacity onPress={() => router.push(`/post/${winner.postId}`)}>
                <Text style={{ fontSize: 16, color: colors.ink, textDecorationLine: "underline" }}>View</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      {winner === null && (
        <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: colors.line + "1A" }}>
          <Text style={{ fontSize: 17, color: colors.muted }}>
            No winner announced yet — check back after the end of the month.
          </Text>
        </View>
      )}

      <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink, marginBottom: 12 }}>This month's leaderboard</Text>

      {leaderboard === null ? (
        <ActivityIndicator />
      ) : leaderboard.length === 0 ? (
        <Text style={{ fontSize: 17, color: colors.muted }}>No creative posts yet this month — be the first!</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {(() => {
            const maxLikes = Math.max(1, leaderboard[0]?.likeCount ?? 1);
            return leaderboard.map((entry, i) => {
              const pct = Math.min(100, Math.round((entry.likeCount / maxLikes) * 100));
              return (
                <TouchableOpacity
                  key={entry.postId}
                  onPress={() => router.push(`/post/${entry.postId}`)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: "white",
                    borderRadius: 12,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: colors.line + "1A",
                  }}
                >
                  <Text style={{ width: 20, textAlign: "center", fontWeight: "800", color: colors.muted }}>{i + 1}</Text>
                  {entry.mediaUrl && <Image source={{ uri: entry.mediaUrl }} style={{ width: 40, height: 40, borderRadius: 8 }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }} numberOfLines={1}>
                      {entry.ownerName} {flagEmoji(entry.countryCode)}
                    </Text>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden", marginTop: 5 }}>
                      <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.brand, borderRadius: 3 }} />
                    </View>
                  </View>
                  <Text style={{ fontSize: 15, color: colors.muted, flexShrink: 0, textAlign: "right" }}>
                    {entry.likeCount} likes{"\n"}
                    <Text style={{ color: entry.meetsLikeThreshold ? colors.brand : colors.muted }}>
                      {entry.meetsLikeThreshold ? "✓ qualifies" : `${Math.max(0, (entry.likeThreshold ?? 30) - entry.likeCount)} to qualify`}
                    </Text>
                  </Text>
                </TouchableOpacity>
              );
            });
          })()}
        </View>
      )}
    </ScrollView>
  );
}
