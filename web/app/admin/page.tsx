"use client";

import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { isAdmin } from "@/lib/admin";

const SECTIONS = [
  {
    href: "/admin/hall-of-fame",
    title: "Hall of Fame",
    description: "Feature a post manually, or see what's already featured (including this month's automatic top 5).",
  },
  {
    href: "/admin/refunds",
    title: "Refund requests",
    description: "Review refund requests and approve full, no-questions-asked refunds.",
  },
  {
    href: "/admin/reports",
    title: "Reports",
    description: "Pending content reports from members, plus the welcome-email preview tool.",
  },
  {
    href: "/admin/users",
    title: "Members",
    description: "Every signed-up account, and the tool to permanently delete one.",
  },
  {
    href: "/admin/media-migration",
    title: "Private post media migration",
    description: "One-time fix for older private posts whose media is still reachable at a public Storage URL.",
  },
  {
    href: "/learn/upload",
    title: "Upload a lesson",
    description: "Add a new pre-recorded lesson video.",
  },
  {
    href: "/admin/trailers",
    title: "Upload a trailer",
    description: "Add a new preview/trailer video shown on the home feed.",
  },
  {
    href: "/admin/errors",
    title: "Crash reports",
    description: "Unhandled errors reported from the web app and the iOS/Android app.",
  },
];

// This page (and the "Admin" link that points to it in SideNav) is only ever a convenience —
// the real security is server-side. Every one of these sections independently re-checks your
// email again on load, and every Cloud Function behind them independently checks it too (see
// ADMIN_EMAILS in functions/index.js), using the same Firebase Auth login as everything else
// on the site. There's no separate password or backdoor to protect — just your one account.
export default function AdminHubPage() {
  const { user, loading: authLoading } = useRequireAuth();

  if (authLoading || !user) return <p className="text-ink/50 text-center py-16">Loading…</p>;

  if (!isAdmin(user.email)) {
    return <p className="text-center py-16 text-ink/60">This page is for the Astryks team only.</p>;
  }

  return (
    <div className="max-w-2xl mx-auto py-8 pb-24">
      <h1 className="font-display text-2xl font-semibold mb-2">Admin</h1>
      <p className="text-sm text-ink/60 mb-6">Everything team-only, in one place.</p>

      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="card p-4 flex items-center justify-between hover:border-ink/20 transition-colors"
          >
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-ink/50 mt-0.5">{s.description}</p>
            </div>
            <span className="text-ink/30">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
