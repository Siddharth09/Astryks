"use client";

import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 pb-24 px-4 text-sm text-ink/80 leading-relaxed">
      <h1 className="font-display text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-xs text-ink/40 mb-8">Last updated: 18 August 2026 · Applies to Astryks (the "Service"), operated by the holder of Australian Business Number (ABN) 74 309 712 800, trading as Astryks.</p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">1. What we collect</h2>
      <p className="mb-2">When you use Astryks, we collect:</p>
      <p className="mb-1"><strong>Account info:</strong> name, email address, profile photo, password (stored securely and hashed by Firebase Authentication — we never see it in plain text).</p>
      <p className="mb-1"><strong>Content you create:</strong> posts (photos, videos, text, links), comments, likes, messages you send other members or our support account.</p>
      <p className="mb-1"><strong>Billing info:</strong> handled entirely by Stripe (and, on mobile, Apple/Google) — we receive your subscription status, billing country, and currency, but never your full card number.</p>
      <p className="mb-1"><strong>Usage data:</strong> lesson progress, streaks, which posts you've liked/saved, how much free-preview lesson time you've used per subject (if you're not yet subscribed), who you've blocked (so we can keep your feed and messages filtered accordingly), and basic device/app info needed to make the Service work (e.g. push notification token).</p>
      <p className="mb-1"><strong>Location signal:</strong> we estimate your country from your IP address at sign-in (used only for this lookup, not stored) to show you an illustrative subscription price in your local currency, and — once you subscribe — we replace that estimate with the actual billing country Stripe/Apple/Google give us. See our <Link href="/terms" className="link-accent">Terms of Service</Link> for how pricing works.</p>
      <p className="mb-4"><strong>Crash &amp; error reports:</strong> if the app or website hits an unexpected error, we automatically collect the error message, a technical stack trace, and which screen you were on, so we can find and fix the bug. This happens even if you're not logged in (for example, if something breaks on the login screen itself) — logged-out reports aren't tied to an account, just a random identifier stored on your device to avoid one broken session flooding us with duplicate reports.</p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">2. How we use it</h2>
      <p className="mb-4">
        To run the Service (show your feed, process payments, deliver lesson videos, send you
        notifications you've opted into), to decide what to feature in the Hall of Fame, to keep
        the platform safe (reviewing reports, blocking abuse), and to contact you about your
        account or important changes. We don't sell your personal information.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">3. Who we share it with</h2>
      <p className="mb-2">We share limited data with the service providers that make Astryks work, and nobody else:</p>
      <p className="mb-1"><strong>Google Firebase / Google Cloud</strong> — hosts our database, authentication, and backend functions.</p>
      <p className="mb-1"><strong>Stripe</strong> — processes web subscription payments.</p>
      <p className="mb-1"><strong>Apple / Google</strong> — process iOS/Android subscription payments (via their in-app purchase systems), managed on our behalf by Qonversion.</p>
      <p className="mb-1"><strong>Bunny.net</strong> — stores and streams lesson and post videos.</p>
      <p className="mb-4">
        We may also disclose information if required by law, or to protect the safety of our members
        (for example, reporting content that sexually exploits a minor to the relevant authorities).
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">4. Public content</h2>
      <p className="mb-4">
        Posts you mark public, your display name, and profile photo are visible to other members
        and, if we or the automatic monthly selection feature your post in the Hall of Fame, to
        anyone using the app. Private posts are only visible to you and our admin team.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">5. International transfers</h2>
      <p className="mb-4">
        Astryks operates from Australia, and our service providers store data in various countries
        (including the United States). By using the Service, you understand your information may be
        transferred to and processed in countries other than your own, which may have different data
        protection laws than your home country. Where a safeguard is legally required for this transfer
        (for example, for EU/UK users), we rely on the standard contractual clauses or equivalent
        safeguards our service providers (including Google Cloud/Firebase and Stripe) already build into
        their own data processing terms.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">6. How long we keep it</h2>
      <p className="mb-4">
        We keep your account data for as long as your account is active. If you delete your account, we
        delete your posts and personal account information within 30 days, except where we're required
        to keep billing records for tax/legal purposes. Like most messaging services, messages you've
        sent may remain visible in the conversation to the people you sent them to, even after your
        account is deleted.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">7. Your rights</h2>
      <p className="mb-4">
        You can view and update most of your info directly in the app. You can permanently delete your
        account and content from your profile settings at any time. Depending on where you live (for
        example, under GDPR in the EU/UK, or the Australian Privacy Act), you may also have the right to
        request a copy of your data or ask us to correct it — email support@astryks.com, visit our{" "}
        <Link href="/support" className="link-accent">Support page</Link>, and we'll action it.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">8. Children's privacy</h2>
      <p className="mb-4">
        Astryks is not directed at, and is not intended for use by, anyone under 18. We don't knowingly
        collect information from children. If you believe a child has created an account, contact us and
        we'll remove it.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">9. Cookies &amp; analytics</h2>
      <p className="mb-4">
        We currently don't use third-party advertising cookies or analytics trackers — only what
        Firebase and Stripe require to function (for example, keeping you signed in and processing
        payments). If we add analytics or advertising tools in future (for example, Google Analytics or
        Meta Pixel), we'll update this policy first.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">10. Security</h2>
      <p className="mb-4">
        We use industry-standard practices (encrypted connections, access-controlled databases) to
        protect your information, but no service can guarantee perfect security.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">11. Changes to this policy</h2>
      <p className="mb-4">
        We'll update the date at the top of this page when we make changes, and let you know in-app if
        a change is material.
      </p>

      <h2 className="font-display text-lg font-semibold mt-8 mb-2">12. Contact</h2>
      <p className="mb-4">
        Questions about your data? Message Astryks Support in-app, visit our{" "}
        <Link href="/support" className="link-accent">Support page</Link>, or email support@astryks.com.
      </p>
    </div>
  );
}
