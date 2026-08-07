"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";

export default function MessagesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [conversations, setConversations] = useState<any[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setConversations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  return (
    <div className="pb-16">
      <PageBackground color="#FAF6EF" />
      <h1 className="font-display text-2xl font-semibold mb-6">Messages</h1>
      {conversations === null ? (
        <p className="text-ink/50 text-center py-16">Loading…</p>
      ) : conversations.length === 0 ? (
        <p className="text-ink/50 text-sm text-center py-16">
          No conversations yet. Tap someone's name on a post to message them.
        </p>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => {
            const otherName = c.participantNames?.find((n: string, i: number) => c.participants[i] !== user.uid) ?? "Member";
            return (
              <Link
                key={c.id}
                href={`/messages/${c.id}`}
                className="flex items-center gap-3 border border-line/15 rounded-xl p-3 bg-white"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0"
                  style={{ background: "#E85D5D" }}
                >
                  {otherName[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{otherName}</p>
                  <p className="text-xs text-ink/50 truncate">{c.lastMessage}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
