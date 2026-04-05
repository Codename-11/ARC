import { useEffect, useState, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import { useAgents } from "../useAgents.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

function SectionHeader({ label, fillWidth }: { label: string; fillWidth?: number }) {
  const { theme } = useTheme();
  const fill = fillWidth ?? Math.max(2, 24 - label.length);
  return (
    <Box gap={1} marginBottom={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"\u2500".repeat(fill)}</Text>
    </Box>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Box width={18}>
        <Text color={theme.colors.dimmed}>{label}</Text>
      </Box>
      <Text color={color ?? theme.colors.text}>{value}</Text>
    </Box>
  );
}

export function AgentsView({ profiles, focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const { agents, checkAllHealth, checkAgentHealth } = useAgents();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // --- Fix #3: Safe message timeout ---
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const showMessage = useCallback((text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);

  // --- Fix #4: Clamp selectedIndex when agents change ---
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, agents.length - 1)));
  }, [agents.length]);

  const onlineCount = agents.filter((a) => a.status === "online").length;
  const offlineCount = agents.filter((a) => a.status === "offline").length;

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(agents.length - 1, i + 1));
        return;
      }

      if (input === "h") {
        const agent = agents[selectedIndex];
        if (agent) {
          showMessage("Checking health...");
          checkAgentHealth(agent.id);
        }
        return;
      }

      if (input === "H") {
        showMessage("Checking all agents...");
        checkAllHealth();
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <SectionHeader label="agents" />

      {/* Agent list */}
      <Box flexDirection="column">
        {agents.length === 0 ? (
          <Box paddingLeft={1}>
            <Text color={colors.dimmed}>No remote agents registered.</Text>
          </Box>
        ) : (
          agents.map((agent, index) => {
            const isOnline = agent.status === "online";
            const isSelected = index === selectedIndex;
            return (
              <Box
                key={agent.id}
                gap={2}
                paddingLeft={1}
                backgroundColor={isSelected ? colors.bgSelected : undefined}
              >
                <Text color={isOnline ? colors.success : colors.dimmed}>{"\u25CF"}</Text>
                <Box width={18}>
                  <Text color={isOnline ? colors.text : colors.dimmed} bold={isSelected || isOnline}>
                    {agent.name}
                  </Text>
                </Box>
                <Box width={6}>
                  <Text color={colors.dimmed}>{agent.transport}</Text>
                </Box>
                <Text color={colors.dimmed}>{agent.endpoint}</Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Summary */}
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader label="summary" />
        <Box flexDirection="column" paddingLeft={1}>
          <StatusRow label="total" value={String(agents.length)} />
          <StatusRow label="online" value={String(onlineCount)} color={colors.success} />
          <StatusRow label="offline" value={String(offlineCount)} color={offlineCount > 0 ? colors.warning : colors.dimmed} />
        </Box>
      </Box>

      {/* Message bar */}
      {message && (
        <Box paddingLeft={1} paddingTop={1}>
          <Text color={colors.warning}>{message}</Text>
        </Box>
      )}

      {/* Key hints */}
      <Box paddingLeft={1} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>[h]</Text> check health{"  "}
          <Text color={colors.primary} bold>[H]</Text> check all{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
