import { Modal, View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { colors } from "@/lib/styles";

const THRESHOLD = 30;

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizeInfoModal({
  visible,
  onClose,
  likeCount = 0,
  eligible,
  optedOut,
  generic,
}: {
  visible: boolean;
  onClose: () => void;
  likeCount?: number;
  eligible?: boolean;
  optedOut?: boolean;
  // Pass true when there's no post yet (e.g. shown from the composer, before posting) —
  // skips the per-post progress bar/eligible/opted-out states in favour of a plain explainer.
  generic?: boolean;
}) {
  const pct = Math.min(100, Math.round((likeCount / THRESHOLD) * 100));
  const daysLeft = daysLeftInMonth();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: "white", borderRadius: 16, padding: 20 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Creative prize
          </Text>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: 4 }}>AU$1,000 a month</Text>
          {!optedOut && (
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.brand, marginBottom: 10 }}>
              {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month
            </Text>
          )}
          <Text style={{ fontSize: 13, color: colors.ink, opacity: 0.75, lineHeight: 19, marginBottom: 8 }}>
            In a small attempt to incentivise the arts, we give away AU$1,000 in cash every month
            to the community's most-loved creative post.
          </Text>
          <Text style={{ fontSize: 13, color: colors.ink, opacity: 0.75, lineHeight: 19, marginBottom: 8 }}>
            {generic ? "Share a photo or video and you could be in the running. " : "Every month, "}
            we award AU$1,000 (Australian dollars) in cash to whoever's single creative post —
            across music, art, or any other creative project — has the most likes that month. The
            only requirement is that a post needs at least {THRESHOLD} likes to qualify. We ask
            for that because we want our community to lift each other up — liking a post is free
            and takes a second, and it's how we get to cheer on the beautiful things people are
            making here. Just one winner is picked each month; if nothing reaches {THRESHOLD}{" "}
            likes in a given month, no winner is picked that month.
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 15, marginBottom: 16 }}>
            International transfers from Australia may be subject to market foreign exchange rates and
            other overseas transfer considerations. We run this every month to keep encouraging our
            community to create something beautiful and to celebrate each other's work.
          </Text>

          {generic ? null : optedOut ? (
            <View style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: "600" }}>You've opted this post out</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                It won't be entered into this month's draw. Message us if you change your mind.
              </Text>
            </View>
          ) : eligible ? (
            <View style={{ backgroundColor: colors.brandLight, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}>🎉 This post is entered!</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                It's crossed {THRESHOLD} likes, so it's in the running for this month's prize.
              </Text>
            </View>
          ) : (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{likeCount} / {THRESHOLD} likes</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{Math.max(0, THRESHOLD - likeCount)} to go</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.brand, borderRadius: 4 }} />
              </View>
            </View>
          )}

          <TouchableOpacity
            onPress={() => {
              onClose();
              router.push("/(tabs)/prizes");
            }}
            style={{ alignItems: "center", paddingVertical: 8 }}
          >
            <Text style={{ fontSize: 12, color: colors.ink, textDecorationLine: "underline" }}>
              See this month's leaderboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ color: "white", fontWeight: "600" }}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
