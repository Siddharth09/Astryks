import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

// Android 8+ requires a notification channel to display notifications reliably (and to control
// importance/sound) — without one, notifications can be silently dropped or shown with
// undesirable default behavior. No-op on iOS, which has no channel concept.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !Device.isDevice) return;

    (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (existing !== "granted") {
        const { status: requested } = await Notifications.requestPermissionsAsync();
        status = requested;
      }
      if (status !== "granted") return;

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await setDoc(doc(db, "users", user.uid), { pushToken: tokenData.data }, { merge: true });
      } catch (err) {
        // Push tokens aren't available in Expo Go from SDK 53+ without an EAS
        // projectId context (e.g. plain Expo Go testing). Fail silently so
        // this doesn't surface as an uncaught promise rejection — push is a
        // nice-to-have, not required for the app to function.
        console.log("Push notifications unavailable in this environment:", err);
      }
    })();
  }, [user]);
}
