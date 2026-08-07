import { useEffect, useRef } from "react";
import { Animated, View, ViewStyle } from "react-native";
import { colors } from "@/lib/styles";

function Pulse({ style }: { style: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ backgroundColor: colors.line, borderRadius: 8 }, style, { opacity }]} />;
}

// Mimics the shape of a PostCard while the feed is still loading.
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ borderRadius: 16, backgroundColor: "white", borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
            <Pulse style={{ width: 36, height: 36, borderRadius: 18 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Pulse style={{ width: "50%", height: 10 }} />
              <Pulse style={{ width: "30%", height: 8 }} />
            </View>
          </View>
          <Pulse style={{ width: "100%", height: 180, borderRadius: 0 }} />
        </View>
      ))}
    </View>
  );
}
