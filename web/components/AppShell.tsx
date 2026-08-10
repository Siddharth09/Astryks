"use client";

import { useAuth } from "@/contexts/AuthContext";

// Reserves room for SideNav's fixed 224px-wide left rail, and keeps the logged-in app's
// single-column feed at a comfortable reading width. SideNav (and BottomNav) only ever render
// once someone's signed in — so without this check, a logged-out visitor got the 224px gutter
// AND the 768px cap with nothing to justify either, squeezing the whole public marketing page
// into a narrow, off-center column on any wide desktop screen. Logged-out visitors now get the
// full width to work with; page.tsx handles its own section widths for the marketing layout.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const isApp = !loading && !!user;

  if (!isApp) {
    return <main>{children}</main>;
  }

  return (
    <main className="md:pl-56">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">{children}</div>
    </main>
  );
}
