"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

const getOrCreateReferralCode = httpsCallable(functions, "getOrCreateReferralCode");
const createBillingPortalSession = httpsCallable(functions, "createBillingPortalSession");
const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");

const SUPPORT_UID = "astryks-support";
const SUPPORT_NAME = "Astryks Support";

export default function ReferralAndBilling() {
  const { user } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [payoutOwed, setPayoutOwed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    getOrCreateReferralCode().then((r) => setCode((r.data as { code: string }).code));
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      setStatus(snap.data()?.subscriptionStatus ?? "none");
      setPayoutOwed(snap.data()?.payoutOwed ?? 0);
    });
  }, [user]);

  async function copyLink() {
    if (!code) return;
    await navigator.clipboard.writeText(`${location.origin}/signup?ref=${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function messageSupport() {
    if (!user) return;
    const conversationId = [user.uid, SUPPORT_UID].sort().join("_");
    const ref = doc(db, "conversations", conversationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [user.uid, SUPPORT_UID].sort(),
        participantNames: [user.uid, SUPPORT_UID]
          .sort()
          .map((id) => (id === SUPPORT_UID ? SUPPORT_NAME : user.displayName ?? "You")),
        lastMessage: "",
        lastMessageAt: new Date(),
      });
    }
    router.push(`/messages/${conversationId}`);
  }

  async function manageSubscription() {
    setLoading(true);
    const result = await createBillingPortalSession({ returnUrl: `${location.origin}/me` });
    location.href = (result.data as { url: string }).url;
  }

  async function subscribe() {
    setLoading(true);
    const referralCode = localStorage.getItem("astryks_referral_code") || undefined;
    const result = await createCheckoutSession({
      referralCode,
      successUrl: `${location.origin}/me`,
      cancelUrl: `${location.origin}/me`,
    });
    location.href = (result.data as { url: string }).url;
  }

  return (
    <div className="space-y-3 mb-6">
      <div className="card p-4">
        <p className="text-sm font-medium mb-1">Refer a friend, earn $50</p>
        <p className="text-xs text-ink/60 mb-3">
          Share your code below. When a friend enters it at checkout, they get 20% off — just $4/week
          instead of $5 — for their first 3 months. After that, their price goes back to normal, no surprises.
          Once they've stayed subscribed for those 3 months, you earn $50 — we'll let you know. To claim it,{" "}
          <button onClick={messageSupport} className="link-accent">message us here</button>.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-ink/5 rounded-lg px-3 py-2 text-sm">{code ?? "…"}</code>
          <button onClick={copyLink} className="btn-secondary text-xs px-3 py-2">
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        {payoutOwed > 0 && (
          <p className="text-xs text-ink/60 mt-2">
            ${payoutOwed} owed to you —{" "}
            <button onClick={messageSupport} className="link-accent">message us here</button> and we&apos;ll send it your way.
          </p>
        )}
      </div>

      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Subscription</p>
          <p className="text-xs text-ink/60">
            {status === "active" ? "Active — $5/week" : status === "canceled" ? "Canceled" : "Not subscribed"}
          </p>
        </div>
        {status === "active" ? (
          <button onClick={manageSubscription} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            Manage
          </button>
        ) : (
          <button onClick={subscribe} disabled={loading} className="btn-primary text-xs px-3 py-2">
            Subscribe
          </button>
        )}
      </div>

      <details className="card p-4 text-xs text-ink/70">
        <summary className="text-sm font-medium text-ink cursor-pointer">How referrals work</summary>
        <div className="mt-3 space-y-2">
          <p><strong>Do I need to do anything to get my code?</strong><br />No — it's already generated above, ready to share.</p>
          <p><strong>What does my friend get?</strong><br />20% off — $4/week instead of $5 — for their first 3 months. After that, it's $5/week like everyone else.</p>
          <p><strong>Where do they enter my code?</strong><br />When they go to subscribe, there's a "Have a referral code?" link right there on the subscribe screen.</p>
          <p><strong>When do I get my $50?</strong><br />Once your friend has been subscribed for 3 months straight, we'll notify you here and you can <button onClick={messageSupport} className="link-accent">message us</button> to arrange payment.</p>
          <p><strong>Is there a limit?</strong><br />No — refer as many friends as you like.</p>
        </div>
      </details>
    </div>
  );
}
