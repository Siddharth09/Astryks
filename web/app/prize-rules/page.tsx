"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Creative Prize's Official Rules used to live at this URL — retired along with the cash
// prize itself (see the RETIRED banner in functions/index.js). There's no equivalent legal page
// needed for the Hall of Fame (no cash, no lottery-law exposure), so this just redirects home
// rather than leaving a stale, since-retired sweepstakes-rules page publicly indexed.
export default function PrizeRulesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return <p className="text-ink/50 text-center py-16">Redirecting…</p>;
}
