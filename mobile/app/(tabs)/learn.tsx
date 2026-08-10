import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Image } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { collection, getDocs, query, where, orderBy, doc, updateDoc, increment, getDoc } from "firebase/firestore";
import { WebView } from "react-native-webview";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import SubscriptionBanner from "@/components/SubscriptionBanner";

const completeLessonFn = httpsCallable(functions, "completeLesson");
const getLessonPlaybackFn = httpsCallable(functions, "getLessonPlayback");
const ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

const SUBJECT_CARDS: {
  id: string;
  name: string;
  tagline: string;
  thumbnail?: any;
  size: number;
  comingSoon?: boolean;
}[] = [
  { id: "music", name: "Music", tagline: "Create a song from scratch", thumbnail: require("@/assets/music-preview.jpg"), size: 176 },
  { id: "art", name: "Art", tagline: "Create a self portrait", thumbnail: require("@/assets/art-preview.jpg"), size: 128 },
  // Investing (share market) is next up — add its card here once the first lessons are uploaded.
];

function tierFor(pct: number): { emoji: string; label: string } | null {
  if (pct >= 100) return { emoji: "🏆", label: "Mastered" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway there" };
  if (pct >= 25) return { emoji: "🥉", label: "Getting started" };
  return null;
}

export default function LearnScreen() {
  const { user, loading: authLoading } = useAuth();
  const { subject: wantedSubjectId } = useLocalSearchParams<{ subject?: string }>();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [allLessons, setAllLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [active, setActive] = useState<any | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, { bunnyVideoId: string; bunnyLibraryId: string } | null>>({});
  const [playbackLoading, setPlaybackLoading] = useState<string | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [justMastered, setJustMastered] = useState<string | null>(null);

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

  useEffect(() => {
    if (wantedSubjectId && subjects && !active) {
      openSubjectById(wantedSubjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, wantedSubjectId]);

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
    const result = await completeLessonFn({ lessonId });
    setCompleted((prev) => new Set(prev).add(lessonId));
    const mastered = (result.data as any)?.masteredSubject;
    if (mastered && active) {
      setJustMastered(active.name);
      setTimeout(() => setJustMastered(null), 5000);
    }
  }

  async function playLesson(lessonId: string) {
    if (!subscribed) return;
    const opening = playingId !== lessonId;
    setPlayingId((prev) => (prev === lessonId ? null : lessonId));

    // Playback credentials no longer live on the public lessons doc (see functions/index.js) —
    // fetch them from the subscription-gated callable each time a lesson is opened.
    if (opening && !playback[lessonId]) {
      setPlaybackLoading(lessonId);
      try {
        const result = await getLessonPlaybackFn({ lessonId });
        setPlayback((prev) => ({ ...prev, [lessonId]: result.data as { bunnyVideoId: string; bunnyLibraryId: string } }));
      } catch {
        setPlayback((prev) => ({ ...prev, [lessonId]: null }));
      }
      setPlaybackLoading(null);
    }

    if (opening && !viewedIds.has(lessonId)) {
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
        {justMastered && (
          <View style={{ backgroundColor: "#E85D5D", borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <Text style={{ color: "white", fontWeight: "600", fontSize: 13, textAlign: "center" }}>
              🏆 You&apos;ve mastered {justMastered}! +50 bonus xp
            </Text>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={{ fontSize: 22, fontWeight: "700" }}>{active.name}</Text>
          {lessons.length > 0 && (
            <Text style={{ fontSize: 11, color: colors.muted }}>{lessons.length} lesson{lessons.length === 1 ? "" : "s"}</Text>
          )}
        </View>
        {lessons.length > 0 && (() => {
          const done = lessons.filter((l) => completed.has(l.id)).length;
          const pct = Math.round((done / lessons.length) * 100);
          const tier = tierFor(pct);
          return (
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>{done} of {lessons.length} complete</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{pct}%</Text>
              </View>
              <View style={{ height: 8, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, backgroundColor: "#E85D5D" }} />
              </View>
              {tier && (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                  {tier.emoji} {tier.label}
                </Text>
              )}
            </View>
          );
        })()}
        {/* Course path: each lesson is a stop on a vertical timeline. The connector between two
            stops turns yellow once the stop above it is done — so the yellow line's length IS
            your progress through the course, not just a decorative divider. The single "current"
            stop (first not-done lesson) gets a yellow ring + "Up next" badge so it's obvious
            where to pick up. */}
        {lessons.map((lesson, i) => {
          const done = completed.has(lesson.id);
          const prevDone = i === 0 || completed.has(lessons[i - 1].id);
          const locked = !done && !prevDone;
          const isCurrent = !done && !locked;
          return (
            <View key={lesson.id} style={{ marginBottom: 18 }}>
              {i > 0 && (
                <View
                  style={{
                    width: 4, height: 22, borderRadius: 2, marginLeft: 20, marginBottom: 4,
                    backgroundColor: completed.has(lessons[i - 1].id) ? "#EFC13B" : "rgba(0,0,0,0.08)",
                  }}
                />
              )}
              <TouchableOpacity
                onPress={() => !locked && playLesson(lesson.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                disabled={locked}
              >
                <View
                  style={{
                    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                    backgroundColor: done ? "#E85D5D" : isCurrent ? "#EFC13B" : "transparent",
                    borderWidth: done || isCurrent ? 0 : 2, borderColor: "#E85D5D",
                    shadowColor: isCurrent ? "#EFC13B" : undefined,
                    shadowOpacity: isCurrent ? 0.5 : 0,
                    shadowRadius: isCurrent ? 6 : 0,
                    elevation: isCurrent ? 4 : 0,
                  }}
                >
                  <Text style={{ color: done || isCurrent ? "white" : locked ? colors.muted : "#E85D5D" }}>
                    {done ? "✓" : locked ? "🔒" : "▶"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: locked ? colors.muted : colors.ink }}>
                      {lesson.pinned ? "📌 " : ""}{lesson.title}
                    </Text>
                    {isCurrent && (
                      <View style={{ backgroundColor: "#FFF6F1", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: "#C94A4A", textTransform: "uppercase" }}>Up next</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Lesson {i + 1} · {lesson.viewCount ?? 0} views</Text>
                </View>
                {!locked && !done && (
                  <TouchableOpacity onPress={() => markComplete(lesson.id)}>
                    <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "underline" }}>
                      Mark done <Text style={{ color: "rgba(0,0,0,0.3)" }}>+10xp</Text>
                    </Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              {playingId === lesson.id && playbackLoading === lesson.id && (
                <Text style={{ color: colors.muted, marginTop: 10 }}>Loading video…</Text>
              )}
              {playingId === lesson.id && playback[lesson.id]?.bunnyVideoId && (
                <WebView
                  source={{ uri: `https://iframe.mediadelivery.net/embed/${playback[lesson.id]!.bunnyLibraryId}/${playback[lesson.id]!.bunnyVideoId}` }}
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

  const subjectTier: Record<string, { emoji: string; label: string } | null> = {};
  for (const s of subjects ?? []) {
    const subjectLessons = allLessons.filter((l) => l.subjectId === s.id);
    if (subjectLessons.length === 0) continue;
    const done = subjectLessons.filter((l) => completed.has(l.id)).length;
    subjectTier[s.id] = tierFor(Math.round((done / subjectLessons.length) * 100));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 32 }}
    >
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
        placeholder="Search lessons — try “music” or “art”…"
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
        <View style={{ alignItems: "center", gap: 28 }}>
          {SUBJECT_CARDS.map((card) => {
            const subject = subjects.find((s) => s.id === card.id);
            if (card.comingSoon || !subject) {
              return (
                <View key={card.id} style={{ alignItems: "center", gap: 10, opacity: 0.5 }}>
                  <View
                    style={{
                      width: card.size, height: card.size, borderRadius: card.size / 2,
                      backgroundColor: "rgba(0,0,0,0.06)", borderWidth: 1.5, borderColor: colors.line, borderStyle: "dashed",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 30 }}>{ICONS[card.id] ?? "⭐"}</Text>
                  </View>
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 15 }}>{card.name}</Text>
                    <Text style={{ fontSize: 13, color: colors.muted }}>{card.tagline}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Coming soon</Text>
                  </View>
                </View>
              );
            }
            return (
              <TouchableOpacity key={card.id} onPress={() => openSubject(subject)} style={{ alignItems: "center", gap: 10 }}>
                <View style={{ width: card.size, height: card.size, borderRadius: card.size / 2, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 3 }}>
                  <Image source={card.thumbnail} style={{ width: "100%", height: "100%" }} />
                  {subjectTier[card.id] && (
                    <View
                      style={{
                        position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14,
                        backgroundColor: "white", alignItems: "center", justifyContent: "center",
                        shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, elevation: 2,
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{subjectTier[card.id]!.emoji}</Text>
                    </View>
                  )}
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontWeight: "700", fontSize: 17 }}>{card.name}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{card.tagline}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
