"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import PageBackground from "@/components/PageBackground";

export default function ChatThreadPage() {
  const params = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !user) return;

    await addDoc(collection(db, "conversations", params.conversationId, "messages"), {
      senderId: user.uid,
      senderName: user.displayName ?? "Member",
      text: body,
      createdAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "conversations", params.conversationId),
      { lastMessage: body, lastMessageAt: serverTimestamp() },
      { merge: true }
    );

    setBody("");
  }

  return (
    <div className="pb-24">
      <PageBackground color="#FAF6EF" />
      <div className="space-y-3 mb-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
              m.senderId === user?.uid ? "ml-auto bg-ink text-white" : "bg-white border border-line/15"
            }`}
          >
            {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 fixed bottom-16 left-0 right-0 max-w-3xl mx-auto px-4">
        <input
          className="input flex-1"
          placeholder="Message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="submit" className="btn-primary">
          Send
        </button>
      </form>
    </div>
  );
}
