"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/admin";
import { IconMark, IconHome, IconLearn, IconMessages, IconMe, IconPrize } from "@/components/Icons";

const tabs = [
  { href: "/home", label: "Home", Icon: IconHome },
  { href: "/learn", label: "Learn", Icon: IconLearn },
  { href: "/prizes", label: "Prizes", Icon: IconPrize },
  { href: "/messages", label: "Messages", Icon: IconMessages },
  { href: "/me", label: "Me", Icon: IconMe },
];

export default function SideNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  return (
    <aside className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 w-56 border-r border-line/10 bg-paper/95 backdrop-blur px-4 py-6 z-20">
      <Link href="/home" className="flex items-center gap-2 mb-6 px-2">
        <IconMark className="w-7 h-7 rounded-md flex-shrink-0" />
        <span className="font-display font-semibold text-lg">Astryks</span>
      </Link>

      {/* Only ever rendered for the one admin account — see the note on lib/admin.ts. Sits at
          the very top, above the regular tabs, so it's the first thing you see. */}
      {isAdmin(user.email) && (
        <Link
          href="/admin"
          className={
            "flex items-center gap-3 px-3 py-2.5 mb-4 rounded-xl text-sm font-medium transition-colors border " +
            (pathname?.startsWith("/admin")
              ? "bg-brandLight text-brand border-brand/30"
              : "bg-highlight/10 text-ink border-highlight/40 hover:bg-highlight/20")
          }
        >
          ⚙️ Admin
        </Link>
      )}

      <nav className="flex flex-col gap-1">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors " +
                (active ? "bg-brandLight text-brand font-medium" : "text-ink/60 hover:bg-ink/5 hover:text-ink")
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
