import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import SideNav from "@/components/SideNav";
import SplashIntro from "@/components/SplashIntro";
import { IconMark } from "@/components/Icons";

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
            <header className="md:hidden border-b border-line/10 sticky top-0 z-10 bg-paper/90 backdrop-blur">
              <div className="max-w-3xl mx-auto flex items-center gap-2 px-4 py-3">
                <IconMark className="w-6 h-6 rounded-md flex-shrink-0" />
                <span className="font-display font-semibold">Astryks</span>
              </div>
            </header>
            <SideNav />
            <main className="md:pl-56">
              <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">{children}</div>
            </main>
            <BottomNav />
          </SplashIntro>
        </AuthProvider>
      </body>
    </html>
  );
}
