import { useState, useRef } from "react";
import { View, Dimensions } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";

const VIDEO_ASPECT_RATIO = 1360 / 738;
const screenWidth = Dimensions.get("window").width;
const splashWidth = Math.min(320, screenWidth * 0.8);

export default function SplashVideo({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<Video>(null);
  const [finished, setFinished] = useState(false);

  function handleStatus(status: AVPlaybackStatus) {
    if (status.isLoaded && status.didJustFinish && !finished) {
      setFinished(true);
      onDone();
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
      <Video
        ref={videoRef}
        source={require("../assets/logo-spin.mp4")}
        style={{ width: splashWidth, aspectRatio: VIDEO_ASPECT_RATIO }}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isMuted
        onPlaybackStatusUpdate={handleStatus}
      />
    </View>
  );
}
