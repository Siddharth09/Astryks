import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

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
