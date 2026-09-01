import { View, Text, TouchableOpacity, Platform } from "react-native";
import { router } from "expo-router";
import { colors } from "@/lib/styles";

const TABS = [
  { href: "/(tabs)/home", label: "Home", icon: "⌂" },
  { href: "/(tabs)/learn", label: "Learn", icon: "◈" },
  { href: "/(tabs)/messages", label: "Messages", icon: "✉" },
  { href: "/(tabs)/me", label: "Me", icon: "○" },
] as const;

// Screens outside the (tabs) group (post/[id], user/[userId], messages/[conversationId]) sit on
// the root stack, above the Tabs navigator — so its bottom tab bar disappears entirely once you
// navigate into one of them, with no way back except the OS back gesture/button. This is a
// visual stand-in for that same bar so "press Home and return easily" works from any detail
// screen too. router.replace (not push) so tapping a tab from here doesn't pile detail screens
// up underneath the tab you just switched to.
export default function PersistentTabBar() {
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 0.5,
        borderTopColor: "#eee",
        backgroundColor: colors.paper,
        // No SafeAreaProvider is set up anywhere in this app (react-native-safe-area-context's
        // useSafeAreaInsets would throw/warn without one) — matches the rest of the codebase's
        // approach of hardcoding a reasonable value (e.g. the paddingTop: 56 used everywhere
        // for the status bar) rather than reading real insets.
        paddingBottom: Platform.OS === "ios" ? 24 : 10,
      }}
    >
      {TABS.map(({ href, label, icon }) => (
        <TouchableOpacity
          key={href}
          onPress={() => router.replace(href)}
          style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 10 }}
        >
          <Text style={{ fontSize: 20, color: colors.muted }}>{icon}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
