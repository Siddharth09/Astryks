import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Modal, Image } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { collection, getDocs, query, where, orderBy, doc, updateDoc, increment, getDoc } from "firebase/firestore";
import { WebView } from "react-native-webview";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/styles";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import { purchaseSubscription } from "@/lib/purchases";

const completeLessonFn = httpsCallable(functions, "completeLesson");
const getLessonPlaybackFn = httpsCallable(functions, "getLessonPlayback");
const reportPreviewProgressFn = httpsCallable(functions, "reportPreviewProgress");
const ICONS: Record<string, string> = { music: "🎵", art: "🎨" };
const THUMBNAILS: Record<string, any> = {
  music: require("@/assets/music-preview.jpg"),
  art: require("@/assets/art-preview.jpg"),
};

const SUBJECT_CARDS: {
  id: string;
  name: string;
  tagline: string;
  size: number;
  comingSoon?: boolean;
}[] = [
  // Both the same size — they used to differ (176 vs 128), which read as one subject being more
  // "important" than the other with no actual reason for it.
  { id: "music", name: "Music", tagline: "Create a song from scratch", size: 160 },
  { id: "art", name: "Art", tagline: "Create a self portrait", size: 160 },
];

function tierFor(pct: number): { emoji: string; label: string } | null {
  if (pct >= 100) return { emoji: "🏆", label: "Mastered" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway there" };
  if (pct >= 25) return { emoji: "🥉", label: "Getting started" };
  return null;
}

function formatMinutesSeconds(totalSeconds: number): string {
  const m = Math.floor(Math.max(0, totalSeconds) / 60);
  const s = Math.max(0, totalSeconds) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LearnScreen() {
  const { user, loading: authLoading } = useAuth();
  const navigation = useNavigation();
  const { subject: wantedSubjectId } = useLocalSearchParams<{ subject?: string }>();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [allLessons, setAllLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [active, setActive] = useState<any | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, { bunnyVideoId: string; bunnyLibraryId: string; subjectId: string | null; freePreviewSecondsRemaining: number | null } | null>>({});
  const [playbackLoading, setPlaybackLoading] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<Record<string, string | null>>({});
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [justMastered, setJustMastered] = useState<string | null>(null);
  // Keyed by subjectId (not a single flat number) — each subject gets its OWN 10 minutes, so
  // Music running out doesn't affect Art. Values come straight from the server's own count
  // (getLessonPlayback/reportPreviewProgress responses), never computed purely client-side.
  const [previewRemainingBySubject, setPreviewRemainingBySubject] = useState<Record<string, number>>({});
  const [previewExhaustedSubject, setPreviewExhaustedSubject] = useState<{ id: string; name: string } | null>(null);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

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

  // Tapping the "Learn" tab while already inside a subject used to leave you exactly where you
  // were (expo-router/React Navigation don't reset a tab's state just because its icon was
  // tapped again) — tapping Learn should always mean "take me back to the subject picker", the
  // same way tapping a tab icon again resets most apps' tabs to their root screen.
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener("tabPress", () => {
      if (active) {
        setActive(null);
        setPlayingId(null);
        setPreviewExhaustedSubject(null);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, active]);

  async function openSubject(subject: any) {
    setActive(subject);
    // Stop any lesson that was playing in whatever subject we're navigating away from — without
    // this, `playingId` (and the report-progress interval keyed off it, below) kept referring to
    // the old subject's lesson, so switching subjects while a video was open silently kept
    // ticking down the PREVIOUS subject's free-preview budget in the background. Also clear any
    // paywall modal left over from that subject so it doesn't pop back up on top of this one.
    setPlayingId(null);
    setPreviewExhaustedSubject(null);
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
    // No subscription gate here — non-subscribers can open a lesson too, they just get capped
    // at 10 minutes of free preview PER SUBJECT (enforced server-side by getLessonPlayback, not
    // by anything client-side). Once a subject's allowance is gone, the callable below throws
    // and we show a paywall modal instead of a player.
    const opening = playingId !== lessonId;
    setPlayingId((prev) => (prev === lessonId ? null : lessonId));

    // Playback credentials no longer live on the public lessons doc (see functions/index.js) —
    // fetch them from the gated callable each time a lesson is opened. This is a real permission
    // re-check, not just a cache warm-up: it's what stops someone from watching for free forever
    // by opening a lesson once (while they still had preview time), then closing and reopening
    // that same lesson after their subject's 10 minutes ran out — a `!playback[lessonId]` guard
    // here used to skip this call entirely once a lesson had been fetched once, so a lesson
    // opened before the cap was hit would keep playing on every later reopen with no server
    // check at all.
    if (opening) {
      setPlaybackLoading(lessonId);
      setPlaybackError((prev) => ({ ...prev, [lessonId]: null }));
      try {
        const result = await getLessonPlaybackFn({ lessonId });
        const data = result.data as {
          bunnyVideoId: string;
          bunnyLibraryId: string;
          subjectId: string | null;
          freePreviewSecondsRemaining: number | null;
        };
        setPlayback((prev) => ({ ...prev, [lessonId]: data }));
        if (data.subjectId && data.freePreviewSecondsRemaining != null) {
          setPreviewRemainingBySubject((prev) => ({ ...prev, [data.subjectId as string]: data.freePreviewSecondsRemaining as number }));
        }
      } catch (err: any) {
        setPlayingId(null);
        setPlayback((prev) => ({ ...prev, [lessonId]: null }));
        if (err?.code === "functions/permission-denied" && active) {
          setPreviewRemainingBySubject((prev) => ({ ...prev, [active.id]: 0 }));
          setPreviewExhaustedSubject({ id: active.id, name: active.name });
        } else {
          setPlaybackError((prev) => ({ ...prev, [lessonId]: "Couldn't load this video — please try again." }));
        }
      }
      setPlaybackLoading(null);
    }

    if (opening && !viewedIds.has(lessonId)) {
      setViewedIds((prev) => new Set(prev).add(lessonId));
      await updateDoc(doc(db, "lessons", lessonId), { viewCount: increment(1) });
      setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, viewCount: (l.viewCount ?? 0) + 1 } : l)));
    }
  }

  // While a non-subscriber has a lesson open, report ~10s of watch time to the server every 10s
  // so the free-preview allowance is backed by a real counter — see reportPreviewProgress in
  // functions/index.js. Stops the moment that SUBJECT's allowance hits 0 (pausing playback and
  // popping up the subscribe prompt) rather than letting the video keep playing past the cap.
  useEffect(() => {
    const currentSubjectId = playback[playingId ?? ""]?.subjectId ?? undefined;
    if (!playingId || !currentSubjectId || previewRemainingBySubject[currentSubjectId] == null) return;
    const interval = setInterval(async () => {
      try {
        const result = await reportPreviewProgressFn({ lessonId: playingId, seconds: 10 });
        const { secondsUsed, secondsAllowed, subjectId } = result.data as {
          secondsUsed: number;
          secondsAllowed: number;
          subjectId: string | null;
        };
        if (!subjectId) return;
        const remaining = secondsAllowed - secondsUsed;
        setPreviewRemainingBySubject((prev) => ({ ...prev, [subjectId]: remaining }));
        if (remaining <= 0) {
          setPlayingId(null);
          const subject = (subjects ?? []).find((s) => s.id === subjectId);
          setPreviewExhaustedSubject({ id: subjectId, name: subject?.name || "this subject" });
        }
      } catch {
        // Not fatal — worst case the cap is enforced a little late next time getLessonPlayback
        // is called, not that it never gets enforced at all.
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [playingId, previewRemainingBySubject, playback, subjects]);

  async function handleSubscribeFromPreview() {
    if (!user) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    const result = await purchaseSubscription();
    if (result.success) {
      setSubscribed(true);
      setPreviewExhaustedSubject(null);
      // Optimistic write, same as SubscriptionBanner's own subscribe handler — the real
      // update lands later via the Qonversion webhook, but without this, re-opening a subject
      // (which remounts SubscriptionBanner) re-reads the stale pre-webhook value and shows the
      // "Subscribe" banner again right after someone just subscribed.
      updateDoc(doc(db, "users", user.uid), { subscriptionStatus: "active" }).catch(() => {});
    } else if (result.error) {
      setSubscribeError(result.error);
    }
    setSubscribeLoading(false);
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
      <>
      <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
        <TouchableOpacity
          onPress={() => {
            setActive(null);
            // Same reasoning as openSubject() above: leaving the subject screen should stop
            // playback (and the background progress-reporting interval it drives) and clear any
            // stale paywall modal, so they don't leak into whichever subject is opened next.
            setPlayingId(null);
            setPreviewExhaustedSubject(null);
          }}
        >
          <Text style={{ color: colors.muted, marginBottom: 16 }}>← Subjects</Text>
        </TouchableOpacity>
        {/* Gated on the subscription state this screen already tracks, rather than letting
            SubscriptionBanner do its own separate (and easily stale) fetch — see
            handleSubscribeFromPreview above for why that fetch could disagree with reality. */}
        {subscribed === false && <SubscriptionBanner />}
        {justMastered && (
          <View style={{ backgroundColor: "#E85D5D", borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <Text style={{ color: "white", fontWeight: "600", fontSize: 15, textAlign: "center" }}>
              🏆 You&apos;ve mastered {justMastered}! +50 bonus xp
            </Text>
          </View>
        )}
        <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 6 }}>{active.name}</Text>
        {!subscribed && previewRemainingBySubject[active.id] != null && (
          <View style={{ backgroundColor: "#FFF6F1", borderRadius: 12, padding: 10, marginBottom: 14, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, color: colors.ink, opacity: 0.7 }}>
              {previewRemainingBySubject[active.id] > 0
                ? `Free preview of ${active.name}: ${formatMinutesSeconds(previewRemainingBySubject[active.id])} left`
                : `Free preview of ${active.name} used up`}
            </Text>
          </View>
        )}
        {lessons.length > 0 && (() => {
          const done = lessons.filter((l) => completed.has(l.id)).length;
          const pct = Math.round((done / lessons.length) * 100);
          const tier = tierFor(pct);
          return (
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>{done} of {lessons.length} complete</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>{pct}%</Text>
              </View>
              <View style={{ height: 8, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.teal }} />
              </View>
              {tier && (
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>
                  {tier.emoji} {tier.label}
                </Text>
              )}
            </View>
          );
        })()}
        {/* Course timeline: each lesson is a stop, connected by a vertical line. The connector
            between two stops turns yellow once the stop above it is done — so the yellow line's
            length IS your progress through the course, matching the web app's Learn page. The
            single "current" stop (first not-done, unlocked lesson) gets a yellow ring so it's
            obvious where to pick up. */}
        {lessons.map((lesson, i) => {
          const done = completed.has(lesson.id);
          const prevDone = i === 0 || completed.has(lessons[i - 1].id);
          const locked = !done && !prevDone;
          const isCurrent = !done && !locked;
          return (
            <View key={lesson.id}>
              {i > 0 && (
                <View style={{ alignItems: "flex-start", paddingLeft: 21 }}>
                  <View
                    style={{
                      width: 4, height: 20, borderRadius: 2,
                      backgroundColor: completed.has(lessons[i - 1].id) ? colors.teal : "rgba(0,0,0,0.1)",
                    }}
                  />
                </View>
              )}
              <View style={{ marginBottom: 18 }}>
                <TouchableOpacity
                  onPress={() => !locked && playLesson(lesson.id)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                  disabled={locked}
                >
                  <View
                    style={{
                      width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                      backgroundColor: done ? "#E85D5D" : isCurrent ? colors.teal : "transparent",
                      borderWidth: done || isCurrent ? 0 : 2, borderColor: "#E85D5D",
                      shadowColor: isCurrent ? colors.teal : "transparent",
                      shadowOpacity: isCurrent ? 0.5 : 0,
                      shadowRadius: isCurrent ? 6 : 0,
                      elevation: isCurrent ? 3 : 0,
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
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#C94A4A", textTransform: "uppercase" }}>Up next</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 13, color: colors.muted }}>Lesson {i + 1} · {lesson.viewCount ?? 0} views</Text>
                  </View>
                  {!locked && !done && (
                    <TouchableOpacity onPress={() => markComplete(lesson.id)}>
                      <Text style={{ fontSize: 14, color: colors.muted, textDecorationLine: "underline" }}>Mark done</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                {playingId === lesson.id && playbackLoading === lesson.id && (
                  <Text style={{ color: colors.muted, marginTop: 10 }}>Loading video…</Text>
                )}
                {playbackError[lesson.id] && (
                  <Text style={{ color: "#B3261E", marginTop: 10, fontSize: 15 }}>{playbackError[lesson.id]}</Text>
                )}
                {playingId === lesson.id && playback[lesson.id]?.bunnyVideoId && (
                  <WebView
                    source={{ uri: `https://iframe.mediadelivery.net/embed/${playback[lesson.id]!.bunnyLibraryId}/${playback[lesson.id]!.bunnyVideoId}` }}
                    style={{ width: "100%", height: 200, borderRadius: 12, marginTop: 10 }}
                  />
                )}
              </View>
            </View>
          );
        })}
        {lessons.length === 0 && <Text style={{ color: colors.muted }}>No lessons added yet.</Text>}
      </ScrollView>

      <Modal
        visible={!!previewExhaustedSubject}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewExhaustedSubject(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPreviewExhaustedSubject(null)}
          style={{ flex: 1, backgroundColor: "rgba(23,19,15,0.5)", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, alignItems: "center" }}>
            <Text style={{ fontSize: 33, marginBottom: 10 }}>🔒</Text>
            <Text style={{ fontSize: 21, fontWeight: "800", color: colors.ink, textAlign: "center", marginBottom: 8 }}>
              That&apos;s your free preview of {previewExhaustedSubject?.name}
            </Text>
            <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center", marginBottom: 18, lineHeight: 19 }}>
              You&apos;ve used your 10 free minutes for {previewExhaustedSubject?.name}. Subscribe to keep
              watching — every subject, every lesson, cancel any time.
            </Text>
            {subscribeError && (
              <Text style={{ fontSize: 14, color: "#B3261E", marginBottom: 10, textAlign: "center" }}>{subscribeError}</Text>
            )}
            <TouchableOpacity
              onPress={handleSubscribeFromPreview}
              disabled={subscribeLoading}
              style={{ width: "100%", marginBottom: 10, backgroundColor: colors.ink, borderRadius: 999, paddingVertical: 12, opacity: subscribeLoading ? 0.6 : 1 }}
            >
              <Text style={{ color: "white", fontSize: 17, fontWeight: "700", textAlign: "center" }}>
                {subscribeLoading ? "Loading…" : "Subscribe"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPreviewExhaustedSubject(null)}>
              <Text style={{ fontSize: 14, color: colors.muted, textDecorationLine: "underline" }}>Maybe later</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
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
          <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8 }}>📌 Pinned lessons</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {pinnedLessons.map((l) => (
              <TouchableOpacity
                key={l.id}
                onPress={() => openSubjectById(l.subjectId)}
                style={{ width: 152, marginRight: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line + "1A", backgroundColor: "white", padding: 12 }}
              >
                <Text style={{ fontSize: 20 }}>{ICONS[l.subjectId] ?? "⭐"}</Text>
                <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: "600", marginTop: 6 }}>{l.title}</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{subjectNameById[l.subjectId] ?? "Lesson"}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      <Text style={{ color: colors.muted, marginBottom: 8 }}>Pick a subject</Text>
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search lessons — try “music”, “art”…"
        style={{ borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "white", marginBottom: 14, fontSize: 16 }}
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
                style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line + "1A", borderRadius: 12, padding: 12, backgroundColor: "white", marginBottom: 8 }}
              >
                <Text style={{ fontSize: 22 }}>{ICONS[l.subjectId] ?? "⭐"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600" }} numberOfLines={1}>{l.title}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{subjectNameById[l.subjectId] ?? "Lesson"}</Text>
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
                      backgroundColor: "rgba(0,0,0,0.06)", borderWidth: 1.5, borderColor: colors.line + "1A", borderStyle: "dashed",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 31 }}>{ICONS[card.id] ?? "⭐"}</Text>
                  </View>
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 17 }}>{card.name}</Text>
                    <Text style={{ fontSize: 15, color: colors.muted }}>{card.tagline}</Text>
                    <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>Coming soon</Text>
                  </View>
                </View>
              );
            }
            return (
              <TouchableOpacity key={card.id} onPress={() => openSubject(subject)} style={{ alignItems: "center", gap: 10 }}>
                <View style={{ width: card.size, height: card.size, borderRadius: card.size / 2, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 3, backgroundColor: colors.accent }}>
                  {THUMBNAILS[card.id] ? (
                    <Image source={THUMBNAILS[card.id]} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: card.size * 0.32 }}>{ICONS[card.id] ?? "⭐"}</Text>
                    </View>
                  )}
                  {subjectTier[card.id] && (
                    <View
                      style={{
                        position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14,
                        backgroundColor: "white", alignItems: "center", justifyContent: "center",
                        shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, elevation: 2,
                      }}
                    >
                      <Text style={{ fontSize: 16 }}>{subjectTier[card.id]!.emoji}</Text>
                    </View>
                  )}
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontWeight: "700", fontSize: 19 }}>{card.name}</Text>
                  <Text style={{ fontSize: 15, color: colors.muted }}>{card.tagline}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
