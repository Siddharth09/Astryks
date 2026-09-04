"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { usePrivacyLock } from "@/contexts/PrivacyLockContext";
import PrivacyLockScreen from "@/components/PrivacyLockScreen";
import PageBackground from "@/components/PageBackground";
import { BOT_UIDS } from "@/lib/botUsers";


export default function ChatThreadPage() {
  const params = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const { locked: privacyLocked, loading: privacyLockLoading } = usePrivacyLock();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [otherName, setOtherName] = useState<string | null>(null);
  const [otherIsBot, setOtherIsBot] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDoc(doc(db, "conversations", params.conversationId))
      .then((snap) => {
        const data = snap.data();
        if (!data || !user) return;
        const otherIndex = (data.participants ?? []).findIndex((id: string) => id !== user.uid);
        setOtherName(data.participantNames?.[otherIndex] ?? "Member");
        setOtherIsBot(BOT_UIDS.includes(data.participants?.[otherIndex]));
      })
      .catch(() => {
        // Most likely a permission-denied (not a participant in this conversation) — leave the
        // header blank rather than an unhandled rejection; the message list below will fail the
        // same way and show its own empty state.
        setOtherName(null);
      });
  }, [params.conversationId, user]);

  useEffect(() => {
    const q = query(
      collection(db, "conversations", params.conversationId, "messages"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [params.conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!body.trim() || !user) return;
    const text = body;
    setBody("");

    try {
      await addDoc(collection(db, "conversations", params.conversationId, "messages"), {
        senderId: user.uid,
        senderName: user.displayName ?? "Member",
        text,
        createdAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "conversations", params.conversationId),
        { lastMessage: text, lastMessageAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err: any) {
      // Previously a failed write here (permission hiccup, network blip) cleared the input with
      // no error and no way to recover the typed message — it just silently vanished. Restoring
      // the text and surfacing the error means a send failure is retryable, not a data loss.
      setBody(text);
      alert(err.message ?? "Couldn't send that message — please try again.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage();
  }

  if (privacyLockLoading) {
    return <p className="text-ink/50 text-center py-16">Loading…</p>;
  }

  if (privacyLocked) {
    return <PrivacyLockScreen label="Messages" />;
  }

  return (
    <div className="pb-32">
      <PageBackground color="#FAF6EF" />
      {otherName && (
        <div className="flex items-center gap-2.5 mb-4">
          {otherIsBot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo-mark.png" alt="" className="w-9 h-9 rounded-full" />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium"
              style={{ background: "#E85D5D" }}
            >
              {otherName[0]}
            </div>
          )}
          <p className="text-sm font-semibold">{otherName}</p>
        </div>
      )}
      <div className="space-y-3 mb-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
              m.senderId === user?.uid ? "ml-auto bg-ink text-white" : "bg-white border border-line/15"
            }`}
          >
            {m.text}
            {/* Old prizeNomination/prizeWin messages (Creative Prize, retired) used to render
                interactive opt-out/payout forms right here. The prize is gone and the backend
                callables behind those forms are no longer deployed (see the RETIRED banner in
                functions/index.js), so any such message left in someone's history now just
                renders as a plain, non-interactive past message like any other. */}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 fixed bottom-16 left-0 right-0 max-w-3xl mx-auto px-4 py-3 bg-paper/95 backdrop-blur border-t border-line/10"
      >
        <textarea
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Message…"
          className="flex-1 resize-none rounded-3xl border border-line/20 bg-white px-4 py-3 text-sm outline-none focus:border-brand transition-colors max-h-32 overflow-y-auto"
        />
        <button
          type="submit"
          disabled={!body.trim()}
          aria-label="Send"
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
          style={{ background: "#E85D5D" }}
        >
          <span className="text-white text-base inline-block" style={{ transform: "rotate(-90deg)" }}>
            ▶
          </span>
        </button>
      </form>
    </div>
  );
}
