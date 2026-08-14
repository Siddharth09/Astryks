import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
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
    images: [{ url: "/logo-mark.png", width: 1024, height: 1024 }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Astryks",
    description: DESCRIPTION,
    images: ["/logo-mark.png"],
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
        <AuthProvider>
          <SplashIntro>
            <TopHeader />
            <SideNav />
            <AppShell>{children}</AppShell>
            <BottomNav />
          </SplashIntro>
        </AuthProvider>
      </body>
    </html>
  );
}
