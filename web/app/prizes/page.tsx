"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Creative Prize leaderboard that used to live at this URL was replaced by the Hall of Fame
// (now a sub-tab inside /home, not its own route) — redirect rather than 404 so any old
// bookmarks/links still land somewhere useful. The leaderboard's own rendering code hasn't been
// deleted, just no longer imported anywhere — see the RETIRED banner in functions/index.js for
// the backend side of the same decision.
export default function PrizesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/home");
  }, [router]);

  return <p className="text-ink/50 text-center py-16">Redirecting…</p>;
}
