import { useState } from "react";
import { Modal, View, Text, TouchableOpacity, TextInput, Alert } from "react-native";
import { colors } from "@/lib/styles";

const REASONS = ["Spam", "Harassment or bullying", "Inappropriate content", "Fake account", "Other"];

export default function ReportModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: string, details: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setDone(false);
    setReason(REASONS[0]);
    setDetails("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(reason, details);
      setDone(true);
    } catch (err: any) {
      Alert.alert("Couldn't submit", err.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: "white", borderRadius: 16, padding: 20 }}>
          {done ? (
            <>
              <Text style={{ fontSize: 17, fontWeight: "700", marginBottom: 8 }}>Report submitted</Text>
              <Text style={{ color: colors.muted, fontSize: 15, marginBottom: 16 }}>
                Thanks — our team will take a look.
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={{ backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
              >
                <Text style={{ color: "white", fontWeight: "600" }}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 17, fontWeight: "700", marginBottom: 12 }}>Report</Text>
              {REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setReason(r)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderColor: reason === r ? colors.ink : colors.line,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {reason === r && (
                      <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.ink }} />
                    )}
                  </View>
                  <Text style={{ fontSize: 16 }}>{r}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Add details (optional)"
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 10,
                  padding: 10,
                  minHeight: 60,
                  textAlignVertical: "top",
                  marginVertical: 10,
                  fontSize: 15,
                }}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                <TouchableOpacity
                  onPress={handleClose}
                  style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
                >
                  <Text style={{ fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={submitting}
                  style={{ flex: 1, backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
                >
                  <Text style={{ color: "white", fontWeight: "600" }}>{submitting ? "Sending…" : "Submit"}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
