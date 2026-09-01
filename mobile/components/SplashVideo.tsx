import { useEffect, useRef } from "react";
import { View, Dimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

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

  // expo-av's <Video> doesn't reliably autoplay under the New Architecture (app.json has
  // newArchEnabled: true) — a frozen first frame here would mean every launch shows a blank
  // black screen for the full 4-second timeout below instead of the intended animation.
  // expo-video's player is the actively maintained replacement.
  const player = useVideoPlayer(require("../assets/logo-spin.mp4"), (p) => {
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    // Safety net: if the video can't load/play for any reason, never let it block the app —
    // force the splash away after a few seconds no matter what (mirrors the web splash).
    const timer = setTimeout(finish, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const endSub = player.addListener("playToEnd", finish);
    const statusSub = player.addListener("statusChange", ({ status }) => {
      if (status === "error") finish();
    });
    return () => {
      endSub.remove();
      statusSub.remove();
    };
  }, [player]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
      <VideoView
        player={player}
        style={{ width: splashWidth, height: splashHeight }}
        contentFit="contain"
        nativeControls={false}
      />
    </View>
  );
}
