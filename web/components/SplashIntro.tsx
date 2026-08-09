"use client";

import { useEffect, useRef, useState } from "react";

export default function SplashIntro({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(false);
  const [fading, setFading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const alreadyShown = sessionStorage.getItem("astryks_splash_shown");
    if (!alreadyShown) {
      setShowSplash(true);
      sessionStorage.setItem("astryks_splash_shown", "1");
    }
  }, []);

  function finishSplash() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFading(true);
    setTimeout(() => setShowSplash(false), 300);
  }

  useEffect(() => {
    if (!showSplash) return;
    // Safety net: if the video can't load/play/autoplay for any reason (a playback hiccup,
    // a browser autoplay restriction, a slow connection), never let it block the entire site —
    // force the splash away after a few seconds no matter what.
    const timeout = setTimeout(finishSplash, 4000);
    return () => clearTimeout(timeout);
  }, [showSplash]);

  if (!showSplash) return <>{children}</>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      <video
        ref={videoRef}
        src="/logo-spin.mp4"
        autoPlay
        muted
        playsInline
        onEnded={finishSplash}
        onError={finishSplash}
        style={{
          width: "min(420px, 85vw)",
          aspectRatio: "1360 / 738",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
