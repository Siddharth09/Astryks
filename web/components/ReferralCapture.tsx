"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Mounted once in the root layout (see app/layout.tsx) so a shared referral link
// (astryks.com/?ref=CODE, or landing on any other page with that query param) is captured no
// matter which page it lands on — this component previously existed but was never actually
// rendered anywhere in the app, so a referral *link* never stored anything: the only way
// astryks_referral_code ever got set was by manually typing a code into ReferralCodeEntry. Since
// createCheckoutSession (see SubscriptionBanner.tsx / ReferralAndBilling.tsx) only ever reads
// that localStorage key, every link-based referral silently failed to earn its referrer credit.
//
// useSearchParams() requires a Suspense boundary during static prerendering (Next.js App
// Router) — without this wrapper, `next build` fails on Firebase App Hosting/Vercel with
// "useSearchParams() should be wrapped in a suspense boundary."
export default function ReferralCapture() {
  return (
    <Suspense fallback={null}>
      <ReferralCaptureInner />
    </Suspense>
  );
}

function ReferralCaptureInner() {
  const params = useSearchParams();
  useEffect(() => {
    const ref = params.get("ref");
    if (ref) localStorage.setItem("astryks_referral_code", ref);
  }, [params]);
  return null;
}
