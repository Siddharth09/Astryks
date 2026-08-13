"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import PageBackground from "@/components/PageBackground";

const getMessageSuggestions = httpsCallable(functions, "getMessageSuggestions");
const listPublicProfiles = httpsCallable(functions, "listPublicProfiles");
const SUBJECT_NAMES: Record<string, string> = { music: "Music", art: "Art", finance: "Finance" };
const SUBJECT_ICONS: Record<string, string> = { music: "🎵", art: "🎨", finance: "📈" };

export default function MessagesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<any[] | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [allUsers, setAllUsers] = useState<any[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);

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

  useEffect(() => {
    if (!user) return;
    getMessageSuggestions()
      .then((result) => setSuggestions((result.data as any).suggestions))
      .catch(() => setSuggestions([]));
  }, [user]);

  async function openSearch() {
    setShowSearch(true);
    if (allUsers === null && user) {
      // Was a direct `collection("users").limit(200)` query — before firestore.rules
      // restricted users/{uid} reads to each doc's own owner, that handed back everyone's
      // full profile document (stripeCustomerId/payoutOwed included) to search through. This
      // Cloud Function returns only displayName/photoURL for each person.
      const result = await listPublicProfiles({ limit: 200 });
      const profiles = (result.data as any).profiles as { uid: string; displayName: string | null; photoURL: string | null }[];
      setAllUsers(
        profiles.map((p) => ({ id: p.uid, displayName: p.displayName, photoURL: p.photoURL })).filter((u) => u.id !== user.uid)
      );
    }
  }

  async function startConversation(otherId: string, otherName: string) {
    if (!user || starting) return;
    setStarting(otherId);
    try {
      const conversationId = [user.uid, otherId].sort().join("_");
      const ref = doc(db, "conversations", conversationId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          participants: [user.uid, otherId].sort(),
          participantNames: [user.uid, otherId]
            .sort()
            .map((id) => (id === otherId ? otherName : user.displayName ?? "You")),
          lastMessage: "",
          lastMessageAt: new Date(),
        });
      }
      router.push(`/messages/${conversationId}`);
    } catch (err: any) {
      // Previously there was no catch here — a failure produced no error message and no
      // navigation, so the click just appeared to do nothing (the `finally` below did at least
      // prevent it from getting stuck disabled, but gave no explanation of what went wrong).
      alert(err.message ?? "Couldn't start that conversation — please try again.");
    } finally {
      setStarting(null);
    }
  }

  if (authLoading || !user) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  const q = searchQuery.trim().toLowerCase();
  const matches = !q ? allUsers ?? [] : (allUsers ?? []).filter((u) => u.displayName?.toLowerCase().includes(q));

  return (
    <div className="pb-16">
      <PageBackground color="#FAF6EF" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-semibold">Messages</h1>
        {showSearch ? (
          <button onClick={() => setShowSearch(false)} className="text-sm text-ink/50">
            Cancel
          </button>
        ) : (
          <button onClick={openSearch} className="btn-secondary text-xs px-3 py-1.5">
            + New message
          </button>
        )}
      </div>
      {!showSearch && suggestions !== null && suggestions.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium mb-2">✨ People you may want to message</p>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {suggestions.map((s) => {
              const topSubject = s.sharedSubjects?.[0];
              return (
                <button
                  key={s.id}
                  onClick={() => startConversation(s.id, s.displayName ?? "Member")}
                  disabled={starting === s.id}
                  className="flex-shrink-0 w-32 rounded-xl border border-ink/10 bg-white text-center p-3 flex flex-col items-center gap-2"
                >
                  {s.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoURL} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium"
                      style={{ background: "#E85D5D" }}
                    >
                      {(s.displayName ?? "M")[0]}
                    </div>
                  )}
                  <p className="text-xs font-medium line-clamp-1">{s.displayName ?? "Member"}</p>
                  <p className="text-[10px] text-ink/40 line-clamp-2">
                    {topSubject
                      ? `${SUBJECT_ICONS[topSubject] ?? "⭐"} Also learning ${SUBJECT_NAMES[topSubject] ?? topSubject}`
                      : "Suggested for you"}
                  </p>
                  {starting === s.id && <span className="text-[10px] text-ink/40">Opening…</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showSearch && (
        <div className="mb-6">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search people by name…"
            className="input mb-3"
          />
          {allUsers === null ? (
            <p className="text-ink/50 text-sm text-center py-6">Loading people…</p>
          ) : matches.length === 0 ? (
            <p className="text-ink/50 text-sm text-center py-6">No one matches “{searchQuery}”.</p>
          ) : (
            <div className="space-y-2">
              {matches.slice(0, 30).map((u) => (
                <button
                  key={u.id}
                  onClick={() => startConversation(u.id, u.displayName ?? "Member")}
                  disabled={starting === u.id}
                  className="w-full flex items-center gap-3 border border-line/15 rounded-xl p-3 bg-white text-left hover:bg-ink/5"
                >
                  {u.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.photoURL} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0"
                      style={{ background: "#E85D5D" }}
                    >
                      {(u.displayName ?? "M")[0]}
                    </div>
                  )}
                  <p className="text-sm font-medium">{u.displayName ?? "Member"}</p>
                  {starting === u.id && <span className="ml-auto text-xs text-ink/40">Opening…</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
