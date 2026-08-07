"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const SUBJECT_DETAILS = [
  {
    icon: "🎵",
    name: "Music",
    color: "border-music",
    tagBg: "bg-musicLight",
    tagText: "text-music",
    tag: "Electronic production",
    items: ["Create a song from scratch on Apple's GarageBand", "Learn the basics of singing", "Create a song from scratch"],
  },
  {
    icon: "🎨",
    name: "Art",
    color: "border-art",
    tagBg: "bg-artLight",
    tagText: "text-art",
    tag: "Portrait drawing",
    items: ["Draw a portrait from scratch", "Sketch in watercolour", "Draw from life in charcoal"],
  },
  {
    icon: "📈",
    name: "Finance",
    color: "border-finance",
    tagBg: "bg-financeLight",
    tagText: "text-finance",
    tag: "Investing & valuation",
    soon: true,
    items: ["Learn to value businesses", "Learn how investing in the share market works", "Build a starter portfolio"],
  },
];

const STEPS = [
  { n: "01", title: "Sign up", blurb: "Create your account in under a minute — no waitlist." },
  { n: "02", title: "Unlock videos", blurb: "New expert-led videos unlock every week — watch anytime, on any device." },
  { n: "03", title: "Keep learning", blurb: "Your full back-catalogue stays unlocked — revisit any lesson, any time." },
];

const PRICING_FEATURES = [
  "Unlock videos created by practicing professionals",
  "Access to all 3 subjects — Music, Art & Finance",
  "Full back-catalogue once unlocked",
  "Works on any phone, tablet or computer",
  "Earn $50 for every friend you refer",
  "Cancel anytime, no questions asked",
];

