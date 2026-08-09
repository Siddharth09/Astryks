"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";
import { flagEmoji } from "@/lib/geo";

const getPrizeLeaderboardFn = httpsCallable(functions, "getPrizeLeaderboard");
const getLatestPrizeWinnerFn = httpsCallable(functions, "getLatestPrizeWinner");

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [leaderboard, setLeaderboard] = useState<any[] | null>(null);
  const [winner, setWinner] = useState<any | null | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    getPrizeLeaderboardFn().then((res) => setLeaderboard((res.data as any).leaderboard));
    getLatestPrizeWinnerFn().then((res) => setWinner((res.data as any).winner));
  }, [user]);

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  const daysLeft = daysLeftInMonth();

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24 px-4">
      <PageBackground color="#FAF6EF" />
      <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-2">Creative prize</p>
      <h1 className="font-display text-3xl font-bold mb-2">AU$1,000 a month</h1>
      <p className="text-sm text-ink/60 mb-1">
        Free to enter for every Astryks member — no subscription needed. One winner is picked each
        month, across every subject — music, art, or any other creative project. Whoever's post has
        the most likes at the end of this calendar month wins, no minimum likes required.
      </p>
      <p className="text-sm font-medium text-brand mb-6">
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month
      </p>

      {winner && (
        <div className="card p-4 mb-6 bg-brandLight/60 border-brand/20">
          <p className="text-xs font-semibold tracking-wide uppercase text-brand mb-1">
            🏆 {winner.monthLabel} winner
          </p>
          <div className="flex items-center gap-3">
            {winner.mediaUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={winner.mediaUrl} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium truncate">
                {winner.ownerName} {flagEmoji(winner.countryCode)}
              </p>
              <p className="text-xs text-ink/50">{winner.likeCount} likes{winner.title ? ` · "${winner.title}"` : ""}</p>
            </div>
            {winner.postId && (
              <Link href={`/post/${winner.postId}`} className="ml-auto text-xs underline text-ink/60 hover:text-ink flex-shrink-0">
                View
              </Link>
            )}
          </div>
        </div>
      )}
      {winner === null && (
        <div className="card p-4 mb-6 text-sm text-ink/50">
          No winner announced yet — check back after the end of the month.
        </div>
      )}

      <h2 className="font-display text-lg font-semibold mb-3">This month's leaderboard</h2>
      {leaderboard === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : leaderboard.length === 0 ? (
        <p className="text-ink/50 text-sm">No creative posts yet this month — be the first!</p>
      ) : (
        <div className="space-y-2">
          {(() => {
            const maxLikes = Math.max(1, leaderboard[0]?.likeCount ?? 1);
            return leaderboard.map((entry, i) => {
              const pct = Math.min(100, Math.round((entry.likeCount / maxLikes) * 100));
              return (
                <Link
                  key={entry.postId}
                  href={`/post/${entry.postId}`}
                  className="card p-3 flex items-center gap-3 hover:bg-ink/5 transition-colors"
                >
                  <span className="w-6 text-center font-display font-bold text-ink/40 flex-shrink-0">{i + 1}</span>
                  {entry.mediaUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.mediaUrl} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {entry.ownerName} {flagEmoji(entry.countryCode)}
                    </p>
                    <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden mt-1.5">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-ink/50 flex-shrink-0">
                    {entry.likeCount} likes
                  </span>
                </Link>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
