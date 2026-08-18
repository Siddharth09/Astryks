"use client";

import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 pb-24 px-4 text-sm text-ink/80 leading-relaxed">
      <h1 className="font-display text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-xs text-ink/40 mb-8">Last updated: 18 August 2026 · Effective for Astryks (the "Service"), operated by the holder of Australian Business Number (ABN) 74 309 712 800, trading as Astryks ("Astryks", "we", "us").</p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">1. Acceptance of these Terms</h2>
      <p className="mb-4">
        By creating an account, subscribing, or otherwise using Astryks (the website, and the iOS/Android
        apps), you agree to these Terms of Service and our <Link href="/privacy" className="link-accent">Privacy Policy</Link>.
        If you don't agree, please don't use the Service.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">2. Eligibility</h2>
      <p className="mb-4">
        You must be at least 18 years old to create an account, subscribe, or post content on Astryks.
        By registering, you confirm you meet this requirement and that the information you provide is
        accurate.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">3. Your account</h2>
      <p className="mb-4">
        You're responsible for keeping your login credentials secure and for all activity under your
        account. Tell us right away at support@astryks.com if you suspect unauthorized access. We may
        suspend or terminate accounts that violate these Terms, are used fraudulently (including
        artificially inflating likes — see Section 9), or are inactive for an extended period.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">4. Subscriptions &amp; billing</h2>
      <p className="mb-4">
        Creating an account and posting to Astryks is always free — no subscription is required. Before
        subscribing, you can also preview a limited amount of the lesson library for free: currently 10
        minutes of real lesson video per subject, tracked on your account. This free preview is offered
        at our discretion, separate from any trial mechanism offered by Stripe, Apple, or Google, and we
        may change or discontinue it at any time without notice.
      </p>
      <p className="mb-4">
        Astryks is offered as a recurring weekly or annual subscription, at your choice. The price shown
        to you depends on your billing country/currency (see our{" "}
        <Link href="/privacy" className="link-accent">Privacy Policy</Link> for how we determine that).
        Your subscription renews automatically at the end of each billing period until you cancel — you
        can cancel any time from your account settings (or, on iOS/Android, through your device's app
        store subscription settings), and cancellation takes effect at the end of the current billing
        period, with no partial-period refund for canceling early. Prices may change with notice;
        continuing to use the Service after a price change takes effect means you accept the new price.
      </p>
      <p className="mb-4">
        <strong>Refunds:</strong> if you're not happy with Astryks, you can request a full refund of your
        current subscription within 90 days of your subscription's start date, no questions asked, by
        emailing support@astryks.com or through the Manage Subscription screen in your account — unless a
        promotional/referral code was used on that subscription period, in which case that period isn't
        eligible for this refund guarantee. Refund requests made after the 90-day window, or for
        subscriptions purchased through the Apple App Store or Google Play, are handled by Apple's or
        Google's own refund process rather than by us directly (see below).
      </p>
      <p className="mb-4">
        On iOS and Android, subscriptions are billed and managed through Apple's or Google's payment
        systems and are subject to their respective terms and refund policies, not ours, once purchased
        through the app.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">5. Referral program</h2>
      <p className="mb-4">
        Astryks may let you share a personal referral code. If someone you refer subscribes using your
        code and remains a paying subscriber for 90 consecutive days, we'll pay you a referral reward
        (currently AU$50 or the equivalent in your local currency) — we may change this amount, or end
        the referral program entirely, at any time with reasonable notice, without affecting rewards
        already earned. A referral code does not discount the price for the person who uses it; it's
        solely a way for us to track and pay the referrer. We reserve the right to withhold or reverse a
        referral reward if we reasonably believe it was earned through fraud, self-referral, or abuse of
        the program (e.g. creating fake accounts to refer yourself).
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">6. Content you post</h2>
      <p className="mb-4">
        You keep ownership of anything you post to Astryks (photos, videos, text, links — "User
        Content"). By posting, you grant Astryks a worldwide, royalty-free, non-exclusive license to
        host, store, reproduce, and display that User Content on the Service (including in the
        creative-prize leaderboard and any public winner announcements) for as long as your post exists
        or your account is active. You confirm you own or have the rights to everything you post, and
        that it doesn't infringe anyone else's rights.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">7. Course content</h2>
      <p className="mb-4">
        Lesson videos and other course material are owned by Astryks or our instructors and licensed to
        you for personal, non-commercial viewing as part of an active subscription. You may not
        download, redistribute, or resell this content.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">8. The Creative Prize</h2>
      <p className="mb-4">
        Astryks runs a monthly cash prize for the most-liked eligible post, described on our{" "}
        <Link href="/prize-rules" className="link-accent">Prize Rules</Link> page, which is part of
        these Terms. Read it before entering — it covers eligibility, how a winner is chosen, and how
        payment works.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">9. Things you agree not to do</h2>
      <p className="mb-4">
        Don't: post anything illegal, harassing, hateful, sexually exploitative (especially involving
        minors — we have zero tolerance for this and will report it to the relevant authorities), or
        infringing someone else's rights; use bots, purchased likes/followers, multiple accounts, or any
        other artificial means to inflate likes, especially in connection with the Creative Prize; scrape
        or resell course content; impersonate anyone; or interfere with the Service's normal operation.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">10. Termination</h2>
      <p className="mb-4">
        You can delete your account at any time from your profile. We may suspend or terminate your
        access if you violate these Terms. If we terminate your account for cause, we're not obligated
        to refund any unused portion of your subscription.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">11. Disclaimers</h2>
      <p className="mb-4">
        The Service is provided "as is." We don't guarantee it will be uninterrupted, error-free, or
        that any lesson will make you an expert — outcomes depend on you. To the extent permitted by
        law, we disclaim all warranties, express or implied.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">12. Limitation of liability</h2>
      <p className="mb-4">
        To the maximum extent permitted by law, Astryks and its team aren't liable for any indirect,
        incidental, or consequential damages arising from your use of the Service, and our total
        liability for any claim is limited to the amount you paid us in the 3 months before the claim
        arose. Nothing here limits liability that can't be limited under applicable consumer law
        (including the Australian Consumer Law, if you're an Australian consumer).
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">13. Changes to these Terms</h2>
      <p className="mb-4">
        We may update these Terms from time to time. If a change is material, we'll make reasonable
        efforts to notify you (e.g. in-app or by email) before it takes effect.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">14. Governing law</h2>
      <p className="mb-4">
        These Terms are governed by the laws of New South Wales, Australia, without regard to
        conflict-of-law principles, and any dispute will be handled in the courts of New South Wales,
        Australia — unless a mandatory law in your country of residence says otherwise.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">15. Contact</h2>
      <p className="mb-4">
        Questions about these Terms? Message us in-app via Astryks Support, visit our{" "}
        <Link href="/support" className="link-accent">Support page</Link>, or email support@astryks.com.
      </p>
    </div>
  );
}
