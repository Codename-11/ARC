import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme, type ThemeColors } from "../theme.js";
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

/* ── Welcome View (0 profiles) ─────────────────────────────────────── */

function WelcomeView() {
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const [detected, setDetected] = useState<DetectedTool[]>([]);

  useEffect(() => {
    setDetected(detectToolConfigs());
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <FullLogo />
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.text} bold>Welcome to ARC — (Agent Runtime Control)</Text>
        <Text color={colors.dimmed}>v{VERSION} · {isDark ? "carbon" : "photon"}</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.dimmed}>
          Manage agent profiles for Claude, Gemini, Codex, and more.
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <SectionHeader label="detected tools" />
        <Box flexDirection="column" paddingLeft={2}>
          {detected.length > 0 ? (
            detected.map((d) => (
              <Box key={d.tool} gap={1}>
                <Text color={colors.success}>{"✔"}</Text>
                <Box width={16}><Text color={colors.text}>{d.displayName}</Text></Box>
                <Text color={colors.dimmed}>{d.configDir}</Text>
              </Box>
            ))
          ) : (
            <Text color={colors.dimmed}>No existing tool configs found.</Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="column">
        <SectionHeader label="get started" />
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
        </Box>
      </Box>
    </Box>
  );
}

/* ── Left Column: identity ─────────────────────────────────────────── */

function LeftColumn({ profiles, colors, isDark }: {
  profiles: ProfileEntry[];
  colors: ThemeColors;
  isDark: boolean;
}) {
  const activeProfile = profiles.find((p) => p.active);
  const readyCount = profiles.filter((p) => p.credential?.authenticated).length;
  const expiredCount = profiles.filter((p) => p.credential?.expired).length;

  const activeToolLabel = activeProfile
    ? (activeProfile.tool === "claude" ? "Claude Code"
      : activeProfile.tool === "gemini" ? "Gemini CLI"
      : activeProfile.tool === "codex" ? "Codex CLI"
      : activeProfile.tool)
    : undefined;

  return (
    <Box flexDirection="column">
      <Text color={colors.text} bold>Agent Runtime Control</Text>
      <Box marginBottom={1}>
        <Text color={colors.dimmed}>v{VERSION} · {isDark ? "carbon" : "photon"}</Text>
      </Box>

      <SectionHeader label="profiles" />
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="total" value={String(profiles.length)} />
        <StatusRow
          label="authenticated"
          value={`${readyCount}/${profiles.length}`}
          color={readyCount === profiles.length && profiles.length > 0 ? colors.success : colors.warning}
        />
        {expiredCount > 0 && (
          <StatusRow label="expired" value={String(expiredCount)} color={colors.error} />
        )}
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
    </Box>
  );
}

/* ── Right Column: pipeline + status ───────────────────────────────── */

function RightColumn({ colors }: { colors: ThemeColors }) {
  // TODO: Wire to real hook runner state + data stores
  // For now, show idle/empty state — don't fake activity

  return (
    <Box flexDirection="column">
      <SectionHeader label="hook pipeline" />
      <Box gap={1} paddingLeft={1}>
        <Text color={colors.border}>{"░".repeat(5)}</Text>
        <Text color={colors.border}>{"░".repeat(5)}</Text>
        <Text color={colors.border}>{"░".repeat(5)}</Text>
        <Text color={colors.border}>{"░".repeat(5)}</Text>
      </Box>
      <Box gap={1} paddingLeft={1} marginBottom={1}>
        <Box width={6}><Text color={colors.dimmed}> PRE</Text></Box>
        <Box width={6}><Text color={colors.dimmed}> VAL</Text></Box>
        <Box width={6}><Text color={colors.dimmed}> POST</Text></Box>
        <Box width={6}><Text color={colors.dimmed}> DONE</Text></Box>
      </Box>
      <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
        <StatusRow label="mode" value="—" />
        <StatusRow label="circuit" value="—" />
      </Box>

      <SectionHeader label="status" />
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="HOOKS" value="0" />
        <StatusRow label="TASKS" value="0" />
        <StatusRow label="MEMORY" value="0" />
        <StatusRow label="SESSIONS" value="0" />
        <StatusRow label="SYNC" value="—" />
      </Box>
    </Box>
  );
}

/* ── Main DashView ─────────────────────────────────────────────────── */

export function DashView({ profiles, onTriggerUpdate }: Props) {
  const { theme, isDark } = useTheme();
  const { colors } = theme;
  const { height: screenHeight, width: screenWidth } = useScreenSize();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    checkForUpdate().then((info) => {
      if (info?.updateAvailable) setUpdateInfo(info);
    }).catch(() => {});
  }, []);

  if (profiles.length === 0) {
    return <WelcomeView />;
  }

  // 2-col when content pane is wide enough
  const useTwoCol = screenWidth >= 100;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <LogoWithArc />

      {useTwoCol ? (
        <Box flexGrow={1}>
          <Box flexDirection="column" width={36} marginRight={2}>
            <LeftColumn profiles={profiles} colors={colors} isDark={isDark} />
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <RightColumn colors={colors} />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1}>
          <LeftColumn profiles={profiles} colors={colors} isDark={isDark} />
          <Box marginTop={1}>
            <RightColumn colors={colors} />
          </Box>
        </Box>
      )}

      {/* Import hint — subtle, below the columns */}
      <ImportHint profiles={profiles} />

      {/* Update banner */}
      {updateInfo && (
        <Box paddingLeft={1} paddingTop={1}>
          <Text>
            <Text color={colors.warning}>{"\u2191"} </Text>
            <Text>v{updateInfo.current} → v{updateInfo.latest} </Text>
            {onTriggerUpdate ? (
              <Text>Press <Text bold color={colors.primary}>u</Text> to update.</Text>
            ) : (
              <Text>Run <Text bold color={colors.primary}>arc update</Text>.</Text>
            )}
          </Text>
        </Box>
      )}
    </Box>
  );
}
