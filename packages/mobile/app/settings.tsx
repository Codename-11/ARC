import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useArcClient } from "../src/client-provider";

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, saveSettings, clearSettings, status, error } =
    useArcClient();
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHost(settings?.host ?? "");
    setToken(settings?.token ?? "");
  }, [settings]);

  const save = async () => {
    if (!host.trim() || !token.trim()) return;
    setSaving(true);
    try {
      await saveSettings({ host: host.trim(), token: token.trim() });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    await clearSettings();
    setHost("");
    setToken("");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Daemon host</Text>
      <TextInput
        style={styles.input}
        placeholder="127.0.0.1:7272 or ws://host:7272"
        placeholderTextColor="#555"
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.label}>Pair token</Text>
      <TextInput
        style={styles.input}
        placeholder="shared secret from `arc daemon token`"
        placeholderTextColor="#555"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting…"
              : status === "error"
                ? `Error: ${error ?? "unknown"}`
                : status === "unconfigured"
                  ? "Not paired"
                  : "Idle"}
        </Text>
      </View>

      <Pressable
        style={[
          styles.primary,
          (!host.trim() || !token.trim() || saving) && styles.disabled,
        ]}
        onPress={save}
        disabled={!host.trim() || !token.trim() || saving}
      >
        <Text style={styles.primaryText}>
          {saving ? "Saving…" : "Save & connect"}
        </Text>
      </Pressable>

      <Pressable style={styles.secondary} onPress={clear}>
        <Text style={styles.secondaryText}>Clear pairing</Text>
      </Pressable>

      <Text style={styles.hint}>
        QR pairing is planned for a later phase. For now, copy the token from
        `arc daemon token` on the machine running the daemon.
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
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#111",
    color: "#fff",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  statusRow: { marginTop: 16 },
  statusText: { color: "#aaa", fontSize: 13 },
  primary: {
    marginTop: 24,
    backgroundColor: "#fff",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  primaryText: { color: "#000", fontWeight: "600", fontSize: 15 },
  disabled: { opacity: 0.4 },
  secondary: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
    borderColor: "#333",
    borderWidth: 1,
  },
  secondaryText: { color: "#ccc", fontSize: 14 },
  hint: { color: "#555", fontSize: 12, marginTop: 24, lineHeight: 18 },
});
