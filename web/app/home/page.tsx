"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PostCard from "@/components/PostCard";
import ShareComposer from "@/components/ShareComposer";
import PageBackground from "@/components/PageBackground";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import TrailersSection from "@/components/TrailersSection";
import { FeedSkeleton } from "@/components/Skeleton";

export default function HomePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [posts, setPosts] = useState<any[] | null>(null);
  const [scope, setScope] = useState<"everyone" | "following">("everyone");
  const [searchQuery, setSearchQuery] = useState("");

  async function load() {
    if (!user) return;
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    let all: any[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (scope === "following") {
      const followsSnap = await getDocs(
        query(collection(db, "follows"), where("followerId", "==", user.uid))
      );
      const followingIds = new Set(followsSnap.docs.map((d) => d.data().followingId));
      followingIds.add(user.uid);
      all = all.filter((p) => followingIds.has(p.ownerId));
    }
    setPosts(all);
  }

  useEffect(() => {
    if (user) load();
  }, [user, scope]);

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
            <PostCard key={post.id} post={post} currentUserId={user.uid} />
          ))}
        </div>
      )}
    </div>
  );
}
