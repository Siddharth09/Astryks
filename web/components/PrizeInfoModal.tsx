"use client";

import Link from "next/link";

const THRESHOLD = 50;

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizeInfoModal({
  open,
  onClose,
  likeCount = 0,
  eligible,
  optedOut,
  generic,
}: {
  open: boolean;
  onClose: () => void;
  likeCount?: number;
  eligible?: boolean;
  optedOut?: boolean;
  // Pass true when there's no post yet (e.g. shown from the composer, before posting) —
  // skips the per-post progress bar/eligible/opted-out states in favour of a plain explainer.
  generic?: boolean;
}) {
  if (!open) return null;

  const pct = Math.min(100, Math.round((likeCount / THRESHOLD) * 100));
  const daysLeft = daysLeftInMonth();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-2">Creative prize</p>
        <h3 className="font-display font-bold text-2xl mb-1">AU$1,000 a month</h3>
        {!optedOut && (
          <p className="text-xs font-medium text-brand mb-3">
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month
          </p>
        )}
        <p className="text-sm text-ink/70 mb-2 leading-relaxed">
          {generic
            ? "Share a photo or video and you could be in the running. "
            : "In an attempt to incentivise the arts, "}
          At the end of each calendar month we award AU$1,000 (Australian dollars) in cash to whoever's
          single creative post — across music, art, or any other creative project — has the most likes
          that month. Only one winner is picked each month, and the only condition is reaching at least{" "}
          {THRESHOLD} likes.
        </p>
        <p className="text-xs text-ink/40 mb-4 leading-relaxed">
          International transfers from Australia may be subject to market foreign exchange rates and
          other overseas transfer considerations. We run this every month to keep incentivising young
          creatives to create something beautiful.
        </p>

        {generic ? null : optedOut ? (
          <div className="rounded-xl bg-ink/5 px-4 py-3 mb-4">
            <p className="text-sm font-medium">You've opted this post out</p>
            <p className="text-xs text-ink/60 mt-1">
              It won't be entered into this month's draw. Message us if you change your mind.
            </p>
          </div>
        ) : eligible ? (
          <div className="rounded-xl bg-brandLight px-4 py-3 mb-4">
            <p className="text-sm font-medium text-brand">🎉 This post is entered!</p>
            <p className="text-xs text-ink/60 mt-1">
              It's crossed {THRESHOLD} likes, so it's in the running for this month's prize.
            </p>
          </div>
        ) : (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-ink/60 mb-1.5">
              <span>{likeCount} / {THRESHOLD} likes</span>
              <span>{Math.max(0, THRESHOLD - likeCount)} to go</span>
            </div>
            <div className="h-2 rounded-full bg-ink/10 overflow-hidden">
              <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <Link
          href="/prizes"
          onClick={onClose}
          className="block text-center text-xs underline text-ink/60 hover:text-ink mb-3"
        >
          See this month's leaderboard
        </Link>

        <button onClick={onClose} className="btn-primary w-full">
          Got it
        </button>
      </div>
    </div>
  );
}
