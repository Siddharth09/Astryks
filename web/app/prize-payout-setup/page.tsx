"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";

const createPayoutOnboardingLinkFn = httpsCallable(functions, "createPayoutOnboardingLink");
const getPayoutAccountStatusFn = httpsCallable(functions, "getPayoutAccountStatus");

// useSearchParams() requires a Suspense boundary during static prerendering (Next.js App
// Router) — same pattern as app/login/page.tsx.
export default function PrizePayoutSetupPage() {
  return (
    <Suspense fallback={null}>
      <PrizePayoutSetup />
    </Suspense>
  );
}

// Where Stripe sends someone back after the hosted onboarding form (see
// createPayoutOnboardingLink in functions/index.js). `status=done` means they completed the
// form; `status=refresh` means their onboarding link expired mid-way (these are short-lived)
// and they need a fresh one — Stripe sends people here rather than back into the form itself.
function PrizePayoutSetup() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useSearchParams();
  const status = params.get("status");
  const [checking, setChecking] = useState(true);
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getPayoutAccountStatusFn()
      .then((result) => setPayoutsEnabled((result.data as any).payoutsEnabled))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [user]);

  useEffect(() => {
    // `restart()` redirects away via `location.href` to Stripe's hosted onboarding form. Hitting
    // Back afterward restores this page from the browser's back-forward cache exactly as it was
    // frozen — `restarting` stuck true and the button stuck disabled — rather than reloading
    // fresh. `pageshow` with `event.persisted` fires specifically on that bfcache restore.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setRestarting(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function restart() {
    setRestarting(true);
    setError(null);
    try {
      const result = await createPayoutOnboardingLinkFn();
      window.location.href = (result.data as any).url;
    } catch (err: any) {
      setError(err.message ?? "Couldn't start that — try again from Messages.");
      setRestarting(false);
    }
  }

  if (authLoading || !user || checking) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  return (
    <div className="max-w-sm mx-auto py-16 text-center">
      {payoutsEnabled ? (
        <>
          <p className="text-4xl mb-4">✅</p>
          <h1 className="font-display text-xl font-semibold mb-2">You're all set</h1>
          <p className="text-sm text-ink/60 mb-6">
            Direct deposit is ready to go — if you win a Creative Prize, we can send it straight to your account,
            no extra steps needed.
          </p>
        </>
      ) : status === "refresh" ? (
        <>
          <p className="text-4xl mb-4">⏳</p>
          <h1 className="font-display text-xl font-semibold mb-2">That link expired</h1>
          <p className="text-sm text-ink/60 mb-6">
            These setup links only last a few minutes. No problem — just start again below.
          </p>
          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          <button onClick={restart} disabled={restarting} className="btn-primary disabled:opacity-50">
            {restarting ? "Starting…" : "Start again"}
          </button>
        </>
      ) : (
        <>
          <p className="text-4xl mb-4">👋</p>
          <h1 className="font-display text-xl font-semibold mb-2">Almost there</h1>
          <p className="text-sm text-ink/60 mb-6">
            It looks like the setup form wasn't fully finished yet. You can pick it back up anytime from Messages,
            or start fresh below.
          </p>
          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          <button onClick={restart} disabled={restarting} className="btn-primary disabled:opacity-50">
            {restarting ? "Starting…" : "Continue setup"}
          </button>
        </>
      )}
      <p className="mt-8">
        <Link href="/me" className="text-xs underline text-ink/50">
          Back to my profile
        </Link>
      </p>
    </div>
  );
}
