import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { doc, collection, writeBatch, increment, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";

const bumpStreak = httpsCallable(functions, "bumpStreak");

export default function Comments({ postId, initialComments }: { postId: string; initialComments: any[] }) {
  const { user } = useAuth();
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function handleSubmit() {
    if (!body.trim()) return;
    if (!user) return router.push("/login");
    setPosting(true);

    const postRef = doc(db, "posts", postId);
    const commentsRef = collection(db, "posts", postId, "comments");
    const newCommentRef = doc(commentsRef);

    const batch = writeBatch(db);
    batch.set(newCommentRef, {
      body,
      userId: user.uid,
      userName: user.displayName ?? "Member",
      createdAt: serverTimestamp(),
    });
    batch.update(postRef, { commentCount: increment(1) });
    await batch.commit();

    setComments((prev) => [...prev, { id: newCommentRef.id, body, userName: user.displayName ?? "Member" }]);
    setBody("");
    setPosting(false);
    bumpStreak().catch(() => {});
  }

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ fontWeight: "600", marginBottom: 10 }}>Comments</Text>
      {comments.length === 0 && <Text style={{ color: colors.muted, fontSize: 13 }}>No comments yet.</Text>}
      {comments.map((c) => (
        <Text key={c.id} style={{ marginBottom: 6, fontSize: 13 }}>
          <Text style={{ fontWeight: "600" }}>{c.userName}</Text> <Text>{c.body}</Text>
        </Text>
      ))}
      {user ? (
        <View style={s.row}>
          <TextInput style={s.input} placeholder="Add a comment" value={body} onChangeText={setBody} />
          <TouchableOpacity style={s.button} onPress={handleSubmit} disabled={posting}>
            <Text style={{ color: "white", fontWeight: "600" }}>Post</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 13 }}>Log in to comment.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", marginTop: 8, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white" },
  button: { backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
});
