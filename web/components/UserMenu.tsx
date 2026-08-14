"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

// A single, obviously-clickable account menu — replaces the old plain-text "Log out" links that
// were easy to miss (low-contrast gray text, no button styling) with a proper avatar chip +
// dropdown, rendered from one place so TopHeader (mobile/logged-out-desktop) and SideNav
// (logged-in desktop) stay in sync instead of drifting into two different logout experiences.
export default function UserMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const label = user.displayName || user.email || "Member";
  const initial = label.trim().charAt(0).toUpperCase() || "A";

  async function handleLogOut() {
    setOpen(false);
    try {
      await signOut(auth);
    } catch {
      alert("Couldn't log out — please try again.");
    }
  }

  const avatar = (
    <span className="w-8 h-8 rounded-full bg-brand text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
      {initial}
    </span>
  );

  if (variant === "sidebar") {
    return (
      <div ref={rootRef} className="relative mt-auto">
        {open && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-line/10 bg-white shadow-lg overflow-hidden">
            <div className="px-3 py-2.5 border-b border-line/10">
              <p className="text-sm font-medium truncate">{label}</p>
              {user.email && <p className="text-xs text-ink/50 truncate">{user.email}</p>}
            </div>
            <Link
              href="/me"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-sm text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors"
            >
              View profile
            </Link>
            <button
              onClick={handleLogOut}
              className="w-full text-left px-3 py-2.5 text-sm text-brand hover:bg-brandLight transition-colors"
            >
              Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors text-left"
        >
          {avatar}
          <span className="flex-1 truncate">{label}</span>
          <span className={`text-ink/30 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5"
      >
        {avatar}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-line/10 bg-white shadow-lg overflow-hidden z-30">
          <div className="px-3 py-2.5 border-b border-line/10">
            <p className="text-sm font-medium truncate">{label}</p>
            {user.email && <p className="text-xs text-ink/50 truncate">{user.email}</p>}
          </div>
          <Link
            href="/me"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors"
          >
            View profile
          </Link>
          <button
            onClick={handleLogOut}
            className="w-full text-left px-3 py-2.5 text-sm text-brand hover:bg-brandLight transition-colors"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
