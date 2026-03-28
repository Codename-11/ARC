import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";
import { FullLogo, LogoWithArc } from "../components/ArcLogo.js";
import { VERSION } from "../../version.js";
import { ImportHint } from "../components/ImportHint.js";
import { detectToolConfigs, type DetectedTool } from "../../detect.js";
import { checkForUpdate, type UpdateInfo } from "../../update.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
  onTriggerUpdate?: () => void;
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

function WelcomeView() {
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const [detected, setDetected] = useState<DetectedTool[]>([]);

  useEffect(() => {
    setDetected(detectToolConfigs());
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Logo */}
      <FullLogo />

      {/* Welcome message */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.text} bold>Welcome to ARC — (Agent Runtime Control)</Text>
        <Text color={colors.dimmed}>
          v{VERSION} · {isDark ? "carbon" : "photon"}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.dimmed}>
          Manage agent profiles for Claude, Gemini, Codex, and more.
        </Text>
      </Box>

      {/* Detected tools section */}
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={colors.dimmed}>detected tools</Text>
          <Text color={colors.border}>{"─".repeat(14)}</Text>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          {detected.length > 0 ? (
            detected.map((d) => (
              <Box key={d.tool} gap={1}>
                <Text color={colors.success}>{"✔"}</Text>
                <Box width={16}>
                  <Text color={colors.text}>{d.displayName}</Text>
                </Box>
                <Text color={colors.dimmed}>{d.configDir}</Text>
              </Box>
            ))
          ) : (
            <Text color={colors.dimmed}>No existing tool configs found.</Text>
          )}
        </Box>
      </Box>

      {/* Call to action */}
      <Box flexDirection="column">
        <Box gap={1} marginBottom={1}>
          <Text color={colors.dimmed}>get started</Text>
          <Text color={colors.border}>{"─".repeat(16)}</Text>
        </Box>
        <Box flexDirection="column" paddingLeft={1}>
          <Box gap={1}>
            <Text color={colors.primary} bold>c</Text>
            <Text color={colors.dimmed}>→</Text>
            <Text color={colors.text}>
              {detected.length > 0
                ? "create your first profile — detected configs can be imported"
                : "create your first profile"}
            </Text>
          </Box>
          <Box gap={1}>
            <Text color={colors.primary} bold>tab</Text>
            <Text color={colors.dimmed}>→</Text>
            <Text color={colors.text}>switch to sidebar, arrow keys to navigate views</Text>
          </Box>
          <Box gap={1}>
            <Text color={colors.primary} bold>ctrl+p</Text>
            <Text color={colors.dimmed}>→</Text>
            <Text color={colors.text}>open the command palette</Text>
          </Box>
          <Box gap={1}>
            <Text color={colors.primary} bold>ctrl+q</Text>
            <Text color={colors.dimmed}>→</Text>
            <Text color={colors.text}>quit</Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={colors.dimmed}>github.com/Codename-11/ARC</Text>
      </Box>
    </Box>
  );
}

export function DashView({ profiles, onTriggerUpdate }: Props) {
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const { height: screenHeight } = useScreenSize();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    checkForUpdate().then((info) => {
      if (info?.updateAvailable) setUpdateInfo(info);
    }).catch(() => {});
  }, []);

  if (profiles.length === 0) {
    return <WelcomeView />;
  }

  const activeProfile = profiles.find((p) => p.active);
  const readyCount = profiles.filter((p) => p.credential?.authenticated).length;
  const expiredCount = profiles.filter((p) => p.credential?.expired).length;
  const showQuickStart = screenHeight >= 28;

  const activeToolLabel = activeProfile
    ? (activeProfile.tool === "claude" ? "Claude Code"
      : activeProfile.tool === "gemini" ? "Gemini CLI"
      : activeProfile.tool === "codex" ? "Codex CLI"
      : activeProfile.tool)
    : undefined;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* [>] ARC logo */}
      <LogoWithArc />
      <Text color={colors.text} bold>Agent Runtime Control</Text>
      <Box marginBottom={1}>
        <Text color={colors.dimmed}>v{VERSION} {"\u00B7"} {isDark ? "carbon" : "photon"}</Text>
      </Box>

      {/* Profile summary */}
      <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
        <StatusRow label="profiles" value={String(profiles.length)} />
        <StatusRow
          label="authenticated"
          value={`${readyCount}/${profiles.length}`}
          color={readyCount === profiles.length && profiles.length > 0 ? colors.success : colors.warning}
        />
        {expiredCount > 0 && (
          <StatusRow
            label="expired"
            value={String(expiredCount)}
            color={colors.error}
          />
        )}
      </Box>

      {/* Active profile details */}
      <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
        <StatusRow
          label="active"
          value={activeProfile?.name ?? "none"}
          color={activeProfile ? colors.text : colors.dimmed}
        />
        {activeToolLabel && (
          <StatusRow label="tool" value={activeToolLabel} />
        )}
        {activeProfile?.credential?.accountTier && (
          <StatusRow label="account" value={activeProfile.credential.accountTier} />
        )}
      </Box>

      {/* Import hint (if unimported tools detected) */}
      <ImportHint profiles={profiles} />

      {/* Update available banner */}
      {updateInfo && (
        <Box paddingLeft={2} paddingTop={1}>
          <Text>
            <Text color={colors.warning}>{"\u2191"} </Text>
            <Text>Update available: v{updateInfo.current} {"\u2192"} v{updateInfo.latest}. </Text>
            {onTriggerUpdate ? (
              <Text>Press <Text bold color={colors.primary}>u</Text> to update.</Text>
            ) : (
              <Text>Run <Text bold color={colors.primary}>arc update</Text>.</Text>
            )}
          </Text>
        </Box>
      )}

      {/* Quick actions — hidden when terminal is short */}
      {showQuickStart && (
        <Box flexDirection="column">
          <Box gap={1} marginBottom={1}>
            <Text color={colors.dimmed}>quick start</Text>
            <Text color={colors.border}>{"─".repeat(16)}</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={1}>
            <Box gap={1}>
              <Text color={colors.primary} bold>tab</Text>
              <Text color={colors.dimmed}>→</Text>
              <Text color={colors.text}>switch to sidebar, arrow keys to navigate views</Text>
            </Box>
            <Box gap={1}>
              <Text color={colors.primary} bold>ctrl+p</Text>
              <Text color={colors.dimmed}>→</Text>
              <Text color={colors.text}>open the command palette</Text>
            </Box>
            <Box gap={1}>
              <Text color={colors.primary} bold>enter</Text>
              <Text color={colors.dimmed}>→</Text>
              <Text color={colors.text}>launch active profile</Text>
            </Box>
          </Box>
        </Box>
      )}

      <Box marginTop={showQuickStart ? 1 : 0}>
        <Text color={colors.dimmed}>github.com/Codename-11/ARC</Text>
      </Box>
    </Box>
  );
}
