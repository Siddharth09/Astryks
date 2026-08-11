"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";
import { IconMark } from "@/components/Icons";

// The mobile-width top bar with the Astryks logo. On desktop, a logged-in visitor already gets
// the logo from SideNav's fixed left rail, so this header hides itself there (md:hidden) to
// avoid showing the wordmark twice. But SideNav never renders for a logged-out visitor (see
// SideNav.tsx's `if (!user) return null`) — so without this check, someone landing on the
// public marketing page on a desktop-width browser saw no logo anywhere on the page at all.
// Once we know someone isn't logged in, we always show this header, regardless of screen width.
export default function TopHeader() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hideOnDesktop = !loading && !!user;

  async function handleLogout() {
    await signOut(auth);
    router.push("/");
  }

  return (
    <header
      className={`${hideOnDesktop ? "md:hidden" : ""} border-b border-line/10 sticky top-0 z-10 bg-paper/90 backdrop-blur`}
    >
      <div className="max-w-5xl mx-auto flex items-center gap-2 px-4 md:px-10 py-3">
        {/* The logo previously wasn't a link at all — tapping it did nothing. It should always
            take you back to the app's home: /home once signed in, the public landing page ("/")
            otherwise. */}
        <Link href={user ? "/home" : "/"} className="flex items-center gap-2">
          <IconMark className="w-6 h-6 rounded-md flex-shrink-0" />
          <span className="font-display font-semibold">Astryks</span>
        </Link>
        {/* This header renders on every mobile-width page (it's only ever hidden on desktop, and
            only once signed in — see hideOnDesktop above), so putting log out here means it's
            reachable from anywhere instead of only from the Me tab. */}
        {user && (
          <button onClick={handleLogout} className="ml-auto text-sm text-ink/40 hover:text-ink/70">
            Log out
          </button>
        )}
      </div>
    </header>
  );
}
