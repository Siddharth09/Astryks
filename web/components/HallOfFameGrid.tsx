"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const getHallOfFameFn = httpsCallable(functions, "getHallOfFame");

type HallOfFameEntry = {
  id: string;
  ownerId: string;
  ownerName: string;
  type: string;
  mediaUrl: string | null;
  bunnyVideoId: string | null;
  bunnyLibraryId: string | null;
  title: string | null;
  likeCount: number;
  hallOfFameSource: "manual" | "monthly-top";
  hallOfFameMonth: string | null;
};

export default function HallOfFameGrid() {
  const [entries, setEntries] = useState<HallOfFameEntry[] | null>(null);

  useEffect(() => {
    getHallOfFameFn()
      .then((res) => setEntries((res.data as any).entries))
      .catch((err) => {
        console.error("Couldn't load the Hall of Fame", err);
        setEntries([]);
      });
  }, []);

  return (
    <div>
      <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-1">Hall of Fame</p>
      <p className="text-sm text-ink/60 mb-4">
        The community's best work — some posts our team picked to spotlight, plus each month's 5
        most-liked posts, added automatically.
      </p>

      {entries === null ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-ink/50 text-sm">Nothing featured yet — check back soon.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/post/${entry.id}`}
              className="relative aspect-square rounded-lg overflow-hidden bg-ink block"
            >
              {entry.type === "video" && entry.bunnyVideoId ? (
                <iframe
                  src={`https://iframe.mediadelivery.net/embed/${entry.bunnyLibraryId}/${entry.bunnyVideoId}?autoplay=false`}
                  className="w-full h-full pointer-events-none"
                  style={{ border: "none" }}
                />
              ) : entry.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.mediaUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-2xl">
                  {entry.type === "video" ? "▶" : "📷"}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-white text-xs font-medium truncate">{entry.ownerName}</p>
                <p className="text-white/70 text-[10px]">{entry.likeCount} likes</p>
              </div>
              {entry.hallOfFameSource === "manual" && (
                <span className="absolute top-1.5 right-1.5 text-sm" title="Team pick">🏛️</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
