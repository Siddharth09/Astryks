import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Image, Platform } from "react-native";
import { Link, router } from "expo-router";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { styles, colors } from "@/lib/styles";
import BrandMark from "@/components/BrandMark";
import { detectCountryCode, getLocalizedPricing } from "@/lib/geo";

const SUBJECT_DETAILS = [
  {
    icon: "🎵",
    name: "Music",
    color: colors.music,
    tagBg: colors.musicLight,
    tagText: colors.music,
    tag: "Electronic production",
    items: ["Create a song from scratch on Apple's GarageBand", "Learn the basics of singing", "Create a song from scratch"],
  },
  {
    icon: "🎨",
    name: "Art",
    color: colors.art,
    tagBg: colors.artLight,
    tagText: colors.art,
    tag: "Portrait drawing",
    items: ["Draw a portrait from scratch", "Sketch in watercolour", "Draw from life in charcoal"],
  },
  {
    icon: "📈",
    name: "Finance",
    color: colors.finance,
    tagBg: colors.financeLight,
    tagText: colors.finance,
    tag: "Investing & valuation",
    soon: true,
    items: ["Learn to value businesses", "Learn how investing in the share market works", "Build a starter portfolio"],
  },
];

const STEPS = [
  { n: "01", title: "Sign up", blurb: "Create your account in under a minute — no waitlist." },
  { n: "02", title: "Start watching", blurb: "Every expert-led video is ready to watch the moment you subscribe — anytime, on any device." },
  { n: "03", title: "Keep learning", blurb: "Rewatch any lesson in your library whenever you like, and dive into new ones as they're added." },
];

const PRICING_FEATURES = [
  "Videos created by practicing professionals",
  "Full access to Music & Art, with new subjects on the way",
  "New lessons added regularly, all included",
  "Works on any phone, tablet or computer",
  "Cancel anytime, no questions asked",
];

const PRIZE_STEPS = [
  { n: "1", t: "Share your work", d: "Post whatever you're proud of — a song, a painting, a portfolio piece. Free account, no subscription needed." },
  { n: "2", t: "Get likes from the community", d: "The more people who love it, the better your chances." },
  { n: "3", t: "Reach 30 likes", d: "You're entered the moment you post — cross 30 likes and you're in the running to win." },
  { n: "4", t: "Win AU$1,000", d: "One winner, chosen across every subject, at the end of each calendar month." },
];

