import { Box, Text } from "ink";
import { getConfigPath } from "../../paths.js";
import { useTheme } from "../theme.js";
import type { ArcConfig } from "../../types.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  config: ArcConfig;
  profiles: ProfileEntry[];
}

function Row({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Box width={20}>
        <Text color={theme.colors.dimmed}>{label}</Text>
      </Box>
      <Text color={theme.colors.text}>{value}</Text>
    </Box>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={2} marginBottom={1}>
      <Text bold color={theme.colors.secondary}>{children}</Text>
      <Text color={theme.colors.border}>{"─".repeat(16)}</Text>
    </Box>
  );
}

export function SettingsView({ config, profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const activeProfile = profiles.find((profile) => profile.active);

  return (
    <Box flexDirection="column" gap={1}>
      {/* Config section */}
      <Box flexDirection="column">
        <SectionLabel>Configuration</SectionLabel>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={colors.border}
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.bgPanel}
          gap={0}
        >
          <Row label="Config path" value={getConfigPath()} />
          <Row label="Schema version" value={String(config.version)} />
          <Row label="Active profile" value={activeProfile?.name ?? config.activeProfile ?? "none"} />
        </Box>
      </Box>

      {/* Profiles section */}
      <Box flexDirection="column">
        <SectionLabel>Profiles</SectionLabel>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={colors.border}
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.bgPanel}
          gap={0}
        >
          <Row label="Total" value={String(profiles.length)} />
          <Row
            label="Authenticated"
            value={String(profiles.filter((p) => p.credential?.authenticated).length)}
          />
        </Box>
      </Box>

      {/* Controls section */}
      <Box flexDirection="column">
        <SectionLabel>Keyboard Shortcuts</SectionLabel>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={colors.border}
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.bgPanel}
          gap={0}
        >
          <Row label="tab" value="Switch focus between sidebar and content" />
          <Row label="t" value="Toggle dark / light theme" />
          <Row label="enter" value="Launch selected profile from the queue" />
          <Row label="q" value="Quit the dashboard" />
        </Box>
      </Box>
    </Box>
  );
}
