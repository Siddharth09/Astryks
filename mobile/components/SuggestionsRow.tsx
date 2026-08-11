import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Image, ScrollView } from "react-native";
import { router } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import FollowButton from "@/components/FollowButton";
import { colors } from "@/lib/styles";

const listPublicProfiles = httpsCallable(functions, "listPublicProfiles");

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

type LessonCard = { kind: "lesson"; id: string; title: string; subjectId: string; subjectName: string };
type PersonCard = { kind: "person"; id: string; displayName: string; photoURL: string | null };

export default function SuggestionsRow({ currentUserId }: { currentUserId: string }) {
  const [cards, setCards] = useState<(LessonCard | PersonCard)[] | null>(null);

  useEffect(() => {
    (async () => {
      // The people-suggestions query below used to be a direct `collection("users").limit(40)`
      // — before firestore.rules restricted users/{uid} reads to each doc's own owner, that
      // handed back everyone's full profile (stripeCustomerId/payoutOwed included). Now served
      // through listPublicProfiles, which only ever returns displayName/photoURL.
      const [subjSnap, lessonsSnap, progressSnap, followsSnap, profilesResult] = await Promise.all([
        getDocs(query(collection(db, "subjects"))),
        getDocs(collection(db, "lessons")),
        getDocs(query(collection(db, "lessonProgress"), where("uid", "==", currentUserId))),
        getDocs(query(collection(db, "follows"), where("followerId", "==", currentUserId))),
        listPublicProfiles({ limit: 40 }),
      ]);
      const profiles = (profilesResult.data as any).profiles as {
        uid: string;
        displayName: string | null;
        photoURL: string | null;
      }[];

      const subjectNameById: Record<string, string> = Object.fromEntries(
        subjSnap.docs.map((d) => [d.id, (d.data() as any).name ?? "Lesson"])
      );
      const allLessons = lessonsSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const completedIds = new Set(progressSnap.docs.map((d) => (d.data() as any).lessonId));

      const bySubject: Record<string, any[]> = {};
      for (const l of allLessons) {
        (bySubject[l.subjectId] ??= []).push(l);
      }

      const lessonCards: LessonCard[] = [];
      for (const subjectId of Object.keys(bySubject)) {
        const lessons = bySubject[subjectId];
        const hasStarted = lessons.some((l) => completedIds.has(l.id));
        const nextLesson = lessons.find((l) => !completedIds.has(l.id));
        if (hasStarted && nextLesson) {
          lessonCards.push({
            kind: "lesson",
            id: nextLesson.id,
            title: nextLesson.title,
            subjectId,
            subjectName: subjectNameById[subjectId] ?? "Lesson",
          });
        }
      }
      if (lessonCards.length === 0) {
        for (const subjectId of Object.keys(bySubject)) {
          const lessons = bySubject[subjectId];
          const first = lessons.find((l) => l.pinned) ?? lessons[0];
          if (first) {
            lessonCards.push({
              kind: "lesson",
              id: first.id,
              title: first.title,
              subjectId,
              subjectName: subjectNameById[subjectId] ?? "Lesson",
            });
          }
        }
      }

      const followingIds = new Set(followsSnap.docs.map((d) => (d.data() as any).followingId));
      const peopleCards: PersonCard[] = profiles
        .filter((u) => u.uid !== currentUserId && !followingIds.has(u.uid))
        .slice(0, 8)
        .map((u) => ({ kind: "person" as const, id: u.uid, displayName: u.displayName ?? "Member", photoURL: u.photoURL ?? null }));

      const merged: (LessonCard | PersonCard)[] = [];
      const maxLen = Math.max(lessonCards.length, peopleCards.length);
      for (let i = 0; i < maxLen; i++) {
        if (lessonCards[i]) merged.push(lessonCards[i]);
        if (peopleCards[i]) merged.push(peopleCards[i]);
      }
      setCards(merged);
    })();
  }, [currentUserId]);

  if (cards !== null && cards.length === 0) return null;

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: "600", marginBottom: 8, paddingHorizontal: 16 }}>✨ Suggested for you</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
        {cards === null
          ? Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={{ width: 140, height: 96, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.05)" }} />
            ))
          : cards.map((c) =>
              c.kind === "lesson" ? (
                <TouchableOpacity
                  key={`lesson-${c.id}`}
                  onPress={() => router.push({ pathname: "/(tabs)/learn", params: { subject: c.subjectId } })}
                  style={{ width: 140, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", padding: 12 }}
                >
                  <Text style={{ fontSize: 18 }}>{SUBJECT_ICONS[c.subjectId] ?? "⭐"}</Text>
                  <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: "600", marginTop: 6 }}>{c.title}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>Continue {c.subjectName}</Text>
                </TouchableOpacity>
              ) : (
                <View
                  key={`person-${c.id}`}
                  style={{ width: 120, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", padding: 12, alignItems: "center", gap: 8 }}
                >
                  <TouchableOpacity
                    onPress={() => router.push(`/user/${c.id}`)}
                    style={{ alignItems: "center", gap: 8 }}
                  >
                    {c.photoURL ? (
                      <Image source={{ uri: c.photoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                    ) : (
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#E85D5D", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "white", fontWeight: "600" }}>{c.displayName[0]}</Text>
                      </View>
                    )}
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600" }}>{c.displayName}</Text>
                  </TouchableOpacity>
                  <FollowButton targetUserId={c.id} currentUserId={currentUserId} />
                </View>
              )
            )}
      </ScrollView>
    </View>
  );
}
