"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Trailer = {
  id: string;
  title: string;
  subjectTag: "music" | "art" | "finance";
  bunnyVideoId: string;
  bunnyLibraryId: string;
};

const SUBJECT_STYLE: Record<string, { border: string; tagBg: string; tagText: string; label: string }> = {
  music: { border: "border-music", tagBg: "bg-musicLight", tagText: "text-music", label: "Music" },
  art: { border: "border-art", tagBg: "bg-artLight", tagText: "text-art", label: "Art" },
  finance: { border: "border-finance", tagBg: "bg-financeLight", tagText: "text-finance", label: "Finance" },
};

export default function TrailersSection({ compact = false }: { compact?: boolean }) {
  const [trailers, setTrailers] = useState<Trailer[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "trailers"), orderBy("createdAt", "desc")));
      setTrailers(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Trailer[]);
    })();
  }, []);

  if (trailers === null || trailers.length === 0) return null;

  return (
    <div className={compact ? "mt-3" : "mb-6"}>
      {!compact && <p className="text-sm font-medium mb-2">Watch a trailer</p>}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {trailers.map((t) => {
          const style = SUBJECT_STYLE[t.subjectTag] ?? SUBJECT_STYLE.music;
          const isPlaying = playingId === t.id;
          return (
            <div
              key={t.id}
              className={`flex-shrink-0 w-48 rounded-xl overflow-hidden bg-white border-t-4 ${style.border} shadow-sm`}
            >
              {isPlaying ? (
                <iframe
                  src={`https://iframe.mediadelivery.net/embed/${t.bunnyLibraryId}/${t.bunnyVideoId}?autoplay=true`}
                  className="w-full aspect-video bg-ink"
                  style={{ border: "none" }}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                  allowFullScreen
                />
              ) : (
                <button
                  onClick={() => setPlayingId(t.id)}
                  className="w-full aspect-video bg-ink flex items-center justify-center"
                >
                  <span className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center text-ink">▶</span>
                </button>
              )}
              <div className="p-2.5">
                <span className={`inline-block rounded-full ${style.tagBg} ${style.tagText} text-[10px] font-medium px-2 py-0.5 mb-1`}>
                  {style.label}
                </span>
                <p className="text-xs font-medium leading-snug line-clamp-2">{t.title}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
