"use client";

import { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PostCard from "@/components/PostCard";
import ShareComposer from "@/components/ShareComposer";
import PageBackground from "@/components/PageBackground";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import TrailersSection from "@/components/TrailersSection";
import SuggestionsRow from "@/components/SuggestionsRow";
import HallOfFameGrid from "@/components/HallOfFameGrid";
import { FeedSkeleton } from "@/components/Skeleton";

const getFeed = httpsCallable(functions, "getFeed");

export default function HomePage() {
  const { user, loading: authLoading } = useRequireAuth();
  // "Home" (the feed) vs "Hall of Fame" (the featured gallery) — a sub-tab within Home rather
  // than its own top-level tab, replacing the old separate Prizes tab.
  const [view, setView] = useState<"feed" | "hallOfFame">("feed");
  const [posts, setPosts] = useState<any[] | null>(null);
  const [scope, setScope] = useState<"everyone" | "following">("everyone");
  const [searchQuery, setSearchQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (!user) return;
    setPosts(null);
    setCursor(null);
    setHasMore(true);
    // Fetched via a Cloud Function rather than a direct Firestore query: Firestore security
    // rules can't filter a list query, so a broad "all posts" read has to be done server-side
    // (with the Admin SDK) to correctly hide other people's private posts.
    // "Following" filters this same feed client-side, so it asks for a wider page up front
    // (still capped server-side) rather than the small page "Everyone" pages through — otherwise
    // it'd usually come back empty since most of a small first page won't be people you follow.
    const result = await getFeed(scope === "following" ? { pageSize: 100 } : {});
    const data = result.data as any;
    let all: any[] = data.posts;

    if (scope === "following") {
      const followsSnap = await getDocs(
        query(collection(db, "follows"), where("followerId", "==", user.uid))
      );
      const followingIds = new Set(followsSnap.docs.map((d) => d.data().followingId));
      followingIds.add(user.uid);
      all = all.filter((p) => followingIds.has(p.ownerId));
    }
    setPosts(all);
    setCursor(data.nextCursor);
    setHasMore(data.hasMore);
  }

  async function loadMore() {
    if (!user || loadingMore || !hasMore || !cursor) return;
    setLoadingMore(true);
    try {
      const result = await getFeed(scope === "following" ? { cursor, pageSize: 100 } : { cursor });
      const data = result.data as any;
      let more: any[] = data.posts;
      if (scope === "following") {
        const followsSnap = await getDocs(
          query(collection(db, "follows"), where("followerId", "==", user.uid))
        );
        const followingIds = new Set(followsSnap.docs.map((d) => d.data().followingId));
        followingIds.add(user.uid);
        more = more.filter((p) => followingIds.has(p.ownerId));
      }
      setPosts((prev) => (prev ? [...prev, ...more] : more));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (user) load();
  }, [user, scope]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, hasMore, loadingMore, cursor, scope, user]);

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  const q = searchQuery.trim().toLowerCase();
  const visiblePosts = !q
    ? posts
    : (posts ?? []).filter((p) =>
        [p.ownerName, p.body, p.title, p.linkTitle, p.linkDomain].some((field) =>
          field?.toLowerCase().includes(q)
        )
      );

  return (
    <div className="pb-16">
      <PageBackground color="#F7F1E5" />
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setView("feed")}
          className={view === "feed" ? "btn-primary text-xs px-3 py-1.5" : "btn-secondary text-xs px-3 py-1.5"}
        >
          Home
        </button>
        <button
          onClick={() => setView("hallOfFame")}
          className={view === "hallOfFame" ? "btn-primary text-xs px-3 py-1.5" : "btn-secondary text-xs px-3 py-1.5"}
        >
          🏛️ Hall of Fame
        </button>
      </div>
      {view === "hallOfFame" ? (
        <HallOfFameGrid />
      ) : (
        <>
      <SubscriptionBanner />
      <TrailersSection />
      <ShareComposer onPosted={load} />
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search posts by person, text, or link…"
        className="input mb-3"
      />
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setScope("everyone")}
          className={scope === "everyone" ? "btn-primary text-xs px-3 py-1.5" : "btn-secondary text-xs px-3 py-1.5"}
        >
          Everyone
        </button>
        <button
          onClick={() => setScope("following")}
          className={scope === "following" ? "btn-primary text-xs px-3 py-1.5" : "btn-secondary text-xs px-3 py-1.5"}
        >
          Following
        </button>
      </div>
      {scope === "everyone" && <SuggestionsRow currentUserId={user.uid} />}
      {posts === null ? (
        <FeedSkeleton />
      ) : visiblePosts && visiblePosts.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="font-display text-xl font-semibold mb-2">
            {q ? "No matches" : "Nothing here yet"}
          </h2>
          <p className="text-ink/60">
            {q
              ? `No posts match "${searchQuery}".`
              : scope === "following"
              ? "Follow some people to see their posts here."
              : "Be the first to share something."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(visiblePosts ?? []).map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user.uid}
              onDeleted={(id) => setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))}
            />
          ))}
          {!q && hasMore && (
            <div ref={sentinelRef} className="py-6 text-center text-xs text-ink/40">
              {loadingMore ? "Loading more…" : ""}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
