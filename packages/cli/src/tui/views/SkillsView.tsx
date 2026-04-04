import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

// TODO: Wire to SkillRegistry from @axiom-labs/arc-core
interface Skill {
  id: string;
  name: string;
  source: "file" | "mcp" | "built-in";
  status: "loaded" | "error";
  description?: string;
}

// TODO: Replace with live data from SkillRegistry
const PLACEHOLDER_SKILLS: Skill[] = [
  { id: "s-001", name: "commit", source: "built-in", status: "loaded", description: "Create conventional commits" },
  { id: "s-002", name: "review-pr", source: "built-in", status: "loaded", description: "Review pull requests with inline feedback" },
  { id: "s-003", name: "deploy-preview", source: "mcp", status: "loaded", description: "Deploy preview environments via MCP" },
  { id: "s-004", name: "custom-lint", source: "file", status: "error", description: "Project-specific lint rules (missing config)" },
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

function SourceBadge({ source }: { source: Skill["source"] }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const colorMap: Record<Skill["source"], string> = {
    "built-in": colors.primary,
    mcp: colors.warning,
    file: colors.dimmed,
  };
  return <Text color={colorMap[source]}>{`[${source}]`}</Text>;
}

function StatusIndicator({ status }: { status: Skill["status"] }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const icon = status === "loaded" ? "✔" : "✖";
  const color = status === "loaded" ? colors.success : colors.error;
  return <Text color={color}>{icon} {status}</Text>;
}

export function SkillsView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  // TODO: Wire to SkillRegistry
  const skills = PLACEHOLDER_SKILLS;

  const total = skills.length;
  const loaded = skills.filter((s) => s.status === "loaded").length;
  const errored = skills.filter((s) => s.status === "error").length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <SectionHeader label="skills" />

      {skills.length === 0 ? (
        <Text color={colors.dimmed}>No skills registered.</Text>
      ) : (
        <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
          {/* Column headers */}
          <Box gap={1} marginBottom={1}>
            <Box width={20}><Text color={colors.dimmed} bold>name</Text></Box>
            <Box width={12}><Text color={colors.dimmed} bold>source</Text></Box>
            <Box width={12}><Text color={colors.dimmed} bold>status</Text></Box>
            <Text color={colors.dimmed} bold>description</Text>
          </Box>

          {skills.map((skill) => (
            <Box key={skill.id} gap={1}>
              <Box width={20}>
                <Text color={colors.text}>{skill.name}</Text>
              </Box>
              <Box width={12}><SourceBadge source={skill.source} /></Box>
              <Box width={12}><StatusIndicator status={skill.status} /></Box>
              <Text color={colors.dimmed}>
                {skill.description
                  ? skill.description.length > 40
                    ? skill.description.slice(0, 39) + "…"
                    : skill.description
                  : "—"}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <SectionHeader label="summary" />
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="total" value={String(total)} />
        <StatusRow label="loaded" value={String(loaded)} color={colors.success} />
        <StatusRow label="errored" value={String(errored)} color={errored > 0 ? colors.error : colors.dimmed} />
      </Box>
    </Box>
  );
}
