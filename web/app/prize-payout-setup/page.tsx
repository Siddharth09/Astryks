"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Creative Prize payout-onboarding flow that used to live at this URL was retired along
// with the rest of the Creative Prize feature (replaced by the Hall of Fame — see /prizes and
// /prize-rules, redirected the same way). createPayoutOnboardingLink/getPayoutAccountStatus were
// renamed to _legacy_* and undeployed, so this page's own actions would just fail — redirect
// rather than leave a broken, cash-prize-referencing page live and indexable.
export default function PrizePayoutSetupRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/me");
  }, [router]);

  return <p className="text-ink/50 text-center py-16">Redirecting…</p>;
}
