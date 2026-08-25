import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { doc, collection, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import ReportModal from "@/components/ReportModal";
import { colors } from "@/lib/styles";

const submitReportFn = httpsCallable(functions, "submitReport");

export default function Comments({ postId, initialComments }: { postId: string; initialComments: any[] }) {
  const { user } = useAuth();
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [reportingComment, setReportingComment] = useState<{ id: string; userId: string } | null>(null);

  async function handleReportComment(reason: string, details: string) {
    if (!reportingComment) return;
    await submitReportFn({ targetType: "comment", targetId: reportingComment.id, postId, reason, details });
  }

  async function handleSubmit() {
    if (!body.trim()) return;
    if (!user) return router.push("/login");
    setPosting(true);
    setPostError(null);

    try {
      // commentCount itself is maintained server-side (onCommentCreated in functions/index.js) —
      // the client only ever creates the comment doc now.
      const commentsRef = collection(db, "posts", postId, "comments");
      const newCommentRef = doc(commentsRef);

      await setDoc(newCommentRef, {
        body,
        userId: user.uid,
        userName: user.displayName ?? "Member",
        createdAt: serverTimestamp(),
      });

      setComments((prev) => [...prev, { id: newCommentRef.id, body, userId: user.uid, userName: user.displayName ?? "Member" }]);
      setBody("");
    } catch (err: any) {
      // Without this, a failed write (offline, blocked user, rules rejection) threw before
      // setPosting(false) ever ran, leaving the Post button permanently disabled.
      setPostError(err.message ?? "Couldn't post that comment — please try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ fontWeight: "600", marginBottom: 10 }}>Comments</Text>
      {comments.length === 0 && <Text style={{ color: colors.muted, fontSize: 17 }}>No comments yet.</Text>}
      {comments.map((c) => (
        <View key={c.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 17, flex: 1 }}>
            <Text style={{ fontWeight: "600" }}>{c.userName}</Text> <Text>{c.body}</Text>
          </Text>
          {user && user.uid !== c.userId && (
            <TouchableOpacity onPress={() => setReportingComment({ id: c.id, userId: c.userId })}>
              <Text style={{ fontSize: 15, color: colors.muted }}>Report</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {user ? (
        <View style={s.row}>
          <TextInput style={s.input} placeholder="Add a comment" value={body} onChangeText={setBody} />
          <TouchableOpacity style={s.button} onPress={handleSubmit} disabled={posting}>
            <Text style={{ color: "white", fontWeight: "600" }}>Post</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {postError && <Text style={{ color: "#B3261E", fontSize: 14, marginTop: 6 }}>{postError}</Text>}
      {!user && (
        <Text style={{ color: colors.muted, fontSize: 17 }}>Log in to comment.</Text>
      )}
      <ReportModal
        visible={reportingComment !== null}
        onClose={() => setReportingComment(null)}
        onSubmit={handleReportComment}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", marginTop: 8, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white" },
  button: { backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
});
