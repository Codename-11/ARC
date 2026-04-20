import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useArcClient } from "../src/client-provider";

type Agent = Awaited<
  ReturnType<NonNullable<ReturnType<typeof useArcClient>["client"]>["agents"]["list"]>
>["agents"][number];

export default function AgentsScreen() {
  const { client, status, error } = useArcClient();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!client || status !== "connected") {
      setAgents(null);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const result = await client.agents.list();
      setAgents(result.agents);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, status]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.statusText}>
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting…"
              : status === "error"
                ? `Error: ${error ?? "unknown"}`
                : "Not paired"}
        </Text>
        <Link href="/settings" asChild>
          <Pressable style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>Settings</Text>
          </Pressable>
        </Link>
      </View>

      {status !== "connected" ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No daemon connection</Text>
          <Text style={styles.emptyBody}>
            Pair this device with your ARC daemon to view running agents.
          </Text>
          <Link href="/settings" asChild>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Pair with daemon</Text>
            </Pressable>
          </Link>
        </View>
      ) : loading && !agents ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : fetchError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Failed to load agents</Text>
          <Text style={styles.emptyBody}>{fetchError}</Text>
          <Pressable style={styles.primaryButton} onPress={load}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : !agents || agents.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No active agents</Text>
          <Text style={styles.emptyBody}>
            Start an agent from the ARC CLI or dashboard; it will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Link href={`/agent/${item.id}`} asChild>
              <Pressable style={styles.row}>
                <Text style={styles.rowTitle}>{item.profile}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.id} · {item.status}
                </Text>
              </Pressable>
            </Link>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshing={loading}
          onRefresh={load}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: "#222",
    borderBottomWidth: 1,
  },
  statusText: { color: "#aaa", fontSize: 13 },
  settingsButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
  },
  settingsButtonText: { color: "#fff", fontSize: 13 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptyBody: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  primaryButtonText: { color: "#000", fontWeight: "600" },
  row: { paddingHorizontal: 16, paddingVertical: 14 },
  rowTitle: { color: "#fff", fontSize: 16, fontWeight: "500" },
  rowSubtitle: { color: "#888", fontSize: 12, marginTop: 2 },
  separator: { height: 1, backgroundColor: "#1a1a1a" },
});
