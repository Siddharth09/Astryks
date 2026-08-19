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
      <Tabs.Screen
        name="prizes"
        options={{ title: "Prizes", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🏆</Text> }}
      />
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
