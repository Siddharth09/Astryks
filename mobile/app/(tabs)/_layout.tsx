import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "@/lib/styles";
import { usePushNotifications } from "@/lib/usePushNotifications";

export default function TabsLayout() {
  usePushNotifications();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#E85D5D",
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⌂</Text> }}
      />
      <Tabs.Screen
        name="learn"
        options={{ title: "Learn", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>◈</Text> }}
      />
      {/* The old Prizes tab is gone — the Hall of Fame that replaced the Creative Prize lives as
          a sub-tab inside Home instead (see app/(tabs)/home.tsx). prizes.tsx itself hasn't been
          deleted, just hidden from the tab bar via href: null (Expo Router would otherwise
          auto-register it as an unstyled extra tab just because the file exists in this folder). */}
      <Tabs.Screen name="prizes" options={{ href: null }} />
      <Tabs.Screen
        name="messages"
        options={{ title: "Messages", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>✉</Text> }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: "Me", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>○</Text> }}
      />
    </Tabs>
  );
}
