import { type ReactNode, useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { getConfigPath, getSharedSettingsPath } from "../../paths.js";
import { loadConfig, saveConfig } from "../../config.js";
import { getSharedManifest, type SharedManifest } from "../../shared.js";
import { listAccounts } from "../../swap.js";
import { useTheme } from "../theme.js";
import { ScrollBox, clampOffset } from "../components/ScrollBox.js";
import type { ArcConfig } from "../../types.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  config: ArcConfig;
  profiles: ProfileEntry[];
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
  reload?: () => void;
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

interface SharedInfo {
  profileName: string;
  manifest: SharedManifest;
}

export function SettingsView({ config, profiles, focusedPane, inputEnabled, reload }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const { height: screenHeight } = useScreenSize();
  const activeProfile = profiles.find((profile) => profile.active);
  const [scrollOffset, setScrollOffset] = useState(0);

  const [sharedProfiles, setSharedProfiles] = useState<SharedInfo[]>([]);

  useEffect(() => {
    const entries: SharedInfo[] = [];
    for (const [name, profile] of Object.entries(config.profiles)) {
      const manifest = getSharedManifest(profile.configDir);
      if (manifest) {
        entries.push({ profileName: name, manifest });
      }
    }
    setSharedProfiles(entries);
  }, [config]);

  const accounts = listAccounts();
  const isActive = focusedPane === "content" && inputEnabled;

  // Build flat list of single-line renderable items
  const items: ReactNode[] = [];
  const push = (node: ReactNode) => items.push(<Box key={items.length}>{node}</Box>);
  const blank = () => push(<Text> </Text>);

  // Configuration
  push(<SectionLabel>Configuration</SectionLabel>);
  push(<Box paddingLeft={1}><Row label="Config path" value={getConfigPath()} /></Box>);
  push(<Box paddingLeft={1}><Row label="Schema version" value={String(config.version)} /></Box>);
  push(<Box paddingLeft={1}><Row label="Active profile" value={activeProfile?.name ?? config.activeProfile ?? "none"} /></Box>);
  push(<Box paddingLeft={1}><Row label="Profiles" value={`${profiles.length} total, ${profiles.filter((p) => p.credential?.authenticated).length} authenticated`} /></Box>);
  blank();

  // Shared Layer
  push(<SectionLabel>Shared Layer</SectionLabel>);
  push(<Box paddingLeft={1}><Row label="Settings path" value={getSharedSettingsPath()} /></Box>);
  push(<Box paddingLeft={1}><Row label="Synced profiles" value={String(sharedProfiles.length)} /></Box>);
  for (const { profileName, manifest } of sharedProfiles) {
    push(
      <Box paddingLeft={2}>
        <Text color={colors.dimmed} wrap="truncate">
          {profileName}: {manifest.mcpServers.length} MCPs, {manifest.commands.length} cmds
          {manifest.claudeMd ? ", CLAUDE.md" : ""}
          {manifest.memoryLinked ? ", memory" : ""}
        </Text>
      </Box>
    );
  }
  blank();

  // Hot-Swap
  push(<SectionLabel>Credential Hot-Swap (experimental)</SectionLabel>);
  if (accounts.length === 0) {
    push(<Box paddingLeft={1}><Text color={colors.dimmed}>No accounts captured. Use: arc swap capture {"<name>"}</Text></Box>);
  } else {
    for (const a of accounts) {
      push(
        <Box paddingLeft={1} gap={1}>
          <Text color={a.isActive ? colors.success : colors.dimmed}>{a.isActive ? "\u25CF" : "\u25CB"}</Text>
          <Text color={a.isActive ? colors.text : colors.dimmed} bold={a.isActive}>{a.name}</Text>
          <Text color={colors.dimmed}>{a.tool}</Text>
          {a.isActive && <Text color={colors.success}>active</Text>}
        </Box>
      );
    }
  }
  blank();

  // Preferences (toggleable)
  const settings = config.settings ?? {};
  push(<SectionLabel>Preferences (press number to toggle)</SectionLabel>);
  push(
    <Box paddingLeft={1} gap={1}>
      <Text color={colors.primary} bold>[1]</Text>
      <Text color={settings.confirmLaunch ? colors.success : colors.dimmed}>
        {settings.confirmLaunch ? "\u25CF on " : "\u25CB off"}
      </Text>
      <Text color={colors.text}>Confirm before launch</Text>
      <Text color={colors.dimmed}> — show flags summary before spawning</Text>
    </Box>
  );
  blank();

  // Keyboard Shortcuts
  push(<SectionLabel>Keyboard Shortcuts</SectionLabel>);
  push(<Box paddingLeft={1}><Row label="tab" value="Switch sidebar / content focus" /></Box>);
  push(<Box paddingLeft={1}><Row label="ctrl+p" value="Command palette" /></Box>);
  push(<Box paddingLeft={1}><Row label="ctrl+t" value="Toggle theme" /></Box>);
  push(<Box paddingLeft={1}><Row label="ctrl+q" value="Quit" /></Box>);
  push(<Box paddingLeft={1}><Row label="?" value="Full help overlay" /></Box>);
  blank();

  // Danger Zone
  push(<SectionLabel>Reset</SectionLabel>);
  push(
    <Box paddingLeft={1}>
      <Text color={colors.dimmed}>Remove all data: </Text>
      <Text color={colors.error} bold>arc uninstall --force</Text>
    </Box>
  );

  // Available height: screen - topbar(1) - separator(1) - viewHeader(1) - margin(1) - footerSep(1) - footer(1)
  const contentHeight = Math.max(8, screenHeight - 6);

  useInput((input, key) => {
    // Toggle settings by number
    if (input === "1") {
      const fresh = loadConfig();
      if (!fresh.settings) fresh.settings = {};
      fresh.settings.confirmLaunch = !fresh.settings.confirmLaunch;
      saveConfig(fresh);
      reload?.();
      return;
    }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      setScrollOffset((o) => clampOffset(o + 1, items.length, contentHeight));
    }
  }, { isActive });

  return <ScrollBox items={items} height={contentHeight} offset={scrollOffset} />;
}