const FAQS = [
  { q: "Who are the experts teaching on Astryks?", a: "Professional practitioners in their field — people who do this for a living, not just talk about it." },
  { q: "How do the locked videos work?", a: "New lessons unlock weekly. Once a lesson unlocks for you, it's yours to rewatch any time — even if you cancel later." },
  { q: "Can I post what I make?", a: "Yes — post your own work and get feedback from other people learning alongside you." },
  { q: "Can I cancel anytime?", a: "Yes — cancel any time from your account settings, no questions asked." },
  { q: "How does the $50 referral reward work?", a: "Share your code — your friend gets 20% off for their first 3 months, and once they've stayed subscribed that long, you earn $50. No limit on referrals." },
  { q: "What devices does Astryks work on?", a: "Any modern smartphone, tablet, laptop, or desktop — just a browser, or the app." },
];

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.push("/home");
    }
  }, [user, loading, router]);

  return (
    <div className="pb-16 -mx-4">
      {/* Hero */}
      <div className="px-4 py-14 text-center">
        <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight mb-5 leading-[1.1]">
          Learn real life skills from{" "}
          <span className="bg-highlight px-1.5 box-decoration-clone">experts in their field</span>
        </h1>
        <p className="text-ink/60 max-w-md mx-auto mb-8">
          Music. Art. Finance. Unlock a new masterclass video every week and
          build skills that last a lifetime.
        </p>
        <div className="flex items-center justify-center gap-3 mb-3">
          <Link href="/signup" className="btn-primary">
            Get started →
          </Link>
          <a href="#preview" className="btn-secondary">
            Watch free preview
          </a>
        </div>
        <p className="text-ink/40 text-xs">
          $5/week · new lessons every week · cancel anytime
        </p>
      </div>

      {/* Free preview */}
      <div id="preview" className="bg-sectionRose px-4 md:px-10 py-12 text-left">
        <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Free preview</p>
        <h2 className="font-display text-3xl font-bold mb-6">See how Astryks works</h2>
        <div className="max-w-sm">
          <Link href="/signup" className="block rounded-2xl overflow-hidden bg-white shadow-sm border-t-4 border-highlight">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/art-preview.jpg"
                alt="Painting a self portrait in oil on canvas"
                className="w-full aspect-[4/3] object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-ink text-xl">▶</span>
              </div>
              <span className={`absolute left-3 top-3 rounded-full ${SUBJECT_DETAILS[1].tagBg} ${SUBJECT_DETAILS[1].tagText} text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1`}>
                Art · Free preview
              </span>
            </div>
            <div className="p-4">
              <p className="font-display font-bold text-lg mb-1">Draw a self portrait with oil on canvas</p>
              <p className="text-sm text-ink/60">
                Learn how to draw a self portrait in pencil, oil on canvas, and hidden
                surprises in charcoal from a Sydney based artist.
              </p>
            </div>
          </Link>
          <Link href="/signup" className="btn-primary mt-4 inline-flex">
            Start learning for $5/week
          </Link>
        </div>
      </div>

      {/* Trailers */}
      <div className="bg-sectionSky px-4 md:px-10 py-12 text-left">
        <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Trailer videos</p>
        <h2 className="font-display text-3xl font-bold mb-2">See it before you subscribe</h2>
        <p className="text-ink/60 text-sm mb-6 max-w-md">
          Short previews from each subject so you know exactly what you&apos;re signing up for.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/signup" className="rounded-2xl overflow-hidden bg-white shadow-sm block">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/music-preview.jpg" alt="Music masterclass preview" className="w-full aspect-square object-cover" />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <span className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-ink">▶</span>
              </div>
              <span className={`absolute left-2 top-2 rounded-full ${SUBJECT_DETAILS[0].tagBg} ${SUBJECT_DETAILS[0].tagText} text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5`}>
                Music
              </span>
            </div>
            <p className="text-xs font-medium px-3 py-2.5 leading-snug">
              Create an original song from scratch for free on GarageBand
            </p>
          </Link>
          <Link href="/signup" className="rounded-2xl overflow-hidden bg-white shadow-sm block">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art-preview.jpg" alt="Art masterclass preview" className="w-full aspect-square object-cover" />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <span className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-ink">▶</span>
              </div>
              <span className={`absolute left-2 top-2 rounded-full ${SUBJECT_DETAILS[1].tagBg} ${SUBJECT_DETAILS[1].tagText} text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5`}>
                Art
              </span>
            </div>
            <p className="text-xs font-medium px-3 py-2.5 leading-snug">
              Drawing a portrait with oil on canvas — from scratch
            </p>
          </Link>
        </div>
      </div>

      {/* Subjects */}
      <div id="subjects" className="px-4 md:px-10 py-12 text-left">
        <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">What you&apos;ll learn</p>
        <h2 className="font-display text-3xl font-bold mb-2">3 subjects. Build real world skills.</h2>
        <p className="text-ink/60 text-sm mb-6 max-w-md">
          Each subject is taught by real experts who do it professionally — not just talk about it.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {SUBJECT_DETAILS.map((s) => (
            <div key={s.name} className={`rounded-2xl bg-white shadow-sm border-t-4 ${s.color} p-5`}>
              <span className="text-2xl mb-3 block">{s.icon}</span>
              <p className="font-display font-bold mb-3">
                {s.name}
                {s.soon && <span className="text-ink/40 font-body font-normal text-sm"> (coming soon)</span>}
              </p>
              <ul className="space-y-1.5 mb-4">
                {s.items.map((item) => (
                  <li key={item} className="text-sm text-ink/60 flex items-start gap-2">
                    <span className="text-ink/30">→</span> {item}
                  </li>
                ))}
              </ul>
              <span className={`inline-block rounded-full ${s.tagBg} ${s.tagText} text-xs font-medium px-3 py-1`}>
                {s.tag}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="px-4 md:px-10 py-12 text-left">
        <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">How it works</p>
        <h2 className="font-display text-3xl font-bold mb-2">Simple as 1, 2, 3</h2>
        <p className="text-ink/60 text-sm mb-8 max-w-md">
          Get started in minutes. A new lesson unlocked every week.
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="font-display text-4xl font-black text-ink/15 block mb-2">{step.n}</span>
              <p className="font-display font-bold mb-1">{step.title}</p>
              <p className="text-sm text-ink/60">{step.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div className="bg-sectionLavender px-4 md:px-10 py-14 text-left">
        <h2 className="font-display text-3xl font-bold mb-6">One simple plan</h2>
        <div
          className="max-w-sm rounded-2xl bg-white shadow-sm p-6"
          style={{ borderTop: "4px solid transparent", borderImage: "linear-gradient(90deg,#E85D5D,#EFC13B,#8B7FE8,#3FC1B0) 1" }}
        >
          <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-2">Weekly subscription</p>
          <p className="font-display text-4xl font-black mb-5">
            $5 <span className="text-base font-normal text-ink/50 font-body">per week</span>
          </p>
          <ul className="space-y-2.5 mb-6">
            {PRICING_FEATURES.map((f) => (
              <li key={f} className="text-sm text-ink/70 flex items-start gap-2">
                <span className="text-finance">✓</span> {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="btn-primary w-full">
            Get started
          </Link>
        </div>
      </div>

      {/* Referral */}
      <div className="bg-sectionMint px-4 md:px-10 py-14 text-left">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Referral program</p>
            <p className="font-display text-5xl font-black mb-2">$50</p>
            <p className="font-display text-2xl font-bold mb-3 leading-snug">
              Earn $50 for every friend you refer
            </p>
            <p className="text-sm text-ink/60">
              Once your friend subscribes and stays for 3 months, $50 lands in your
              account. No cap — refer as many people as you like.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { n: "1", t: "Get your link", d: "Find your unique referral link in your dashboard." },
              { n: "2", t: "Share it", d: "Send it to anyone who wants to learn real skills." },
              { n: "3", t: "They subscribe", d: "Your friend signs up and starts learning." },
              { n: "4", t: "You earn $50", d: "After their 3rd month, $50 is yours. No limit on referrals." },
            ].map((step) => (
              <div key={step.n} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-ink text-white text-xs flex items-center justify-center flex-shrink-0 font-medium">
                  {step.n}
                </span>
                <div>
                  <p className="font-semibold text-sm mb-0.5">{step.t}</p>
                  <p className="text-sm text-ink/60">{step.d}</p>
                </div>
              </div>
            ))}
            <Link href="/signup" className="btn-primary mt-2 inline-flex">
              Get my referral link
            </Link>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="px-4 md:px-10 py-12 text-left">
        <h2 className="font-display text-3xl font-bold mb-6">Common questions</h2>
        <div className="rounded-2xl bg-white shadow-sm divide-y divide-ink/10 overflow-hidden">
          {FAQS.map((f, i) => (
            <div key={f.q}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full text-left px-5 py-4 font-display font-bold flex items-center justify-between gap-4"
              >
                {f.q}
                <span className="text-ink/40 text-xl flex-shrink-0">{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && <p className="px-5 pb-4 text-sm text-ink/60">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 md:px-10 text-center text-xs text-ink/40 pt-6 border-t border-ink/10">
        <p className="mb-1">© 2026 Astryks. All rights reserved.</p>
        <p>Privacy · Terms · Contact</p>
      </div>
    </div>
  );
}