const FAQS = [
  { q: "Who are the experts teaching on Astryks?", a: "Professional practitioners in their field — people who do this for a living, not just talk about it." },
  { q: "Is Astryks meant for endless scrolling?", a: "Not at all — we'd rather you put your phone down and go make something. Just start! Take your time with each lesson, and try to finish one piece before starting the next: record one song from scratch even if you've never touched an instrument, or finish one drawing before jumping to another. Whether you share it or not doesn't matter — what matters is that you took the time to learn and create something that means something to you." },
  { q: "Do I need any experience to start?", a: "Absolutely not — remember there are no born experts. Everybody started somewhere. Astryks is designed for that first step when you have zero experience but are open to trying something new. Learn the basic techniques, and then look at existing work out there and try and recreate a song or a painting from a famous artist, or make your own, or do both! It's magical creating layers of paintings, like layers of music, just have fun with it!" },
  { q: "Can I post what I make?", a: "That's entirely up to you. Post it if you'd like feedback and to be part of the community, or keep it to yourself — either way is completely fine, and posting is never required." },
  { q: "Can I cancel anytime?", a: "Yes — cancel any time from your account settings, no questions asked." },
  { q: "How does the monthly AU$1,000 prize work?", a: "Each calendar month we pick just one winner across every subject — music, art, or any other creative project — whoever's single post has the most likes that month, as long as it's reached at least 30 likes. We ask for that because we want our community to lift each other up and cheer on the creative work being shared here — no subscription required, just a free like from anyone. If nothing reaches 30 likes in a given month, no winner is picked that month. The prize is AU$1,000 (Australian dollars), funded from Astryks subscription revenue, and we're running it every month through our first six months (through February 2027). International transfers from Australia may be subject to market foreign exchange rates and other overseas transfer considerations." },
  { q: "Do I have to subscribe to post or enter the prize?", a: "No — creating an account, posting, liking, and entering the Creative Prize are all free. A subscription is only needed to unlock the pre-recorded lesson library." },
  { q: "Will there be new videos and subjects?", a: "Yes — we're regularly adding new videos to Music and Art, and in the coming months we're launching an entirely new subject: investing in the share market. More subjects are on the way after that too." },
  { q: "What devices does Astryks work on?", a: "Any modern smartphone, tablet, laptop, or desktop — just a browser, or the app." },
];

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  // Illustrative only — see lib/geo.ts. The actual charge is determined by Stripe at checkout.
  const [pricing, setPricing] = useState(() => getLocalizedPricing(null));

  useEffect(() => {
    setPricing(getLocalizedPricing(detectCountryCode()));
  }, []);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/(tabs)/home");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    if (!email) {
      setError('Enter your email above first, then tap "Forgot password?" again.');
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: 20 }}>
          <BrandMark size={36} />
        </View>

        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.ink, textAlign: "center", lineHeight: 32, marginBottom: 10 }}>
          Learn real life skills from{" "}
          <Text style={{ backgroundColor: colors.highlight }}>experts in their field</Text>
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: 20 }}>
          Music. Art. Finance. Learn from real working professionals and build skills that last a lifetime.
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
          <View style={{ flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "white", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 }}>
            <View style={{ aspectRatio: 1 }}>
              <Image source={require("@/assets/music-preview.jpg")} style={{ width: "100%", height: "100%" }} />
              <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.1)", alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}>
                  <Text>▶</Text>
                </View>
              </View>
              <View style={{ position: "absolute", left: 8, top: 8, borderRadius: 999, backgroundColor: colors.musicLight, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, fontWeight: "700", color: colors.music, textTransform: "uppercase" }}>Music</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "500", padding: 8, lineHeight: 14 }}>
              Create an original song from scratch for free on GarageBand
            </Text>
          </View>
          <View style={{ flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "white", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 }}>
            <View style={{ aspectRatio: 1 }}>
              <Image source={require("@/assets/art-preview.jpg")} style={{ width: "100%", height: "100%" }} />
              <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.1)", alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}>
                  <Text>▶</Text>
                </View>
              </View>
              <View style={{ position: "absolute", left: 8, top: 8, borderRadius: 999, backgroundColor: colors.artLight, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, fontWeight: "700", color: colors.art, textTransform: "uppercase" }}>Art</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "500", padding: 8, lineHeight: 14 }}>
              Drawing a portrait with oil on canvas — from scratch
            </Text>
          </View>
        </View>

        <Text style={styles.title}>Welcome back</Text>

        <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {resetSent ? (
        <Text style={{ color: "#15803D", fontSize: 12, textAlign: "right", marginTop: -6, marginBottom: 8 }}>
          Check your inbox at {email} for a reset link.
        </Text>
      ) : (
        <TouchableOpacity onPress={handleForgotPassword} disabled={resetLoading} style={{ alignSelf: "flex-end", marginTop: -6, marginBottom: 8 }}>
          <Text style={{ color: colors.brand, fontSize: 12, fontWeight: "600" }}>
            {resetLoading ? "Sending…" : "Forgot password?"}
          </Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.buttonPrimary} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonPrimaryText}>{loading ? "Logging in…" : "Log in"}</Text>
      </TouchableOpacity>

      <Link href="/signup" style={styles.link}>
        Don&apos;t have an account? Sign up
      </Link>

      <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 32 }} />

      {/* Subjects */}
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        What you&apos;ll learn
      </Text>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>
        3 subjects. Build real world skills.
      </Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 18 }}>
        Each subject is taught by real experts who do it professionally — not just talk about it.
      </Text>
      {SUBJECT_DETAILS.map((s) => (
        <View
          key={s.name}
          style={{ backgroundColor: "white", borderRadius: 16, borderTopWidth: 4, borderTopColor: s.color, padding: 16, marginBottom: 12 }}
        >
          <Text style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</Text>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>
            {s.name}
            {s.soon && <Text style={{ color: colors.muted, fontWeight: "400", fontSize: 13 }}> (coming soon)</Text>}
          </Text>
          {s.items.map((item) => (
            <Text key={item} style={{ fontSize: 12, color: colors.muted, marginBottom: 4, lineHeight: 16 }}>
              → {item}
            </Text>
          ))}
          <View style={{ alignSelf: "flex-start", backgroundColor: s.tagBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: s.tagText }}>{s.tag}</Text>
          </View>
        </View>
      ))}
      <View style={{ backgroundColor: "white", borderRadius: 16, borderTopWidth: 4, borderTopColor: colors.highlight, padding: 16, marginBottom: 28 }}>
        <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>
          💛 We&apos;re just getting started — we&apos;ll keep adding to Music and Art, and we&apos;re bringing new
          subjects beyond these three in the coming months. Very soon, there&apos;ll be even more ways to learn and
          create on Astryks.
        </Text>
      </View>

      {/* How it works */}
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        How it works
      </Text>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>Simple as 1, 2, 3</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 18 }}>
        Get started in minutes, and keep building new skills over time.
      </Text>
      {STEPS.map((step) => (
        <View key={step.n} style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 28, fontWeight: "900", color: "rgba(23,19,15,0.15)", marginBottom: 2 }}>{step.n}</Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 2 }}>{step.title}</Text>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>{step.blurb}</Text>
        </View>
      ))}

      {/* Pricing */}
      <View style={{ backgroundColor: colors.sectionLavender, borderRadius: 20, padding: 20, marginBottom: 24, marginTop: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>Unlock the full lesson library</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 18 }}>
          Signing up, posting, and entering the Creative Prize are always free. Subscribe whenever you&apos;re
          ready to unlock every lesson.
        </Text>
        <View style={{ backgroundColor: "white", borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Weekly subscription
          </Text>
          <Text style={{ fontSize: 30, fontWeight: "900", color: colors.ink, marginBottom: 14 }}>
            {pricing.symbol}{pricing.amount} <Text style={{ fontSize: 13, fontWeight: "400", color: colors.muted }}>per week</Text>
          </Text>
          {PRICING_FEATURES.map((f) => (
            <View key={f} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <Text style={{ color: colors.finance }}>✓</Text>
              <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>{f}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={() => router.push("/signup")} style={[styles.buttonPrimary, { marginTop: 6 }]}>
            <Text style={styles.buttonPrimaryText}>Get started</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Creative prize */}
      <View style={{ backgroundColor: colors.sectionMint, borderRadius: 20, padding: 20, marginBottom: 24 }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          Creative prize
        </Text>
        <Text style={{ fontSize: 34, fontWeight: "900", color: colors.ink, marginBottom: 4 }}>AU$1,000</Text>
        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: 6, lineHeight: 22 }}>
          Every month, for the community&apos;s most-loved post
        </Text>
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brand, backgroundColor: "white", alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10, overflow: "hidden" }}>
          Running every month through our first 6 months
        </Text>
        <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19, marginBottom: 10 }}>
          We want every creative student — subscriber or not — to be able to post, get discovered, and
          compete for real cash, so entering is completely free for anyone with an Astryks account. At
          the end of each calendar month, whoever&apos;s single creative post — across music, art, or any
          other creative project — has the most likes wins, as long as it&apos;s reached at least 30 likes.
          We ask for that because we want our community to lift each other up and cheer on the creative
          work being shared here — no subscription required, just a free like from anyone. If nothing
          reaches 30 likes in a given month, no winner is picked that month. We started Astryks because
          real creative work deserves real recognition, and we genuinely can&apos;t wait to see what you make.
        </Text>
        <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 15, marginBottom: 16 }}>
          AU$1,000 (Australian dollars), funded from Astryks subscription revenue. International
          transfers from Australia may be subject to market foreign exchange rates and other overseas
          transfer considerations.
        </Text>
        {PRIZE_STEPS.map((step) => (
          <View key={step.n} style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{step.n}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 1 }}>{step.t}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 16 }}>{step.d}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* FAQ */}
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: 14 }}>Common questions</Text>
      <View style={{ backgroundColor: "white", borderRadius: 16, marginBottom: 24, overflow: "hidden" }}>
        {FAQS.map((f, i) => (
          <View key={f.q} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
            <TouchableOpacity
              onPress={() => setOpenFaq(openFaq === i ? null : i)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, gap: 12 }}
            >
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink }}>{f.q}</Text>
              <Text style={{ fontSize: 18, color: colors.muted }}>{openFaq === i ? "−" : "+"}</Text>
            </TouchableOpacity>
            {openFaq === i && (
              <Text style={{ paddingHorizontal: 16, paddingBottom: 16, fontSize: 13, color: colors.muted, lineHeight: 18 }}>
                {f.a}
              </Text>
            )}
          </View>
        ))}
      </View>

      <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginBottom: 8 }}>
        © 2026 Astryks. All rights reserved.
      </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
