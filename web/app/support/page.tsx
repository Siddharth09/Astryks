"use client";

import Link from "next/link";

const FAQS = [
  {
    q: "How do I cancel my subscription?",
    a: "On the web, go to your profile and use \"Manage\" next to Subscription — that opens Stripe's billing portal where you can cancel anytime. On iOS/Android, subscriptions are managed through your Apple ID or Google Play account settings (not in the app itself), since purchases there go through the App Store/Play Store.",
  },
  {
    q: "How do I delete my account and data?",
    a: "Go to your profile (the Me tab) and tap \"Delete my account\" near the top. This permanently deletes your posts, saved items, lesson progress, and login — it can't be undone, so cancel any active subscription first if you don't want to keep being billed.",
  },
  {
    q: "How is my subscription price calculated?",
    a: "We show you an estimated price in your local currency based on your device's region settings before you subscribe. The price and currency you're actually billed is set at checkout by your billing country. See our Privacy Policy for details.",
  },
  {
    q: "How does the Creative Prize work?",
    a: "Every month, the eligible post with the most likes from the community wins a cash prize. You don't need to be a paying subscriber to enter — posting is free. See our Prize Rules for the full details.",
  },
  {
    q: "I found a bug, or content that shouldn't be on Astryks.",
    a: "Please report posts directly in the app where possible, or email us using the address below with as much detail as you can (screenshots, what you expected vs. what happened).",
  },
];

export default function SupportPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 pb-24 px-4 text-sm text-ink/80 leading-relaxed">
      <h1 className="font-display text-3xl font-bold mb-2">Support</h1>
      <p className="text-ink/60 mb-8">
        Questions, account issues, or something not working right? We're happy to help.
      </p>

      <div className="rounded-xl bg-ink/5 p-4 mb-8 text-sm">
        <p className="font-medium mb-1">Contact us</p>
        <p>
          Email{" "}
          <a href="mailto:support@astryks.com" className="link-accent">support@astryks.com</a>{" "}
          and we'll get back to you as soon as we can. You can also message Astryks Support directly
          from inside the app.
        </p>
      </div>

      <h2 className="font-display text-lg font-semibold mt-8 mb-4">Frequently asked questions</h2>
      <div className="space-y-5">
        {FAQS.map((f) => (
          <div key={f.q}>
            <p className="font-medium mb-1">{f.q}</p>
            <p className="text-ink/60">{f.a}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-xs text-ink/40">
        See also our <Link href="/terms" className="link-accent">Terms of Service</Link>,{" "}
        <Link href="/privacy" className="link-accent">Privacy Policy</Link>, and{" "}
        <Link href="/prize-rules" className="link-accent">Prize Rules</Link>.
      </p>
    </div>
  );
}
