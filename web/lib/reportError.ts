import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const logClientErrorFn = httpsCallable(functions, "logClientError");

const ANON_ID_KEY = "astryks_anon_id";

// Only used to bucket pre-login crash reports from the same browser under one rate-limit key
// server-side (see functions/index.js) — not an identity/tracking id, so a plain random string
// stored in localStorage is enough; no need for crypto.randomUUID's guarantees.
function getAnonId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(ANON_ID_KEY, generated);
    return generated;
  } catch {
    return null;
  }
}

function toMessageAndStack(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message);
    const stack = "stack" in error ? String((error as { stack?: unknown }).stack) : undefined;
    return { message, stack };
  }
  return { message: String(error) };
}

// Fire-and-forget by design: a crash report failing to send must never surface as a second error
// (there's nowhere left to report that one to), so every failure mode here is swallowed silently.
export function reportClientError(error: unknown, screen?: string): void {
  try {
    const { message, stack } = toMessageAndStack(error);
    logClientErrorFn({
      platform: "web",
      message,
      stack,
      screen: screen ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
      anonId: getAnonId(),
    }).catch(() => {});
  } catch {
    // Swallow — see comment above.
  }
}
