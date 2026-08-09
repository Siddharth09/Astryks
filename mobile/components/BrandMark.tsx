import { Image } from "react-native";

// The actual Astryks logo mark (white burst on black) — shown next to the
// "Astryks" wordmark in the Home header.
export default function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <Image
      source={require("../assets/logo-mark.png")}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
    />
  );
}
