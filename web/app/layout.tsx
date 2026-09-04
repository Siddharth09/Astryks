import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { PrivacyLockProvider } from "@/contexts/PrivacyLockContext";
import BottomNav from "@/components/BottomNav";
import ErrorReporter from "@/components/ErrorReporter";
import ReferralCapture from "@/components/ReferralCapture";
import SideNav from "@/components/SideNav";
import SplashIntro from "@/components/SplashIntro";
import TopHeader from "@/components/TopHeader";
import AppShell from "@/components/AppShell";

const DESCRIPTION = "Learn real skills. Post your own work. Grow together.";

// Without openGraph/twitter fields, a link to astryks.com shared in iMessage/Slack/Twitter/etc.
// (exactly what an app-store push and word-of-mouth launch depend on) renders as a bare gray box
// with no image or description — this is what makes a shared link actually look like a real
// product instead of a raw URL.
export const metadata: Metadata = {
  metadataBase: new URL("https://astryks.com"),
  title: "Astryks",
  description: DESCRIPTION,
  openGraph: {
    title: "Astryks",
    description: DESCRIPTION,
    url: "https://astryks.com",
    siteName: "Astryks",
    // No `images` here on purpose: app/opengraph-image.png already exists, and Next.js's file
    // convention auto-generates the correct og:image metadata from it. The old explicit
    // `images: [{ url: "/logo-mark.png" }]` was a leftover from before that file existed — Next
    // was emitting BOTH tags (this one first), so the square placeholder logo was actually
    // winning over the real 1200x630 card that was already sitting unused in the repo.
    locale: "en_US",
    type: "website",
  },
  twitter: {
    // "summary_large_image" (not "summary") is what makes Twitter/X render a large landscape
    // card instead of a small square thumbnail. Same story as openGraph above: no explicit
    // `images` here so app/twitter-image.png (file convention) is what actually gets used.
    card: "summary_large_image",
    title: "Astryks",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#E85D5D",
};

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700", "900"],
  style: ["normal"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <ErrorReporter />
        <ReferralCapture />
        <AuthProvider>
          <PrivacyLockProvider>
            <SplashIntro>
              <TopHeader />
              <SideNav />
              <AppShell>{children}</AppShell>
              <BottomNav />
            </SplashIntro>
          </PrivacyLockProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
