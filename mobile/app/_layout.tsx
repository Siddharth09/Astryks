import { useState } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/contexts/AuthContext";
import SplashVideo from "@/components/SplashVideo";

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <AuthProvider>
      <StatusBar style="dark" />
      {showSplash ? <SplashVideo onDone={() => setShowSplash(false)} /> : <Slot />}
    </AuthProvider>
  );
}
