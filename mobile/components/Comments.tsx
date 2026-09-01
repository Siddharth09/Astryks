import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { doc, collection, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleReportComment(reason: string, details: string) {
    if (!reportingComment) return;
    await submitReportFn({ targetType: "comment", targetId: reportingComment.id, postId, reason, details });
  }

  // firestore.rules already lets a comment's own author delete it directly — this was just
  // never wired up to any UI. commentCount on the parent post updates itself server-side
  // (onCommentDeleted in functions/index.js), so there's nothing else to do here.
  function confirmDelete(commentId: string) {
    Alert.alert("Delete this comment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingId(commentId);
          try {
            await deleteDoc(doc(db, "posts", postId, "comments", commentId));
            setComments((prev) => prev.filter((c) => c.id !== commentId));
          } catch (err: any) {
            Alert.alert("Couldn't delete", err.message ?? "Please try again.");
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
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
          {user && user.uid === c.userId && (
            <TouchableOpacity onPress={() => confirmDelete(c.id)} disabled={deletingId === c.id}>
              <Text style={{ fontSize: 15, color: "#B3261E", opacity: deletingId === c.id ? 0.5 : 1 }}>
                {deletingId === c.id ? "…" : "Delete"}
              </Text>
            </TouchableOpacity>
          )}
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
