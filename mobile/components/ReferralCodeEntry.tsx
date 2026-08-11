import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { colors } from "@/lib/styles";

const validateReferralCode = httpsCallable(functions, "validateReferralCode");

export default function ReferralCodeEntry() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "valid" | "invalid">("idle");

  async function apply() {
    if (!input.trim()) return;
    const result = await validateReferralCode({ code: input });
    const { valid } = result.data as { valid: boolean };
    if (valid) {
      await AsyncStorage.setItem("astryks_referral_code", input.toUpperCase().trim());
      setStatus("valid");
    } else {
      setStatus("invalid");
    }
  }

  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "underline" }}>Have a referral code?</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "white", fontSize: 13 }}
          placeholder="Enter code"
          autoCapitalize="characters"
          value={input}
          onChangeText={(t) => {
            setInput(t.toUpperCase());
            setStatus("idle");
          }}
        />
        <TouchableOpacity onPress={apply} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, justifyContent: "center" }}>
          <Text style={{ fontSize: 12 }}>Apply</Text>
        </TouchableOpacity>
      </View>
      {status === "valid" && (
        <Text style={{ fontSize: 11, color: "#15803D" }}>Code applied — thanks for joining through a friend!</Text>
      )}
      {status === "invalid" && <Text style={{ fontSize: 11, color: "#B91C1C" }}>That code doesn't look right.</Text>}
    </View>
  );
}
