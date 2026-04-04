import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

// TODO: Wire to PersistentMemory from @axiom-labs/arc-core
interface MemoryEntry {
  id: string;
  scope: "global" | "project" | "profile";
  type: "fact" | "preference" | "instruction" | "context";
  content: string;
  relevance: number; // 0.0 – 1.0
}

// TODO: Replace with live data from PersistentMemory
const PLACEHOLDER_ENTRIES: MemoryEntry[] = [
  { id: "m-001", scope: "global", type: "preference", content: "User prefers Conventional Commits for all repos", relevance: 0.95 },
  { id: "m-002", scope: "project", type: "fact", content: "ARC uses tsup for bundling with a single dist/index.js output", relevance: 0.88 },
  { id: "m-003", scope: "profile", type: "instruction", content: "Always run typecheck before committing changes", relevance: 0.72 },
];

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

function ScopeBadge({ scope }: { scope: MemoryEntry["scope"] }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const colorMap: Record<MemoryEntry["scope"], string> = {
    global: colors.primary,
    project: colors.warning,
    profile: colors.success,
  };
  return <Text color={colorMap[scope]}>{`[${scope}]`}</Text>;
}

function TypeLabel({ type }: { type: MemoryEntry["type"] }) {
  const { theme } = useTheme();
  return <Text color={theme.colors.dimmed}>{type}</Text>;
}

function RelevanceBar({ score }: { score: number }) {
  const { theme } = useTheme();
  const filled = Math.round(score * 5);
  const empty = 5 - filled;
  return (
    <Text>
      <Text color={theme.colors.success}>{"█".repeat(filled)}</Text>
      <Text color={theme.colors.border}>{"░".repeat(empty)}</Text>
    </Text>
  );
}

export function MemoryView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  // TODO: Wire to PersistentMemory
  const entries = PLACEHOLDER_ENTRIES;

  const total = entries.length;
  const byScope = {
    global: entries.filter((e) => e.scope === "global").length,
    project: entries.filter((e) => e.scope === "project").length,
    profile: entries.filter((e) => e.scope === "profile").length,
  };

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max - 1) + "…" : text;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <SectionHeader label="memory" />

      {entries.length === 0 ? (
        <Text color={colors.dimmed}>No memory entries.</Text>
      ) : (
        <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
          {/* Column headers */}
          <Box gap={1} marginBottom={1}>
            <Box width={11}><Text color={colors.dimmed} bold>scope</Text></Box>
            <Box width={14}><Text color={colors.dimmed} bold>type</Text></Box>
            <Box width={38}><Text color={colors.dimmed} bold>content</Text></Box>
            <Text color={colors.dimmed} bold>relevance</Text>
          </Box>

          {entries.map((entry) => (
            <Box key={entry.id} gap={1}>
              <Box width={11}><ScopeBadge scope={entry.scope} /></Box>
              <Box width={14}><TypeLabel type={entry.type} /></Box>
              <Box width={38}>
                <Text color={colors.text}>{truncate(entry.content, 36)}</Text>
              </Box>
              <RelevanceBar score={entry.relevance} />
            </Box>
          ))}
        </Box>
      )}

      <SectionHeader label="summary" />
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="total entries" value={String(total)} />
        <StatusRow label="global" value={String(byScope.global)} color={colors.primary} />
        <StatusRow label="project" value={String(byScope.project)} color={colors.warning} />
        <StatusRow label="profile" value={String(byScope.profile)} color={colors.success} />
      </Box>
    </Box>
  );
}
