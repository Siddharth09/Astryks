import { useState } from "react";
import { Modal, View, Text, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { colors } from "@/lib/styles";

const optInToPrizeFn = httpsCallable(functions, "optInToPrize");

const THRESHOLD = 30;

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizeInfoModal({
  visible,
  onClose,
  postId,
  likeCount = 0,
  eligible,
  optedOut,
  generic,
  onOptedIn,
}: {
  visible: boolean;
  onClose: () => void;
  // Required to actually call optInToPrize below — only missing when generic is true (shown
  // from the composer before a post exists yet), in which case optedOut is never true anyway.
  postId?: string;
  likeCount?: number;
  eligible?: boolean;
  optedOut?: boolean;
  // Pass true when there's no post yet (e.g. shown from the composer, before posting) —
  // skips the per-post progress bar/eligible/opted-out states in favour of a plain explainer.
  generic?: boolean;
  // Lets the parent (which holds the actual post data) clear its own optedOut flag once this
  // succeeds, since this modal doesn't own that state itself.
  onOptedIn?: () => void;
}) {
  const pct = Math.min(100, Math.round((likeCount / THRESHOLD) * 100));
  const daysLeft = daysLeftInMonth();
  const [optingIn, setOptingIn] = useState(false);

  async function handleOptIn() {
    if (!postId || optingIn) return;
    setOptingIn(true);
    try {
      await optInToPrizeFn({ postId });
      onOptedIn?.();
    } catch (err: any) {
      Alert.alert("Couldn't opt back in", err.message ?? "Please try again.");
    } finally {
      setOptingIn(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: "white", borderRadius: 16, padding: 20 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Creative prize
          </Text>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.ink, marginBottom: 4 }}>AU$1,000 a month</Text>
          {!optedOut && (
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.brand, marginBottom: 10 }}>
              {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month
            </Text>
          )}
          <Text style={{ fontSize: 17, color: colors.ink, opacity: 0.75, lineHeight: 19, marginBottom: 8 }}>
            In a small attempt to incentivise the arts, we give away AU$1,000 in cash every month
            to the community's most-loved creative post.
          </Text>
          <Text style={{ fontSize: 17, color: colors.ink, opacity: 0.75, lineHeight: 19, marginBottom: 8 }}>
            {generic ? "Share a photo or video and you could be in the running. " : "Every month, "}
            we award AU$1,000 (Australian dollars) in cash to whoever's single creative post —
            across music, art, or any other creative project — has the most likes that month. The
            only requirement is that a post needs at least {THRESHOLD} likes to qualify. We ask
            for that because we want our community to lift each other up — liking a post is free
            and takes a second, and it's how we get to cheer on the beautiful things people are
            making here. Just one winner is picked each month; if nothing reaches {THRESHOLD}{" "}
            likes in a given month, no winner is picked that month.
          </Text>
          <Text style={{ fontSize: 15, color: colors.muted, lineHeight: 15, marginBottom: 16 }}>
            International transfers from Australia may be subject to market foreign exchange rates and
            other overseas transfer considerations. We run this every month to keep encouraging our
            community to create something beautiful and to celebrate each other's work.
          </Text>

          {generic ? null : optedOut ? (
            <View style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: "600" }}>You've opted this post out</Text>
              <Text style={{ fontSize: 16, color: colors.muted, marginTop: 4, marginBottom: 10 }}>
                It won't be entered into this month's draw.
              </Text>
              <TouchableOpacity
                onPress={handleOptIn}
                disabled={optingIn}
                style={{ alignSelf: "flex-start", backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, opacity: optingIn ? 0.6 : 1 }}
              >
                <Text style={{ color: "white", fontSize: 15, fontWeight: "600" }}>
                  {optingIn ? "Opting back in…" : "Opt back in"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : eligible ? (
            <View style={{ backgroundColor: colors.brandLight, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: colors.brand }}>🎉 This post is entered!</Text>
              <Text style={{ fontSize: 16, color: colors.muted, marginTop: 4 }}>
                It's crossed {THRESHOLD} likes, so it's in the running for this month's prize.
              </Text>
            </View>
          ) : (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ fontSize: 16, color: colors.muted }}>{likeCount} / {THRESHOLD} likes</Text>
                <Text style={{ fontSize: 16, color: colors.muted }}>{Math.max(0, THRESHOLD - likeCount)} to go</Text>
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
            <Text style={{ fontSize: 16, color: colors.ink, textDecorationLine: "underline" }}>
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
