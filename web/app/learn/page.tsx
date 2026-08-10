"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collection, getDocs, query, where, orderBy, doc, updateDoc, increment, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import { SubjectsSkeleton } from "@/components/Skeleton";

const completeLessonFn = httpsCallable(functions, "completeLesson");
const getLessonPlaybackFn = httpsCallable(functions, "getLessonPlayback");

const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

const SUBJECT_CARDS: {
  id: string;
  name: string;
  tagline: string;
  thumbnail?: string;
  size: number;
  comingSoon?: boolean;
}[] = [
  { id: "music", name: "Music", tagline: "Create a song from scratch", thumbnail: "/music-preview.jpg", size: 208 },
  { id: "art", name: "Art", tagline: "Create a self portrait", thumbnail: "/art-preview.jpg", size: 144 },
  { id: "finance", name: "Finance", tagline: "Create a portfolio of stocks", size: 144, comingSoon: true },
];

function tierFor(pct: number): { emoji: string; label: string } | null {
  if (pct >= 100) return { emoji: "🏆", label: "Mastered" };
  if (pct >= 50) return { emoji: "🥈", label: "Halfway there" };
  if (pct >= 25) return { emoji: "🥉", label: "Getting started" };
  return null;
}

// useSearchParams() requires a Suspense boundary during static prerendering (Next.js App
// Router) — without this wrapper, `next build` fails on Firebase App Hosting/Vercel with
// "useSearchParams() should be wrapped in a suspense boundary."
export default function LearnPage() {
  return (
    <Suspense fallback={null}>
      <LearnPageContent />
    </Suspense>
  );
}

