import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors } from "@/lib/styles";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

// Shared numeric keypad + dot indicator for entering a fixed-length code — used for the 4-digit
// Privacy Lock PIN (unlocking, setup, disable) and the 6-digit "forgot PIN" email reset code.
// `error` resets the dots and clears input on the next render; `resetKey` lets a caller force a
// fresh entry (e.g. moving from "enter PIN" to "confirm PIN") without remounting the component.
export default function PinPad({
  length = 4,
  error,
  resetKey,
  onComplete,
}: {
  length?: number;
  error?: boolean;
  resetKey?: number;
  onComplete: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    setPin("");
  }, [resetKey]);

  function press(key: string) {
    if (key === "⌫") {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (!key || pin.length >= length) return;
    const next = pin + key;
    setPin(next);
    if (next.length === length) {
      onComplete(next);
      setPin("");
    }
  }

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, marginBottom: 18, maxWidth: 220 }}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 1.5,
              borderColor: error ? "#B3261E" : colors.ink,
              backgroundColor: i < pin.length ? (error ? "#B3261E" : colors.ink) : "transparent",
            }}
          />
        ))}
      </View>
      <View style={{ width: 260, flexDirection: "row", flexWrap: "wrap" }}>
        {KEYS.map((key, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => press(key)}
            disabled={!key}
            style={{ width: "33.33%", alignItems: "center", justifyContent: "center", paddingVertical: 16 }}
          >
            <Text style={{ fontSize: 24, color: key ? colors.ink : "transparent" }}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
