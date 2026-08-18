import { Platform } from "react-native";
import { httpsCallable } from "firebase/functions";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { functions } from "@/lib/firebase";

const logClientError = httpsCallable(functions, "logClientError");

const ANON_ID_KEY = "astryks_anon_id";

// expo-application (device installation id) isn't a direct dependency here, only a
// transitive one pulled in by something else — so we don't rely on it. AsyncStorage
// already is a direct dependency, so we persist our own random id with it instead.
let cachedAnonId: string | null = null;
let anonIdPromise: Promise<string> | null = null;

function generateAnonId(): string {
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function getAnonId(): Promise<string> {
  if (cachedAnonId) return cachedAnonId;
  if (!anonIdPromise) {
    anonIdPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(ANON_ID_KEY);
        if (stored) return stored;
        const fresh = generateAnonId();
        await AsyncStorage.setItem(ANON_ID_KEY, fresh);
        return fresh;
      } catch {
        // Storage unavailable — fall back to an in-memory-only id for this session.
        return generateAnonId();
      }
    })();
  }
  cachedAnonId = await anonIdPromise;
  return cachedAnonId;
}

function extractMessageAndStack(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export async function reportError(error: unknown, screen?: string): Promise<void> {
  const { message, stack } = extractMessageAndStack(error);
  const anonId = await getAnonId();

  try {
    await logClientError({
      platform: Platform.OS === "ios" ? "ios" : "android",
      message,
      stack,
      screen,
      appVersion: Constants.expoConfig?.version,
      anonId,
    });
  } catch {
    // Never let error reporting itself crash the app.
  }
}

let globalHandlerInstalled = false;

export function setupGlobalErrorHandler(): void {
  // Guards against Fast Refresh re-running this module and nesting handlers on top
  // of each other.
  if (globalHandlerInstalled) return;
  globalHandlerInstalled = true;

  const previousHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error);
    previousHandler?.(error, isFatal);
  });
}
