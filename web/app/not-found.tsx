import Link from "next/link";

// Next.js shows its own generic default screen for any URL that doesn't match a route unless a
// not-found.tsx exists — this replaces that with something that actually looks like the rest of
// the site, since a broken/mistyped link is the most common way a new visitor (or an App Store
// reviewer following a link from the listing) ever sees a 404 at all.
export default function NotFound() {
  return (
    <div className="max-w-sm mx-auto py-24 text-center px-4">
      <p className="text-4xl mb-4">🔍</p>
      <h1 className="font-display text-xl font-semibold mb-2">Page not found</h1>
      <p className="text-sm text-ink/60 mb-6">
        That page doesn't exist, or may have moved. Let's get you back on track.
      </p>
      <Link href="/" className="btn-primary inline-block">
        Back to Astryks
      </Link>
    </div>
  );
}
