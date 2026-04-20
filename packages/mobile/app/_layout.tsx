import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClientProvider } from "../src/client-provider";

export default function RootLayout() {
  return (
    <ClientProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
          contentStyle: { backgroundColor: "#000" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Agents" }} />
        <Stack.Screen name="agent/[id]" options={{ title: "Agent" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </ClientProvider>
  );
}
