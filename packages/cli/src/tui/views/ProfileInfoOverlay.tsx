import { Box, Text, useInput } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";
import { getSharedManifest } from "../../shared.js";
import type { ProfileEntry } from "../useProfiles.js";
import type { Profile } from "../../types.js";

interface Props {
  entry: ProfileEntry;
  profile: Profile;
  onClose: () => void;
}

export function ProfileInfoOverlay({ entry, profile, onClose }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  // Credential status
  let credentialLabel: string;
  let credentialColor: string;
  if (entry.credError) {
    credentialLabel = "error reading credentials";
    credentialColor = colors.error;
  } else if (!entry.credential) {
    credentialLabel = "not set";
    credentialColor = colors.dimmed;
  } else if (entry.credential.expired) {
    credentialLabel = "expired";
    credentialColor = colors.warning;
  } else if (entry.credential.authenticated) {
    credentialLabel = "authenticated";
    credentialColor = colors.success;
  } else {
    credentialLabel = "not authenticated";
    credentialColor = colors.dimmed;
  }

  // Shared layer
  const manifest = getSharedManifest(profile.configDir);
  let sharedLabel: string;
  if (!manifest) {
    sharedLabel = "disabled";
  } else {
    const parts: string[] = [];
    if (manifest.mcpServers.length > 0) parts.push(`${manifest.mcpServers.length} MCPs`);
    if (manifest.commands.length > 0) parts.push(`${manifest.commands.length} commands`);
    if (manifest.claudeMd) parts.push("CLAUDE.md");
    if (manifest.memoryLinked) parts.push("memory");
    if (manifest.projectsLinked) parts.push("projects");
    sharedLabel = parts.length > 0 ? `enabled (${parts.join(", ")})` : "enabled (empty)";
  }

  // Launch flags
  const flagsLabel =
    profile.launchArgs && profile.launchArgs.length > 0
      ? profile.launchArgs.join(" ")
      : "none";

  // Account tier
  const tierLabel = entry.credential?.accountTier ?? "unknown";

  return (
    <Overlay title={entry.name} subtitle="Profile Info">
      <Box flexDirection="column">
        {/* Tool & auth */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Tool:</Text>
          <Text color={colors.text}>{entry.tool}</Text>
        </Box>
        <Box gap={1}>
          <Text color={colors.dimmed}>Auth type:</Text>
          <Text color={colors.text}>{entry.authType}</Text>
        </Box>

        {/* Account tier */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Account tier:</Text>
          <Text color={colors.text}>{tierLabel}</Text>
        </Box>

        {/* Credential status */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Credentials:</Text>
          <Text color={credentialColor}>{credentialLabel}</Text>
        </Box>

        {/* Config directory */}
        <Box gap={1} marginTop={1}>
          <Text color={colors.dimmed}>Config dir:</Text>
          <Text color={colors.text} wrap="truncate">{profile.configDir}</Text>
        </Box>

        {/* Launch flags */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Launch flags:</Text>
          <Text color={colors.text}>{flagsLabel}</Text>
        </Box>

        {/* Shared layer */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Shared layer:</Text>
          <Text color={manifest ? colors.success : colors.dimmed}>{sharedLabel}</Text>
        </Box>

        {/* Description */}
        {profile.description && (
          <Box gap={1} marginTop={1}>
            <Text color={colors.dimmed}>Description:</Text>
            <Text color={colors.text}>{profile.description}</Text>
          </Box>
        )}

        {/* Created date */}
        <Box gap={1} marginTop={profile.description ? 0 : 1}>
          <Text color={colors.dimmed}>Created:</Text>
          <Text color={colors.text}>
            {new Date(profile.createdAt).toLocaleDateString()}
          </Text>
        </Box>

        {/* Key hints */}
        <Box marginTop={1} gap={2}>
          <Box gap={0}>
            <Text color={colors.primary} bold>[esc]</Text>
            <Text color={colors.dimmed}> close</Text>
          </Box>
        </Box>
      </Box>
    </Overlay>
  );
}
