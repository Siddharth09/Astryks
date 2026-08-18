"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportError";

// Mounted once in the root layout. React's own error.tsx/global-error.tsx boundaries only catch
// errors thrown during render — they miss anything thrown from a setTimeout, an async event
// handler, or a promise nobody attached a .catch to, which is exactly what these two global
// listeners exist to pick up instead.
export default function ErrorReporter() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      reportClientError(event.error ?? event.message);
    }

    function handleRejection(event: PromiseRejectionEvent) {
      reportClientError(event.reason);
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
