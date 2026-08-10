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
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import PageBackground from "@/components/PageBackground";

const optOutOfPrizeFn = httpsCallable(functions, "optOutOfPrize");
const submitPrizePayoutDetailsFn = httpsCallable(functions, "submitPrizePayoutDetails");
const createPayoutOnboardingLinkFn = httpsCallable(functions, "createPayoutOnboardingLink");

export default function ChatThreadPage() {
  const params = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [optOutState, setOptOutState] = useState<Record<string, "loading" | "done">>({});
  const [payoutOpen, setPayoutOpen] = useState<Record<string, boolean>>({});
  const [payoutMethod, setPayoutMethod] = useState<Record<string, "bank" | "payid">>({});
  const [payoutDetails, setPayoutDetails] = useState<Record<string, string>>({});
  const [payoutState, setPayoutState] = useState<Record<string, "loading" | "done">>({});
  const [stripeSetupLoading, setStripeSetupLoading] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  // Redirects to Stripe's own hosted onboarding form — their bank details go straight to
  // Stripe, never through Astryks at all. Same "share payout details" moment as the manual
  // form below, just the faster/more secure option. Not tied to any specific post, so it works
  // the same whether this is a fresh nomination or an actual win.
  async function handleStripeSetup(messageId: string) {
    setStripeSetupLoading((prev) => ({ ...prev, [messageId]: true }));
    try {
      const result = await createPayoutOnboardingLinkFn();
      window.location.href = (result.data as any).url;
    } catch (err: any) {
      alert(err.message ?? "Couldn't start Stripe setup — try again, or use the manual option below.");
      setStripeSetupLoading((prev) => ({ ...prev, [messageId]: false }));
    }
  }

  async function handleOptOut(messageId: string, postId: string) {
    setOptOutState((prev) => ({ ...prev, [messageId]: "loading" }));
    try {
      await optOutOfPrizeFn({ postId });
      setOptOutState((prev) => ({ ...prev, [messageId]: "done" }));
    } catch (err: any) {
      setOptOutState((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      alert(err.message ?? "Couldn't opt out — try again.");
    }
  }

  async function handleSubmitPayout(messageId: string, postId: string) {
    const details = (payoutDetails[messageId] ?? "").trim();
    if (!details) return;
    const method = payoutMethod[messageId] ?? "bank";
    setPayoutState((prev) => ({ ...prev, [messageId]: "loading" }));
    try {
      await submitPrizePayoutDetailsFn({ postId, method, details });
      setPayoutState((prev) => ({ ...prev, [messageId]: "done" }));
    } catch (err: any) {
      setPayoutState((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      alert(err.message ?? "Couldn't save your payout details — try again.");
    }
  }

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
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage();
  }

  return (
    <div className="pb-32">
      <PageBackground color="#FAF6EF" />
      <div className="space-y-3 mb-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
              m.senderId === user?.uid ? "ml-auto bg-ink text-white" : "bg-white border border-line/15"
            }`}
          >
            {m.text}
            {(m.type === "prizeNomination" || m.type === "prizeWin") && m.senderId !== user?.uid && m.postId && (
              <div className="mt-2 pt-2 border-t border-line/15 space-y-2">
                {m.type === "prizeNomination" && (optOutState[m.id] === "done" || m.prizeOptOutHandled) ? (
                  <p className="text-xs text-ink/50">You've opted this post out.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {m.type === "prizeNomination" && (
                      <button
                        onClick={() => handleOptOut(m.id, m.postId)}
                        disabled={optOutState[m.id] === "loading"}
                        className="text-xs underline text-ink/70 hover:text-ink disabled:opacity-50"
                      >
                        {optOutState[m.id] === "loading" ? "Opting out…" : "Opt out of this nomination"}
                      </button>
                    )}
                    {payoutState[m.id] !== "done" && (
                      <button
                        onClick={() => setPayoutOpen((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                        className="text-xs underline text-ink/70 hover:text-ink"
                      >
                        {payoutOpen[m.id]
                          ? "Cancel"
                          : m.type === "prizeWin"
                          ? "Add payout details"
                          : "Share payout details"}
                      </button>
                    )}
                  </div>
                )}

                {payoutState[m.id] === "done" && (
                  <p className="text-xs text-ink/50">Payout details saved — thanks!</p>
                )}

                {payoutOpen[m.id] && payoutState[m.id] !== "done" && (
                  <div className="bg-paper/60 rounded-lg p-2.5 space-y-2">
                    <button
                      onClick={() => handleStripeSetup(m.id)}
                      disabled={stripeSetupLoading[m.id]}
                      className="w-full text-xs rounded-md bg-brand text-white font-medium px-2.5 py-1.5 disabled:opacity-50"
                    >
                      {stripeSetupLoading[m.id] ? "Starting…" : "Set up direct deposit (fastest, most secure)"}
                    </button>
                    <p className="text-[11px] text-ink/40 text-center">— or enter it manually —</p>
                    <select
                      value={payoutMethod[m.id] ?? "bank"}
                      onChange={(e) =>
                        setPayoutMethod((prev) => ({ ...prev, [m.id]: e.target.value as "bank" | "payid" }))
                      }
                      className="w-full text-xs rounded-md border border-line/20 bg-white px-2 py-1.5"
                    >
                      <option value="bank">Bank transfer</option>
                      <option value="payid">PayID</option>
                    </select>
                    <input
                      value={payoutDetails[m.id] ?? ""}
                      onChange={(e) => setPayoutDetails((prev) => ({ ...prev, [m.id]: e.target.value }))}
                      placeholder={
                        (payoutMethod[m.id] ?? "bank") === "bank"
                          ? "BSB, account number, account name"
                          : "PayID (phone, email, or ABN)"
                      }
                      className="w-full text-xs rounded-md border border-line/20 bg-white px-2 py-1.5"
                    />
                    <button
                      onClick={() => handleSubmitPayout(m.id, m.postId)}
                      disabled={payoutState[m.id] === "loading" || !(payoutDetails[m.id] ?? "").trim()}
                      className="text-xs rounded-md bg-ink text-white font-medium px-2.5 py-1.5 disabled:opacity-50"
                    >
                      {payoutState[m.id] === "loading" ? "Saving…" : "Save payout details"}
                    </button>
                  </div>
                )}
              </div>
            )}
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
