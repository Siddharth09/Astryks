"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const optInToPrizeFn = httpsCallable(functions, "optInToPrize");
const submitPrizeProcessNoteFn = httpsCallable(functions, "submitPrizeProcessNote");

const THRESHOLD = 30;

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export default function PrizeInfoModal({
  open,
  onClose,
  postId,
  likeCount = 0,
  eligible,
  optedOut,
  generic,
  isOwner,
  processNote,
  processVideoUrl,
  onOptedIn,
}: {
  open: boolean;
  onClose: () => void;
  // Required to actually call optInToPrize below — only missing when generic is true (shown
  // from the composer before a post exists yet), in which case optedOut is never true anyway.
  postId?: string;
  likeCount?: number;
  eligible?: boolean;
  optedOut?: boolean;
  // Pass true when there's no post yet (e.g. shown from the composer, before posting) —
  // skips the per-post progress bar/eligible/opted-out states in favour of a plain explainer.
  generic?: boolean;
  // Only the post's owner can add/edit its process note — everyone else who taps the trophy
  // just sees the explainer (the server would reject the write anyway, but there's no reason
  // to show a stranger a form for someone else's post).
  isOwner?: boolean;
  processNote?: string | null;
  processVideoUrl?: string | null;
  // Lets the parent (which holds the actual post data) clear its own optedOut flag once this
  // succeeds, since this modal doesn't own that state itself.
  onOptedIn?: () => void;
}) {
  const [optingIn, setOptingIn] = useState(false);
  const [noteDraft, setNoteDraft] = useState(processNote ?? "");
  const [videoDraft, setVideoDraft] = useState(processVideoUrl ?? "");
  const [savingProcess, setSavingProcess] = useState(false);
  const [processSaved, setProcessSaved] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNoteDraft(processNote ?? "");
      setVideoDraft(processVideoUrl ?? "");
      setProcessSaved(false);
      setProcessError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pct = Math.min(100, Math.round((likeCount / THRESHOLD) * 100));
  const daysLeft = daysLeftInMonth();

  async function handleOptIn() {
    if (!postId || optingIn) return;
    setOptingIn(true);
    try {
      await optInToPrizeFn({ postId });
      onOptedIn?.();
    } catch (err: any) {
      alert(err.message ?? "Couldn't opt back in — please try again.");
    } finally {
      setOptingIn(false);
    }
  }

  async function handleSaveProcess() {
    if (!postId || savingProcess) return;
    setSavingProcess(true);
    setProcessError(null);
    try {
      await submitPrizeProcessNoteFn({
        postId,
        note: noteDraft.trim() || null,
        videoUrl: videoDraft.trim() || null,
      });
      setProcessSaved(true);
    } catch (err: any) {
      setProcessError(err.message ?? "Couldn't save that — please try again.");
    } finally {
      setSavingProcess(false);
    }
  }

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
          In a small attempt to incentivise the arts, we give away AU$1,000 in cash every month to
          the community's most-loved creative post.
        </p>
        <p className="text-sm text-ink/70 mb-2 leading-relaxed">
          {generic
            ? "Share a photo or video and you could be in the running. "
            : "Every month, "}
          we award AU$1,000 (Australian dollars) in cash to whoever's single creative post —
          across music, art, or any other creative project — has the most likes that month. The
          only requirement is that a post needs at least {THRESHOLD} likes to qualify. We ask for
          that because we want our community to lift each other up — liking a post is free and
          takes a second, and it's how we get to cheer on the beautiful things people are making
          here. Just one winner is picked each month; if nothing reaches {THRESHOLD} likes in a
          given month, no winner is picked that month.
        </p>
        <p className="text-sm text-ink/70 mb-2 leading-relaxed">
          Before any cash goes out, a real person on the Astryks team takes a look at the winning
          post — just to make sure it's genuine creative work, not a repost or a meme that
          happened to farm likes. That's the only manual step in the whole process, and it's there
          to keep the prize meaningful for people actually making things.
        </p>
        <p className="text-xs text-ink/40 mb-4 leading-relaxed">
          International transfers from Australia may be subject to market foreign exchange rates and
          other overseas transfer considerations. We run this every month to keep encouraging our
          community to create something beautiful and to celebrate each other's work.
        </p>

        {generic ? null : optedOut ? (
          <div className="rounded-xl bg-ink/5 px-4 py-3 mb-4">
            <p className="text-sm font-medium">You've opted this post out</p>
            <p className="text-xs text-ink/60 mt-1 mb-3">
              It won't be entered into this month's draw.
            </p>
            <button
              onClick={handleOptIn}
              disabled={optingIn}
              className="bg-ink text-white text-xs font-semibold rounded-full px-4 py-2 disabled:opacity-60"
            >
              {optingIn ? "Opting back in…" : "Opt back in"}
            </button>
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

        {!generic && isOwner && !optedOut && (
          <div className="rounded-xl border border-line/15 p-3 mb-4">
            <p className="text-sm font-medium mb-1">Show your process</p>
            <p className="text-xs text-ink/60 mb-3 leading-relaxed">
              Totally optional, but it's the easiest way to show us the story behind what you
              made — a quick note, or a link to a timelapse/process video, is plenty. This is
              what our team looks at during that review step above.
            </p>
            <textarea
              value={noteDraft}
              onChange={(e) => {
                setNoteDraft(e.target.value);
                setProcessSaved(false);
              }}
              maxLength={600}
              rows={3}
              placeholder="e.g. Sketched thumbnails first, then blocked in color over a weekend…"
              className="input mb-2 text-sm resize-none"
            />
            <input
              value={videoDraft}
              onChange={(e) => {
                setVideoDraft(e.target.value);
                setProcessSaved(false);
              }}
              placeholder="Link to a process video (optional)"
              className="input mb-2 text-sm"
            />
            {processError && <p className="text-xs text-red-600 mb-2">{processError}</p>}
            <button
              onClick={handleSaveProcess}
              disabled={savingProcess}
              className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {savingProcess ? "Saving…" : processSaved ? "Saved ✓" : "Save"}
            </button>
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
