import { useState } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/contexts/AuthContext";
import SplashVideo from "@/components/SplashVideo";
import ErrorBoundary from "@/components/ErrorBoundary";
import { setupGlobalErrorHandler } from "@/lib/errorReporting";

setupGlobalErrorHandler();

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <StatusBar style="dark" />
        {showSplash ? <SplashVideo onDone={() => setShowSplash(false)} /> : <Slot />}
      </AuthProvider>
    </ErrorBoundary>
  );
}
