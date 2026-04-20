import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useArcClient } from "../../src/client-provider";

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, status } = useArcClient();
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!client || status !== "connected" || !id) return;
      try {
        const result = await client.agents.list();
        if (cancelled) return;
        const match = result.agents.find((a) => a.id === id);
        setAgentStatus(match?.status ?? "unknown");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, status, id]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Agent ID</Text>
      <Text style={styles.value}>{id ?? "(missing)"}</Text>

      <Text style={styles.label}>Status</Text>
      <Text style={styles.value}>{error ?? agentStatus ?? "…"}</Text>

      <Text style={styles.placeholder}>
        Live output, input, and controls coming in a later phase.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 20 },
  label: {
    color: "#666",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 16,
  },
  value: { color: "#fff", fontSize: 16, marginTop: 4 },
  placeholder: { color: "#555", marginTop: 32, fontStyle: "italic" },
});
