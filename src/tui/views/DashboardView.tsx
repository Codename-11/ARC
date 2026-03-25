import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import { ImportHint } from "../components/ImportHint.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text bold color={valueColor}>{value}</Text>
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

export function DashboardView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  const activeProfile = profiles.find((profile) => profile.active);
  const authenticatedCount = profiles.filter(
    (profile) => profile.credential?.authenticated
  ).length;
  const allAuthenticated = profiles.length > 0 && authenticatedCount === profiles.length;

  return (
    <Box flexDirection="column" gap={1}>
      {/* Active Profile section */}
      <Box flexDirection="column">
        <SectionLabel>Active Profile</SectionLabel>

        {activeProfile ? (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={colors.border}
            paddingX={2}
            paddingY={1}
            backgroundColor={colors.bgPanel}
          >
            <Box gap={2} alignItems="center">
              <Text color={colors.accent} bold>●</Text>
              <Text bold color={colors.text}>{activeProfile.name}</Text>
              <Text color={colors.border}>│</Text>
              <Text color={colors.dimmed}>{activeProfile.tool}</Text>
              <Text color={colors.border}>│</Text>
              <Text color={colors.dimmed}>{activeProfile.authType}</Text>
            </Box>
            <Box marginTop={1} paddingLeft={3}>
              {activeProfile.credential?.authenticated ? (
                <Box gap={1}>
                  <Text color={colors.accent}>✔</Text>
                  <Text color={colors.accent}>Authenticated</Text>
                  {activeProfile.credential.method && (
                    <Text color={colors.dimmed}>via {activeProfile.credential.method}</Text>
                  )}
                </Box>
              ) : activeProfile.credential?.expired ? (
                <Box gap={1}>
                  <Text color={colors.warning}>⚠</Text>
                  <Text color={colors.warning}>Credentials expired</Text>
                </Box>
              ) : (
                <Box gap={1}>
                  <Text color={colors.warning}>○</Text>
                  <Text color={colors.warning}>Not authenticated</Text>
                </Box>
              )}
            </Box>
          </Box>
        ) : (
          <Box paddingLeft={1}>
            <Text color={colors.dimmed}>No active profile set.</Text>
          </Box>
        )}
      </Box>

      {/* Stats section */}
      <Box flexDirection="column">
        <SectionLabel>Overview</SectionLabel>

        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={colors.border}
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.bgPanel}
          gap={0}
        >
          <StatRow
            label="Profiles"
            value={String(profiles.length)}
            valueColor={profiles.length > 0 ? colors.primary : colors.dimmed}
          />
          <StatRow
            label="Authenticated"
            value={`${authenticatedCount} / ${profiles.length}`}
            valueColor={allAuthenticated ? colors.accent : colors.warning}
          />
        </Box>
      </Box>

      <ImportHint profiles={profiles} />
    </Box>
  );
}
