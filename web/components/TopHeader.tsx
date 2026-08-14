"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { IconMark } from "@/components/Icons";
import UserMenu from "@/components/UserMenu";

// The mobile-width top bar with the Astryks logo. On desktop, a logged-in visitor already gets
// the logo from SideNav's fixed left rail, so this header hides itself there (md:hidden) to
// avoid showing the wordmark twice. But SideNav never renders for a logged-out visitor (see
// SideNav.tsx's `if (!user) return null`) — so without this check, someone landing on the
// public marketing page on a desktop-width browser saw no logo anywhere on the page at all.
// Once we know someone isn't logged in, we always show this header, regardless of screen width.
export default function TopHeader() {
  const { user, loading } = useAuth();
  const hideOnDesktop = !loading && !!user;

  return (
    <header
      className={`${hideOnDesktop ? "md:hidden" : ""} border-b border-line/10 sticky top-0 z-10 bg-paper/90 backdrop-blur`}
    >
      <div className="max-w-5xl mx-auto flex items-center gap-2 px-4 md:px-10 py-3">
        {/* Previously this logo+wordmark wasn't a link at all — clicking it did nothing, which
            read as "the logo is supposed to take me home and it's broken." It now goes to the
            signed-in feed for a logged-in visitor, or the public marketing page otherwise. */}
        <Link href={user ? "/home" : "/"} className="flex items-center gap-2">
          <IconMark className="w-6 h-6 rounded-md flex-shrink-0" />
          <span className="font-display font-semibold">Astryks</span>
        </Link>
        {/* This header is the one thing rendered on every mobile page for a logged-in user
            (SideNav — which has its own account menu — only shows at md+ widths). Without this,
            mobile users had no way to log out except navigating to the Me tab first every time. */}
        <UserMenu />
      </div>
    </header>
  );
}
