import { useEffect, useRef } from "react";
import { View, Dimensions } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";

const screenWidth = Dimensions.get("window").width;
const splashWidth = Math.min(420, screenWidth * 0.85);
// Matches the source video's actual frame — see astryks-app's SplashIntro.tsx, which plays the
// same asset (identical file, just copied into this project's assets/) at this same ratio.
const splashHeight = splashWidth * (738 / 1360);

// Plays the real animated logo intro — same asset and aspect ratio as the web app's splash, so
// the two platforms show the same animation instead of mobile falling back to something cruder.
export default function SplashVideo({ onDone }: { onDone: () => void }) {
  const finishedRef = useRef(false);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDone();
  }

  useEffect(() => {
    // Safety net: if the video can't load/play for any reason, never let it block the app —
    // force the splash away after a few seconds no matter what (mirrors the web splash).
    const timer = setTimeout(finish, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleStatusUpdate(status: AVPlaybackStatus) {
    if (status.isLoaded && status.didJustFinish) finish();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
      <Video
        source={require("../assets/logo-spin.mp4")}
        style={{ width: splashWidth, height: splashHeight }}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isMuted
        onPlaybackStatusUpdate={handleStatusUpdate}
        onError={finish}
      />
    </View>
  );
}
