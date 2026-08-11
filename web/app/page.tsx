"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";

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

const PRICING_FEATURES = [
  "15 minutes of free preview first — no card required",
  "Videos created by practicing professionals",
  "Full access to Music & Art, with new subjects on the way",
  "New lessons added regularly, all included",
  "Works on any phone, tablet or computer",
  "Cancel anytime, no questions asked",
  "90-day money-back guarantee after that, no questions asked",
];

const FAQS = [
  { q: "Who are the experts teaching on Astryks?", a: "Professional practitioners in their field — people who do this for a living, not just talk about it." },
  { q: "Is Astryks meant for endless scrolling?", a: "Not at all — we'd rather you put your phone down and go make something. Just start! Take your time with each lesson, and try to finish one piece before starting the next: record one song from scratch even if you've never touched an instrument, or finish one drawing before jumping to another. Whether you share it or not doesn't matter — what matters is that you took the time to learn and create something that means something to you." },
  { q: "Do I need any experience to start?", a: "Absolutely not — remember there are no born experts. Everybody started somewhere. Astryks is designed for that first step when you have zero experience but are open to trying something new. Learn the basic techniques, and then look at existing work out there and try and recreate a song or a painting from a famous artist, or make your own, or do both! It's magical creating layers of paintings, like layers of music, just have fun with it!" },
  { q: "Can I post what I make?", a: "That's entirely up to you. Post it if you'd like feedback and to be part of the community, or keep it to yourself — either way is completely fine, and posting is never required." },
  { q: "Can I cancel anytime?", a: "Yes — cancel any time from your account settings, no questions asked." },
  { q: "Is there a free trial?", a: "There's a free preview instead — 15 minutes across any real lessons, no card required, so you can actually try Astryks before deciding. Once you do subscribe, you're also covered by our 90-day money-back guarantee." },
  { q: "What if it's not for me?", a: "You're covered by our 90-day money-back guarantee — request a full refund of everything you've paid any time within 90 days of subscribing, right from your account settings. No questions asked." },
  { q: "How does the monthly AU$1,000 prize work?", a: "Each calendar month we pick just one winner across every subject — music, art, or any other creative project — whoever's single post has the most likes that month, as long as it's reached at least 30 likes. We ask for that because we want our community to lift each other up and cheer on the creative work being shared here — no subscription required, just a free like from anyone. If nothing reaches 30 likes in a given month, no winner is picked that month. The prize is AU$1,000 (Australian dollars), funded from Astryks subscription revenue, and we're running it every month through our first six months (through February 2027). International transfers from Australia may be subject to market foreign exchange rates and other overseas transfer considerations." },
  { q: "Do I have to subscribe to post or enter the prize?", a: "No — creating an account, posting, liking, and entering the Creative Prize are all free. A subscription is only needed to unlock the pre-recorded lesson library." },
  { q: "Will there be new videos and subjects?", a: "Yes — we're regularly adding new videos to Music and Art, and in the coming months we're launching an entirely new subject: investing in the share market. More subjects are on the way after that too." },
  { q: "What devices does Astryks work on?", a: "Any modern smartphone, tablet, laptop, or desktop — just a browser, or the app." },
];

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  // Illustrative only — see lib/geo.ts. Starts at the USD default and updates once we can
  // read the browser's locale/timezone client-side, so there's no server/client mismatch.
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    if (!loading && user) {
      router.push("/home");
    }
  }, [user, loading, router]);

  useEffect(() => {
    setPricing(getLocalizedPricing(detectCountryCode()));
  }, []);

  // Defined here (not at module scope) since the middle step's price mention needs to reflect
  // the visitor's localized pricing, same as the rest of the page.
  const STEPS = [
    { n: "01", title: "Sign up", blurb: "Create your free account in under a minute." },
    { n: "02", title: "Dive in", blurb: `Post your work, browse what others are creating, and enter the monthly Creative Prize — it's all free. Want our expert-led masterclasses too? Get 15 minutes free preview, then ${pricing.display} — cancel anytime.` },
    { n: "03", title: "Just create", blurb: "Whether it's with our experts or on your own, just start — record one song from scratch, paint one piece. Take your time, and make something that means something to you." },
  ];

  return (
    <div className="pb-16">
      {/* Hero */}
      <div className="px-4 py-14 md:py-24 text-center">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-display text-3xl sm:text-5xl md:text-6xl font-black tracking-tight mb-5 leading-[1.15]">
            Learn real life skills
            <br />
            {/* A regular breakable space here let "from" get orphaned onto its own line, with
                the highlighted phrase pushed to a third line by itself — a hard line break plus
                a non-breaking space glue "from" to "experts in their field" as one guaranteed
                two-line layout: "Learn real life skills" / "from experts in their field".
                whitespace-nowrap on the span keeps the highlight itself on one line — letting it
                wrap mid-highlight produced a jagged, "cut"-looking box (each line's
                box-decoration-clone rectangle gets centered independently, so they don't line up
                edge to edge). The base text size is dropped a step (4xl -> 3xl) so the whole
                "from experts in their field" line still fits without overflowing on the
                narrowest phone screens. */}
            from{" "}
            <span className="bg-highlight px-1.5 py-0.5 box-decoration-clone whitespace-nowrap">
              experts in their field
            </span>
          </h1>
          <p className="text-ink/60 max-w-md mx-auto mb-8 md:text-lg">
            Music. Art. Finance. Learn from real working professionals and
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
            Free to join and post · 15 min free preview of lessons, then {pricing.display} · cancel anytime
          </p>
        </div>
      </div>

      {/* Free preview */}
      <div id="preview" className="bg-sectionRose px-4 md:px-10 py-12 md:py-20 text-left">
        <div className="max-w-5xl mx-auto md:grid md:grid-cols-2 md:gap-16 md:items-center">
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Free preview</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-2 md:mb-4">See how Astryks works</h2>
            <p className="text-ink/60 text-sm mb-6 max-w-sm hidden md:block">
              Sign up for free and share what you create, always free. If you'd like our
              expert-led classes too, get 15 minutes free preview, then {pricing.display} — cancel anytime.
            </p>
          </div>
          <div className="max-w-sm md:max-w-none">
            <Link href="/signup" className="block rounded-2xl overflow-hidden bg-white shadow-sm border-t-4 border-highlight max-w-sm mx-auto md:mx-0">
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
            <Link href="/signup" className="btn-primary mt-4 inline-flex max-w-sm mx-auto md:mx-0">
              Get free preview
            </Link>
          </div>
        </div>
      </div>

      {/* Trailers */}
      <div className="bg-sectionSky px-4 md:px-10 py-12 md:py-20 text-left">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Trailer videos</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-2">See it before you subscribe</h2>
          <p className="text-ink/60 text-sm mb-6 max-w-md">
            Short previews from each subject so you know exactly what you&apos;re signing up for.
          </p>
          <div className="grid grid-cols-2 gap-3 md:gap-6 max-w-2xl">
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
      </div>

      {/* Subjects */}
      <div id="subjects" className="px-4 md:px-10 py-12 md:py-20 text-left">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">What you&apos;ll learn</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-2">3 subjects. Build real world skills.</h2>
          <p className="text-ink/60 text-sm mb-6 max-w-md">
            Each subject is taught by real experts who do it professionally — not just talk about it.
          </p>
          <div className="grid gap-4 md:gap-6 sm:grid-cols-3">
            {SUBJECT_DETAILS.map((s) => (
              <div key={s.name} className={`rounded-2xl bg-white shadow-sm border-t-4 ${s.color} p-5 md:p-6`}>
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
          <div className="mt-5 rounded-2xl bg-white shadow-sm border-t-4 border-highlight p-5 max-w-2xl">
            <p className="text-sm text-ink/70">
              💛 We're just getting started — we'll keep adding to Music and Art, and we're bringing new
              subjects like investing in the share market, and others, in the coming months.
            </p>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="px-4 md:px-10 py-12 md:py-20 text-left">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">How it works</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-2">Simple as 1, 2, 3</h2>
          <p className="text-ink/60 text-sm mb-8 max-w-md">
            Get started in minutes, and keep building new skills over time.
          </p>
          <div className="grid gap-6 md:gap-10 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n}>
                <span className="font-display text-4xl font-black text-ink/15 block mb-2">{step.n}</span>
                <p className="font-display font-bold mb-1">{step.title}</p>
                <p className="text-sm text-ink/60">{step.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="bg-sectionLavender px-4 md:px-10 py-14 md:py-20 text-left">
        <div className="max-w-5xl mx-auto md:grid md:grid-cols-2 md:gap-16 md:items-center">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-2">Unlock the full lesson library</h2>
            <p className="text-sm text-ink/60 mb-6 max-w-sm md:max-w-sm">
              Signing up, posting, and entering the Creative Prize are always free. Try 15 minutes of
              real lessons free whenever you're ready — no card required.
            </p>
          </div>
          <div
            className="max-w-sm mx-auto md:mx-0 rounded-2xl bg-white shadow-sm p-6"
            style={{ borderTop: "4px solid transparent", borderImage: "linear-gradient(90deg,#E85D5D,#EFC13B,#8B7FE8,#3FC1B0) 1" }}
          >
            <span className="inline-block text-[11px] font-semibold text-brand bg-musicLight rounded-full px-2.5 py-1 mb-3">
              15 min free preview, then
            </span>
            <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-2">Weekly subscription</p>
            <p className="font-display text-4xl font-black mb-1">
              {pricing.symbol}{pricing.amount} <span className="text-base font-normal text-ink/50 font-body">per week</span>
            </p>
            <p className="text-xs text-ink/40 mb-5">
              or save with annual — {pricing.annualDisplay} (2 weeks free vs. paying weekly). Pick whichever plan when you subscribe from your account.
            </p>
            <ul className="space-y-2.5 mb-6">
              {PRICING_FEATURES.map((f) => (
                <li key={f} className="text-sm text-ink/70 flex items-start gap-2">
                  <span className="text-finance">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="btn-primary w-full">
              Get free preview
            </Link>
          </div>
        </div>
      </div>

      {/* Creative prize */}
      <div className="bg-sectionMint px-4 md:px-10 py-14 md:py-20 text-left">
        <div className="max-w-5xl mx-auto grid gap-8 sm:grid-cols-2 md:gap-16">
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase text-ink/50 mb-3">Creative prize</p>
            <p className="font-display text-5xl font-black mb-2">AU$1,000</p>
            <p className="font-display text-2xl font-bold mb-3 leading-snug">
              Every month, for the community's most-loved post
            </p>
            <p className="inline-block text-xs font-semibold text-brand bg-white/70 rounded-full px-3 py-1 mb-3">
              Running every month through our first 6 months
            </p>
            <p className="text-sm text-ink/60 mb-3">
              In a small attempt to incentivise the arts, we give away AU$1,000 in cash every month to
              whoever's post the community loves most. We want every creative student — subscriber or
              not — to be able to post, get discovered, and
              compete for real cash, so entering is completely free for anyone with an Astryks account. At
              the end of each calendar month, whoever's single creative post — across music, art, or any
              other creative project — has the most likes wins, as long as it's reached at least 30 likes.
              We ask for that because we want our community to lift each other up and cheer on the creative
              work being shared here — no subscription required, just a free like from anyone. If nothing
              reaches 30 likes in a given month, no winner is picked that month. We started Astryks because
              real creative work deserves real recognition, and we genuinely can't wait to see what you make.
            </p>
            <p className="text-xs text-ink/40">
              AU$1,000 (Australian dollars), funded from Astryks subscription revenue. International
              transfers from Australia may be subject to market foreign exchange rates and other
              overseas transfer considerations.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { n: "1", t: "Share your work", d: "Post whatever you're proud of — a song, a painting, a portfolio piece. Free account, no subscription needed." },
              { n: "2", t: "Get likes from the community", d: "The more people who love it, the better your chances." },
              { n: "3", t: "Reach 30 likes", d: "You're entered the moment you post — cross 30 likes and you're in the running to win." },
              { n: "4", t: "Win AU$1,000", d: "One winner, chosen across every subject, at the end of each calendar month." },
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
              Get started
            </Link>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="px-4 md:px-10 py-12 md:py-20 text-left">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">Common questions</h2>
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
      </div>

      {/* Footer */}
      <div className="px-4 md:px-10 text-center text-xs text-ink/40 pt-6 border-t border-ink/10 max-w-5xl mx-auto">
        <p className="mb-1">© 2026 Astryks. All rights reserved.</p>
        <p>
          <Link href="/privacy" className="hover:text-ink/70 hover:underline">Privacy</Link>
          {" · "}
          <Link href="/terms" className="hover:text-ink/70 hover:underline">Terms</Link>
          {" · "}
          <Link href="/prize-rules" className="hover:text-ink/70 hover:underline">Prize Rules</Link>
          {" · "}
          <Link href="/support" className="hover:text-ink/70 hover:underline">Support</Link>
        </p>
      </div>
    </div>
  );
}
