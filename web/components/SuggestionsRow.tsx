"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import FollowButton from "@/components/FollowButton";

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

type LessonCard = { kind: "lesson"; id: string; title: string; subjectId: string; subjectName: string };
type PersonCard = { kind: "person"; id: string; displayName: string; photoURL: string | null };

export default function SuggestionsRow({ currentUserId }: { currentUserId: string }) {
  const [cards, setCards] = useState<(LessonCard | PersonCard)[] | null>(null);

  useEffect(() => {
    (async () => {
      const [subjSnap, lessonsSnap, progressSnap, followsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "subjects"))),
        getDocs(collection(db, "lessons")),
        getDocs(query(collection(db, "lessonProgress"), where("uid", "==", currentUserId))),
        getDocs(query(collection(db, "follows"), where("followerId", "==", currentUserId))),
        getDocs(query(collection(db, "users"), limit(40))),
      ]);

      const subjectNameById: Record<string, string> = Object.fromEntries(
        subjSnap.docs.map((d) => [d.id, (d.data() as any).name ?? "Lesson"])
      );
      const allLessons = lessonsSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const completedIds = new Set(progressSnap.docs.map((d) => (d.data() as any).lessonId));

      // Group lessons by subject, in order.
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
      // If nothing in progress yet, suggest the pinned/first lesson of each subject instead.
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
      const peopleCards: PersonCard[] = usersSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((u) => u.id !== currentUserId && !followingIds.has(u.id))
        .slice(0, 8)
        .map((u) => ({ kind: "person" as const, id: u.id, displayName: u.displayName ?? "Member", photoURL: u.photoURL ?? null }));

      // Interleave lessons and people so the row feels mixed rather than two separate blocks.
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
    <div className="mb-5">
      <p className="text-sm font-medium mb-2">✨ Suggested for you</p>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {cards === null
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-36 h-24 rounded-xl bg-ink/5 animate-pulse" />
            ))
          : cards.map((c) =>
              c.kind === "lesson" ? (
                <Link
                  key={`lesson-${c.id}`}
                  href={`/learn?subject=${c.subjectId}`}
                  className="flex-shrink-0 w-36 rounded-xl border border-ink/10 bg-white text-left p-3"
                >
                  <span className="text-xl">{SUBJECT_ICONS[c.subjectId] ?? "⭐"}</span>
                  <p className="text-sm font-medium mt-1.5 line-clamp-2">{c.title}</p>
                  <p className="text-xs text-ink/40 mt-0.5">Continue {c.subjectName}</p>
                </Link>
              ) : (
                <div
                  key={`person-${c.id}`}
                  className="flex-shrink-0 w-36 rounded-xl border border-ink/10 bg-white text-left p-3 flex flex-col items-center gap-2"
                >
                  <Link href={`/user/${c.id}`} className="flex flex-col items-center gap-2">
                    {c.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium"
                        style={{ background: "#E85D5D" }}
                      >
                        {c.displayName[0]}
                      </div>
                    )}
                    <p className="text-xs font-medium text-center line-clamp-1">{c.displayName}</p>
                  </Link>
                  <FollowButton targetUserId={c.id} currentUserId={currentUserId} />
                </div>
              )
            )}
      </div>
    </div>
  );
}
