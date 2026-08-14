"use client";

// Catches a render/runtime error anywhere under a normal page (not the root layout itself — see
// global-error.tsx for that) and shows something recoverable instead of Next.js's raw default
// error screen, which reads as "the site is broken" rather than "something went wrong, try
// again" — an important difference right as real paying customers start showing up.
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-sm mx-auto py-24 text-center px-4">
      <p className="text-4xl mb-4">⚠️</p>
      <h1 className="font-display text-xl font-semibold mb-2">Something went wrong</h1>
      <p className="text-sm text-ink/60 mb-6">
        That's on us, not you. Give it another try — if it keeps happening, reach out from the Support page.
      </p>
      <button onClick={() => reset()} className="btn-primary">
        Try again
      </button>
    </div>
  );
}