function LearnPageContent() {
  const { user, loading: authLoading } = useRequireAuth();
  const searchParams = useSearchParams();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [allLessons, setAllLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSubject, setActiveSubject] = useState<any | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, { bunnyVideoId: string; bunnyLibraryId: string } | null>>({});
  const [playbackLoading, setPlaybackLoading] = useState<string | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [justMastered, setJustMastered] = useState<string | null>(null);

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

  useEffect(() => {
    const wantedSubjectId = searchParams.get("subject");
    if (wantedSubjectId && subjects && !activeSubject) {
      openSubjectById(wantedSubjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, searchParams]);

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
    const result = await completeLessonFn({ lessonId });
    setCompletedIds((prev) => new Set(prev).add(lessonId));
    const mastered = (result.data as any)?.masteredSubject;
    if (mastered && activeSubject) {
      setJustMastered(activeSubject.name);
      setTimeout(() => setJustMastered(null), 5000);
    }
  }

  async function playLesson(lessonId: string) {
    if (!subscribed) return;
    const opening = playingId !== lessonId;
    setPlayingId((prev) => (prev === lessonId ? null : lessonId));

    // The actual video credentials aren't in the lesson doc anymore (see functions/index.js —
    // moving them out of the publicly-readable lessons collection is what makes this
    // subscription check actually mean something, instead of the paywall being purely
    // cosmetic). Fetch them from the gated callable each time a lesson is opened.
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
        {justMastered && (
          <div className="mb-4 rounded-xl p-3 text-sm font-medium text-white text-center" style={{ background: "#E85D5D" }}>
            🏆 You&apos;ve mastered {justMastered}! +50 bonus xp
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-display text-2xl font-semibold">{activeSubject.name}</h1>
          {lessons.length > 0 && (
            <span className="text-xs text-ink/40 flex-shrink-0">{lessons.length} lesson{lessons.length === 1 ? "" : "s"}</span>
          )}
        </div>
        {lessons.length > 0 && (() => {
          const done = lessons.filter((l) => completedIds.has(l.id)).length;
          const pct = Math.round((done / lessons.length) * 100);
          const tier = tierFor(pct);
          return (
            <div className="mb-6">
              <div className="flex justify-between text-xs text-ink/50 mb-1">
                <span>{done} of {lessons.length} complete</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-ink/10 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: "#E85D5D" }}
                />
              </div>
              {tier && (
                <p className="text-xs text-ink/50 mt-1.5">
                  {tier.emoji} {tier.label}
                </p>
              )}
            </div>
          );
        })()}
        {/* Course path: each lesson is a stop on a vertical timeline. The connector between two
            stops turns yellow once the stop above it is done — so the yellow line's length IS
            your progress through the course, not just a decorative divider. The single "current"
            stop (first not-done lesson) gets a glowing ring so it's obvious where to pick up. */}
        <div className="flex flex-col items-center">
          {lessons.map((lesson, i) => {
            const done = completedIds.has(lesson.id);
            const prevDone = i === 0 || completedIds.has(lessons[i - 1].id);
            const locked = !done && !prevDone;
            const isCurrent = !done && !locked;
            return (
              <div key={lesson.id} className="w-full max-w-sm">
                {i > 0 && (
                  <div className="flex justify-start" style={{ paddingLeft: "20px" }}>
                    <div
                      className="w-1 rounded-full transition-colors duration-500"
                      style={{
                        height: 22,
                        background: completedIds.has(lessons[i - 1].id) ? "#EFC13B" : "rgba(23,19,15,0.12)",
                      }}
                    />
                  </div>
                )}
                <div
                  className="flex items-center gap-3"
                  onClick={() => !locked && playLesson(lesson.id)}
                  style={{ cursor: locked ? "default" : "pointer" }}
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-lg flex-shrink-0"
                    style={{
                      background: done ? "#E85D5D" : isCurrent ? "#EFC13B" : "transparent",
                      color: done || isCurrent ? "white" : locked ? "#B4B2A9" : "#E85D5D",
                      border: done || isCurrent ? "none" : "2px solid #E85D5D",
                      boxShadow: isCurrent ? "0 0 0 5px rgba(239,193,59,0.25)" : "none",
                      animation: isCurrent ? "astryks-pulse 2s ease-in-out infinite" : "none",
                    }}
                  >
                    {done ? "✓" : locked ? "🔒" : "▶"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className={locked ? "text-ink/40" : "text-ink"}>
                        {lesson.pinned && <span className="mr-1">📌</span>}
                        {lesson.title}
                      </p>
                      {isCurrent && (
                        <span
                          className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5"
                          style={{ background: "#FFF6F1", color: "#C94A4A" }}
                        >
                          Up next
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink/40">
                      Lesson {i + 1} · {lesson.viewCount ?? 0} views
                    </p>
                  </div>
                  {!locked && !done && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markComplete(lesson.id);
                      }}
                      className="text-xs text-ink/50 underline flex-shrink-0"
                    >
                      Mark done <span className="text-ink/30">+10xp</span>
                    </button>
                  )}
                </div>
                {playingId === lesson.id && playbackLoading === lesson.id && (
                  <p className="text-sm text-ink/50 mt-3">Loading video…</p>
                )}
                {playingId === lesson.id && playback[lesson.id]?.bunnyVideoId && (
                  <iframe
                    src={`https://iframe.mediadelivery.net/embed/${playback[lesson.id]!.bunnyLibraryId}/${playback[lesson.id]!.bunnyVideoId}`}
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

  const subjectTier: Record<string, { emoji: string; label: string } | null> = {};
  for (const s of subjects ?? []) {
    const subjectLessons = allLessons.filter((l) => l.subjectId === s.id);
    if (subjectLessons.length === 0) continue;
    const done = subjectLessons.filter((l) => completedIds.has(l.id)).length;
    subjectTier[s.id] = tierFor(Math.round((done / subjectLessons.length) * 100));
  }

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
      <div className="flex flex-col items-center gap-8">
        {SUBJECT_CARDS.map((card) => {
          const subject = subjects.find((s) => s.id === card.id);
          if (card.comingSoon || !subject) {
            return (
              <div key={card.id} className="flex flex-col items-center gap-3 opacity-50">
                <div
                  className="rounded-full flex items-center justify-center bg-ink/10 border-2 border-dashed border-ink/20"
                  style={{ width: card.size, height: card.size }}
                >
                  <span className="text-3xl">{SUBJECT_ICONS[card.id] ?? "⭐"}</span>
                </div>
                <div className="text-center">
                  <p className="font-display font-semibold">{card.name}</p>
                  <p className="text-sm text-ink/50">{card.tagline}</p>
                  <p className="text-xs text-ink/40 mt-0.5">Coming soon</p>
                </div>
              </div>
            );
          }
          return (
            <button key={card.id} onClick={() => openSubject(subject)} className="flex flex-col items-center gap-3">
              <div className="rounded-full overflow-hidden relative shadow-md" style={{ width: card.size, height: card.size }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.thumbnail} alt="" className="w-full h-full object-cover" />
                {subjectTier[card.id] && (
                  <span
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white flex items-center justify-center text-sm shadow"
                    title={subjectTier[card.id]!.label}
                  >
                    {subjectTier[card.id]!.emoji}
                  </span>
                )}
              </div>
              <div className="text-center">
                <p className="font-display font-semibold text-lg">{card.name}</p>
                <p className="text-sm text-ink/50">{card.tagline}</p>
              </div>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
