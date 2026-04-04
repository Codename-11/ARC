import { Box, Text } from "ink";
import { useTheme, type ThemeColors } from "../theme.js";
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

type SyncStatus = "synced" | "pending" | "conflict";

interface SyncItem {
  name: string;
  kind: string;
  status: SyncStatus;
}

// TODO: Wire to real shared layer sync state from src/shared.ts
const PLACEHOLDER_ITEMS: SyncItem[] = [
  { name: "MCP servers", kind: "mcp", status: "synced" },
  { name: "Commands", kind: "commands", status: "synced" },
  { name: "CLAUDE.md", kind: "claude-md", status: "pending" },
  { name: "Memory", kind: "memory", status: "synced" },
  { name: "Projects", kind: "projects", status: "conflict" },
];

function statusIcon(status: SyncStatus, colors: ThemeColors): { icon: string; color: string } {
  switch (status) {
    case "synced":
      return { icon: "✔", color: colors.success };
    case "pending":
      return { icon: "●", color: colors.warning };
    case "conflict":
      return { icon: "✖", color: colors.error };
  }
}

export function SyncView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  // TODO: Read real sync provider and timestamps from config/shared layer
  const provider = "local";
  const lastSync = "2026-04-04 09:32:15";
  const direction = "push";

  return (
    <Box flexDirection="column" gap={1}>
      <SectionHeader label="sync" />

      {/* Sync status */}
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="provider" value={provider} />
        <StatusRow label="last sync" value={lastSync} />
        <StatusRow label="direction" value={direction} />
      </Box>

      {/* Synced items */}
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader label="items" />
        {PLACEHOLDER_ITEMS.map((item) => {
          const { icon, color } = statusIcon(item.status, colors);
          return (
            <Box key={item.name} gap={2} paddingLeft={1}>
              <Text color={color}>{icon}</Text>
              <Box width={16}>
                <Text color={colors.text}>{item.name}</Text>
              </Box>
              <Text color={color}>{item.status}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Summary */}
      <Box flexDirection="column" marginTop={1}>
        <SectionHeader label="summary" />
        <Box flexDirection="column" paddingLeft={1}>
          <StatusRow
            label="items synced"
            value={`${PLACEHOLDER_ITEMS.filter((i) => i.status === "synced").length}/${PLACEHOLDER_ITEMS.length}`}
            color={colors.success}
          />
          <StatusRow label="last sync" value={lastSync} color={colors.dimmed} />
        </Box>
      </Box>
    </Box>
  );
}
