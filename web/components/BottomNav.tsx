"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { IconHome, IconLearn, IconMessages, IconMe } from "@/components/Icons";

// The Hall of Fame lives as a sub-tab inside /home (see app/home/page.tsx) rather than its own
// top-level tab — it replaced the old Creative Prize leaderboard, which did have its own tab.
const tabs = [
  { href: "/home", label: "Home", Icon: IconHome },
  { href: "/learn", label: "Learn", Icon: IconLearn },
  { href: "/messages", label: "Messages", Icon: IconMessages },
  { href: "/me", label: "Me", Icon: IconMe },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  return (
    <nav
      style={{ borderTop: "0.5px solid #eee" }}
      className="md:hidden fixed bottom-0 left-0 right-0 bg-paper/95 backdrop-blur flex z-20"
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs"
            style={{ color: active ? "#E85D5D" : "#8A8A8D" }}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
