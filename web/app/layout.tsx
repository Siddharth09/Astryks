import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import SideNav from "@/components/SideNav";
import SplashIntro from "@/components/SplashIntro";
import TopHeader from "@/components/TopHeader";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Astryks",
  description: "Learn real skills. Post your own work. Grow together.",
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
