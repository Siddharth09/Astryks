"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy, doc, updateDoc, increment, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import { SubjectsSkeleton } from "@/components/Skeleton";

const completeLessonFn = httpsCallable(functions, "completeLesson");

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

export default function LearnPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [allLessons, setAllLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSubject, setActiveSubject] = useState<any | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setSubscribed(snap.data()?.subscriptionStatus === "active");
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const subjSnap = await getDocs(query(collection(db, "subjects"), orderBy("order", "asc")));
      setSubjects(subjSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const lessonsSnap = await getDocs(collection(db, "lessons"));
      setAllLessons(lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const progressSnap = await getDocs(
        query(collection(db, "lessonProgress"), where("uid", "==", user.uid))
      );
      setCompletedIds(new Set(progressSnap.docs.map((d) => d.data().lessonId)));
    })();
  }, [user]);

  async function openSubject(subject: any) {
    setActiveSubject(subject);
    const lessonsSnap = await getDocs(
      query(collection(db, "lessons"), where("subjectId", "==", subject.id), orderBy("order", "asc"))
    );
    setLessons(lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
    setCompletedIds((prev) => new Set(prev).add(lessonId));
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

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  if (activeSubject) {
    return (
      <div className="pb-16">
        <PageBackground color="#FAE9E9" />
        <button onClick={() => setActiveSubject(null)} className="text-sm text-ink/50 mb-4">
          ← Subjects
        </button>
        <SubscriptionBanner />
        <h1 className="font-display text-2xl font-semibold mb-2">{activeSubject.name}</h1>
        {lessons.length > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-ink/50 mb-1">
              <span>{lessons.filter((l) => completedIds.has(l.id)).length} of {lessons.length} complete</span>
              <span>{Math.round((lessons.filter((l) => completedIds.has(l.id)).length / lessons.length) * 100)}%</span>
            </div>
            <div className="h-2 rounded-full bg-ink/10 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((lessons.filter((l) => completedIds.has(l.id)).length / lessons.length) * 100)}%`,
                  background: "#E85D5D",
                }}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col items-center gap-5">
          {lessons.map((lesson, i) => {
            const done = completedIds.has(lesson.id);
            const prevDone = i === 0 || completedIds.has(lessons[i - 1].id);
            const locked = !done && !prevDone;
            return (
              <div key={lesson.id} className="w-full max-w-sm">
                <div
                  className="flex items-center gap-3"
                  onClick={() => !locked && playLesson(lesson.id)}
                  style={{ cursor: locked ? "default" : "pointer" }}
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-lg"
                    style={{
                      background: done ? "#E85D5D" : "transparent",
                      color: done ? "white" : locked ? "#B4B2A9" : "#E85D5D",
                      border: done ? "none" : "2px solid #E85D5D",
                    }}
                  >
                    {done ? "✓" : locked ? "🔒" : "▶"}
                  </div>
                  <div className="flex-1">
                    <p className={locked ? "text-ink/40" : "text-ink"}>
                      {lesson.pinned && <span className="mr-1">📌</span>}
                      {lesson.title}
                    </p>
                    <p className="text-xs text-ink/40">{lesson.viewCount ?? 0} views</p>
                  </div>
                  {!locked && !done && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markComplete(lesson.id);
                      }}
                      className="text-xs text-ink/50 underline"
                    >
                      Mark done
                    </button>
                  )}
                </div>
                {playingId === lesson.id && lesson.bunnyVideoId && (
                  <iframe
                    src={`https://iframe.mediadelivery.net/embed/${lesson.bunnyLibraryId}/${lesson.bunnyVideoId}`}
                    className="w-full aspect-video bg-ink rounded-xl mt-3"
                    style={{ border: "none" }}
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                    allowFullScreen
                  />
                )}
              </div>
            );
          })}
          {lessons.length === 0 && (
            <p className="text-ink/50 text-sm">No lessons added yet for this subject.</p>
          )}
        </div>
      </div>
    );
  }

  const pinnedLessons = allLessons.filter((l) => l.pinned);

  return (
    <div className="pb-16">
      <PageBackground color="#FAE9E9" />
      {pinnedLessons.length > 0 && !searchQuery.trim() && (
        <div className="mb-5">
          <p className="text-sm font-medium mb-2">📌 Pinned lessons</p>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {pinnedLessons.map((l) => (
              <button
                key={l.id}
                onClick={() => openSubjectById(l.subjectId)}
                className="flex-shrink-0 w-40 rounded-xl border border-ink/10 bg-white text-left p-3"
              >
                <span className="text-xl">{SUBJECT_ICONS[l.subjectId] ?? "⭐"}</span>
                <p className="text-sm font-medium mt-1.5 line-clamp-2">{l.title}</p>
                <p className="text-xs text-ink/40 mt-0.5">{subjectNameById[l.subjectId] ?? "Lesson"}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-sm text-ink/50 mb-3">Pick a subject</p>
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search lessons — try “music”, “art”, “finance”…"
        className="input mb-4"
      />
      {searchQuery.trim() ? (
        (() => {
          const q = searchQuery.trim().toLowerCase();
          const matches = allLessons.filter(
            (l) => l.title?.toLowerCase().includes(q) || subjectNameById[l.subjectId]?.toLowerCase().includes(q)
          );
          return matches.length === 0 ? (
            <p className="text-ink/50 text-sm py-8 text-center">No lessons match “{searchQuery}”.</p>
          ) : (
            <div className="space-y-2">
              {matches.map((l) => (
                <button
                  key={l.id}
                  onClick={() => openSubjectById(l.subjectId)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-ink/10 bg-white text-left hover:bg-ink/5"
                >
                  <span className="text-xl">{SUBJECT_ICONS[l.subjectId] ?? "⭐"}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.title}</p>
                    <p className="text-xs text-ink/40">{subjectNameById[l.subjectId] ?? "Lesson"}</p>
                  </div>
                </button>
              ))}
            </div>
          );
        })()
      ) : subjects === null ? (
        <SubjectsSkeleton />
      ) : (
      <div className="flex gap-4 flex-wrap">
        {subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => openSubject(s)}
            className="w-24 h-24 rounded-full flex flex-col items-center justify-center gap-1 text-white"
            style={{ background: "#E85D5D" }}
          >
            <span className="text-2xl">{SUBJECT_ICONS[s.id] ?? "⭐"}</span>
            <span className="text-xs">{s.name}</span>
          </button>
        ))}
        <button className="w-24 h-24 rounded-full flex items-center justify-center border-2 border-dashed border-line/30 text-ink/40">
          +
        </button>
      </div>
      )}
    </div>
  );
}
