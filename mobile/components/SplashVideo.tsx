import { useEffect, useRef } from "react";
import { View, Dimensions, Animated, Easing } from "react-native";

const screenWidth = Dimensions.get("window").width;
const splashWidth = Math.min(220, screenWidth * 0.55);

// This used to play a bundled `assets/logo-spin.mp4` intro clip — that file was never actually
// delivered into assets/ (only icon.png/adaptive-icon.png/splash-icon.png/logo-mark.png exist
// there), so the `require("../assets/logo-spin.mp4")` this replaced would fail at bundle time,
// before the app could even open once. This spins the existing logo mark instead of the missing
// video: same "brief animated intro" effect, but with an asset that's actually in the repo.
export default function SplashVideo({ onDone }: { onDone: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(spin, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(onDone, 1300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
      <Animated.Image
        source={require("../assets/logo-mark.png")}
        style={{ width: splashWidth, height: splashWidth, transform: [{ rotate }] }}
        resizeMode="contain"
      />
    </View>
  );
}
