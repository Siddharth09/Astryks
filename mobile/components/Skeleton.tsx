import { useEffect, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import { colors } from "@/lib/styles";

// Mirrors astryks-app/components/Skeleton.tsx (the web app's loading placeholder) — this file
// didn't exist anywhere in the delivered mobile app even though app/(tabs)/home.tsx imports
// `FeedSkeleton` from it, which would fail to resolve at bundle time.
function Pulse({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ backgroundColor: colors.line, opacity }, style]} />;
}

// Mimics the shape of a post card while a page's feed data is still loading.
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.line + "1A", backgroundColor: "white", overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
            <Pulse style={{ width: 36, height: 36, borderRadius: 18 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Pulse style={{ height: 11, width: 112, borderRadius: 5 }} />
              <Pulse style={{ height: 9, width: 64, borderRadius: 5 }} />
            </View>
          </View>
          <Pulse style={{ width: "100%", aspectRatio: 4 / 3 }} />
        </View>
      ))}
    </View>
  );
}
