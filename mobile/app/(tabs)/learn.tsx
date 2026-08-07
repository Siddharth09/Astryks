import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { collection, getDocs, query, where, orderBy, doc, updateDoc, increment, getDoc } from "firebase/firestore";
import { WebView } from "react-native-webview";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import SubscriptionBanner from "@/components/SubscriptionBanner";

const completeLessonFn = httpsCallable(functions, "completeLesson");
const ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

export default function LearnScreen() {
  const { user, loading: authLoading } = useAuth();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [allLessons, setAllLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [active, setActive] = useState<any | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => setSubscribed(snap.data()?.subscriptionStatus === "active"));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const subjSnap = await getDocs(query(collection(db, "subjects"), orderBy("order", "asc")));
      setSubjects(subjSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const lessonsSnap = await getDocs(collection(db, "lessons"));
      setAllLessons(lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const progressSnap = await getDocs(query(collection(db, "lessonProgress"), where("uid", "==", user.uid)));
      setCompleted(new Set(progressSnap.docs.map((d) => d.data().lessonId)));
    })();
  }, [user]);

  async function openSubject(subject: any) {
    setActive(subject);
    const snap = await getDocs(query(collection(db, "lessons"), where("subjectId", "==", subject.id), orderBy("order", "asc")));
    setLessons(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  function openSubjectById(subjectId: string) {
    const subject = (subjects ?? []).find((s) => s.id === subjectId);
    if (subject) openSubject(subject);
  }

  const subjectNameById: Record<string, string> = Object.fromEntries(
    (subjects ?? []).map((s) => [s.id, s.name])
  );

  async function markComplete(lessonId: string) {
    await completeLessonFn({ lessonId });
    setCompleted((prev) => new Set(prev).add(lessonId));
  }

  async function playLesson(lessonId: string) {
    if (!subscribed) return;
    setPlayingId((prev) => (prev === lessonId ? null : lessonId));
    if (!viewedIds.has(lessonId)) {
      setViewedIds((prev) => new Set(prev).add(lessonId));
      await updateDoc(doc(db, "lessons", lessonId), { viewCount: increment(1) });
      setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, viewCount: (l.viewCount ?? 0) + 1 } : l)));
    }
  }

  if (authLoading || !user || subjects === null) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (active) {
    return (
      <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
        <TouchableOpacity onPress={() => setActive(null)}>
          <Text style={{ color: colors.muted, marginBottom: 16 }}>← Subjects</Text>
        </TouchableOpacity>
        <SubscriptionBanner />
        <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 6 }}>{active.name}</Text>
        {lessons.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {lessons.filter((l) => completed.has(l.id)).length} of {lessons.length} complete
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {Math.round((lessons.filter((l) => completed.has(l.id)).length / lessons.length) * 100)}%
              </Text>
            </View>
            <View style={{ height: 8, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
              <View
                style={{
                  height: "100%",
                  width: `${Math.round((lessons.filter((l) => completed.has(l.id)).length / lessons.length) * 100)}%`,
                  backgroundColor: "#E85D5D",
                }}
              />
            </View>
          </View>
        )}
        {lessons.map((lesson, i) => {
          const done = completed.has(lesson.id);
          const prevDone = i === 0 || completed.has(lessons[i - 1].id);
          const locked = !done && !prevDone;
          return (
            <View key={lesson.id} style={{ marginBottom: 18 }}>
              <TouchableOpacity
                onPress={() => !locked && playLesson(lesson.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                disabled={locked}
              >
                <View
                  style={{
                    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                    backgroundColor: done ? "#E85D5D" : "transparent",
                    borderWidth: done ? 0 : 2, borderColor: "#E85D5D",
                  }}
                >
                  <Text style={{ color: done ? "white" : locked ? colors.muted : "#E85D5D" }}>
                    {done ? "✓" : locked ? "🔒" : "▶"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: locked ? colors.muted : colors.ink }}>
                    {lesson.pinned ? "📌 " : ""}{lesson.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{lesson.viewCount ?? 0} views</Text>
                </View>
                {!locked && !done && (
                  <TouchableOpacity onPress={() => markComplete(lesson.id)}>
                    <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "underline" }}>Mark done</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              {playingId === lesson.id && lesson.bunnyVideoId && (
                <WebView
                  source={{ uri: `https://iframe.mediadelivery.net/embed/${lesson.bunnyLibraryId}/${lesson.bunnyVideoId}` }}
                  style={{ width: "100%", height: 200, borderRadius: 12, marginTop: 10 }}
                />
              )}
            </View>
          );
        })}
        {lessons.length === 0 && <Text style={{ color: colors.muted }}>No lessons added yet.</Text>}
      </ScrollView>
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const matches = q
    ? allLessons.filter(
        (l) => l.title?.toLowerCase().includes(q) || subjectNameById[l.subjectId]?.toLowerCase().includes(q)
      )
    : [];
  const pinnedLessons = allLessons.filter((l) => l.pinned);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 56, paddingHorizontal: 16 }}>
      {pinnedLessons.length > 0 && !q && (
        <View style={{ marginBottom: 18 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", marginBottom: 8 }}>📌 Pinned lessons</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {pinnedLessons.map((l) => (
              <TouchableOpacity
                key={l.id}
                onPress={() => openSubjectById(l.subjectId)}
                style={{ width: 152, marginRight: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", padding: 12 }}
              >
                <Text style={{ fontSize: 18 }}>{ICONS[l.subjectId] ?? "⭐"}</Text>
                <Text numberOfLines={2} style={{ fontSize: 13, fontWeight: "600", marginTop: 6 }}>{l.title}</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{subjectNameById[l.subjectId] ?? "Lesson"}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      <Text style={{ color: colors.muted, marginBottom: 8 }}>Pick a subject</Text>
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search lessons — try “music”, “art”, “finance”…"
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "white", marginBottom: 14, fontSize: 14 }}
      />
      {q ? (
        matches.length === 0 ? (
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 24 }}>No lessons match "{searchQuery}".</Text>
        ) : (
          <ScrollView style={{ gap: 8 }}>
            {matches.map((l) => (
              <TouchableOpacity
                key={l.id}
                onPress={() => openSubjectById(l.subjectId)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, backgroundColor: "white", marginBottom: 8 }}
              >
                <Text style={{ fontSize: 20 }}>{ICONS[l.subjectId] ?? "⭐"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{l.title}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{subjectNameById[l.subjectId] ?? "Lesson"}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )
      ) : (
        <View style={{ flexDirection: "row", gap: 16 }}>
          {subjects.map((s) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => openSubject(s)}
              style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <Text style={{ fontSize: 24 }}>{ICONS[s.id] ?? "⭐"}</Text>
              <Text style={{ color: "white", fontSize: 12 }}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 1.5, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 20, color: colors.muted }}>+</Text>
          </View>
        </View>
      )}
    </View>
  );
}
