import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

function SectionHeader({ label, fillWidth }: { label: string; fillWidth?: number }) {
  const { theme } = useTheme();
  const fill = fillWidth ?? Math.max(2, 24 - label.length);
  return (
    <Box gap={1} marginBottom={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"─".repeat(fill)}</Text>
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

type AgentStatus = "online" | "offline";
type AgentTransport = "ws" | "http";

interface RemoteAgent {
  name: string;
  transport: AgentTransport;
  endpoint: string;
  status: AgentStatus;
}

// TODO: Wire to real remote agent registry / discovery
const PLACEHOLDER_AGENTS: RemoteAgent[] = [
  { name: "claude-primary", transport: "ws", endpoint: "ws://localhost:3100", status: "online" },
  { name: "gemini-pool", transport: "http", endpoint: "http://localhost:3200/api", status: "online" },
  { name: "codex-remote", transport: "ws", endpoint: "ws://10.0.1.5:3300", status: "offline" },
];

export function AgentsView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  const onlineCount = PLACEHOLDER_AGENTS.filter((a) => a.status === "online").length;
  const offlineCount = PLACEHOLDER_AGENTS.filter((a) => a.status === "offline").length;

  return (
    <Box flexDirection="column" gap={1}>
      <SectionHeader label="agents" />

      {/* Agent list */}
      <Box flexDirection="column">
        {PLACEHOLDER_AGENTS.map((agent) => {
          const isOnline = agent.status === "online";
          return (
            <Box key={agent.name} gap={2} paddingLeft={1}>
              <Text color={isOnline ? colors.success : colors.dimmed}>●</Text>
              <Box width={18}>
                <Text color={isOnline ? colors.text : colors.dimmed} bold={isOnline}>
                  {agent.name}
                </Text>
              </Box>
              <Box width={6}>
                <Text color={colors.dimmed}>{agent.transport}</Text>
              </Box>
              <Text color={colors.dimmed}>{agent.endpoint}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Summary */}
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader label="summary" />
        <Box flexDirection="column" paddingLeft={1}>
          <StatusRow label="total" value={String(PLACEHOLDER_AGENTS.length)} />
          <StatusRow label="online" value={String(onlineCount)} color={colors.success} />
          <StatusRow label="offline" value={String(offlineCount)} color={offlineCount > 0 ? colors.warning : colors.dimmed} />
        </Box>
      </Box>
    </Box>
  );
}
