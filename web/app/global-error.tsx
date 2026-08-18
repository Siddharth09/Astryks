"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportError";

// error.tsx (in this same folder) only catches errors thrown by a page — it can't catch an error
// thrown by the root layout itself (which renders TopHeader/SideNav/AppShell on every route).
// Next.js requires a global-error.tsx to handle that case, and — because it replaces the root
// layout when it fires — it has to render its own <html>/<body> rather than relying on
// app/layout.tsx's. This is the last line of defense before a visitor would see Next's raw
// unstyled crash screen.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", background: "#F7F1E5", color: "#17130F" }}>
        <div style={{ maxWidth: 384, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 36, marginBottom: 16 }}>⚠️</p>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.6, marginBottom: 24 }}>
            That's on us, not you. Reloading usually fixes it.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#E85D5D",
              color: "white",
              border: "none",
              borderRadius: 999,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
