import { exec } from "node:child_process";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { Spinner } from "@inkjs/ui";
import { ImportHint } from "../components/ImportHint.js";
import { TokenizedInput } from "../components/TokenizedInput.js";
import {
  AutoCompleteOverlay,
  resolveAutoComplete,
  applyCompletion,
  type AutoCompleteState,
} from "../components/AutoComplete.js";
import { useTheme } from "../theme.js";
import { loadConfig, saveConfig } from "../../config.js";
import { buildProfileEnv } from "../../auth.js";
import { handleLaunch } from "../../commands/launch.js";
import { markLaunchPending } from "../render.js";
import { getSharedManifest } from "../../shared.js";
import type { ProfileEntry } from "../useProfiles.js";
import type { ViewName } from "../components/Sidebar.js";

interface Props {
  profiles: ProfileEntry[];
  loading: boolean;
  reload: () => void;
  focusedPane: "sidebar" | "content";
  onViewChange: (view: ViewName) => void;
  inputEnabled: boolean;
  onTypingChange: (typing: boolean) => void;
  onCreateProfile?: () => void;
  onExitApp?: () => void;
  activity: ActivityEntry[];
  onActivityChange: (updater: (current: ActivityEntry[]) => ActivityEntry[]) => void;
}

export interface ActivityEntry {
  role: string;
  text: string;
  tone?: "default" | "success" | "warning";
}

function Section({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"─".repeat(Math.max(1, 30 - label.length))}</Text>
    </Box>
  );
}

function QueueRow({
  profile,
  selected,
}: {
  profile: ProfileEntry;
  selected: boolean;
}) {
  const { theme } = useTheme();
  const { colors } = theme;
  const status = profile.credError
    ? { icon: "✖", color: colors.error }
    : profile.credential?.expired
      ? { icon: "!", color: colors.warning }
      : profile.credential?.authenticated
        ? { icon: "●", color: colors.success }
        : { icon: "○", color: colors.dimmed };

  return (
    <Box backgroundColor={selected ? colors.bgSelected : undefined}>
      <Text color={selected ? colors.primary : colors.dimmed}>
        {selected ? " ▸ " : "   "}
      </Text>
      <Box width={12}>
        <Text color={profile.active ? colors.accent : colors.text} bold={profile.active || selected}>
          {profile.name}
        </Text>
      </Box>
      <Box width={10}>
        <Text color={colors.dimmed}>{profile.tool}</Text>
      </Box>
      <Text color={status.color}>{status.icon}</Text>
    </Box>
  );
}

export function SessionView({
  profiles,
  loading,
  reload,
  focusedPane,
  onViewChange,
  inputEnabled,
  onTypingChange,
  onCreateProfile,
  onExitApp,
  activity,
  onActivityChange: setActivity,
}: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const { width: screenWidth } = useScreenSize();
  // Content pane = screen - sidebar(20) - sidebar border(1) - content paddingX(2) - activity prefix(4)
  const maxLineWidth = Math.max(40, screenWidth - 27);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [composer, setComposer] = useState("");
  const [acState, setAcState] = useState<AutoCompleteState | null>(null);
  const activeProfile = profiles.find((profile) => profile.active) ?? profiles[0];
  const profileNames = profiles.map((p) => p.name);
  const readyProfiles = profiles.filter((profile) => profile.credential?.authenticated);
  const pendingProfiles = profiles.filter((profile) => !profile.credential?.authenticated);
  const queue = [...readyProfiles, ...pendingProfiles].slice(0, 5);
  const selectedProfile = queue[selectedIndex] ?? activeProfile;
  const isContentFocused = focusedPane === "content" && inputEnabled;

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, queue.length - 1)));
  }, [queue.length]);

  useEffect(() => {
    onTypingChange(composer.length > 0);
    if (composer.length === 0) setAcState(null);
    return () => {
      onTypingChange(false);
    };
  }, [composer.length, onTypingChange]);

  useInput(
    async (input, key) => {
      if (!isContentFocused) {
        return;
      }

      // ── Auto-complete navigation ────────────────────────────
      if (acState) {
        if (key.upArrow) {
          setAcState((s) => s ? { ...s, selectedIndex: Math.max(0, s.selectedIndex - 1) } : null);
          return;
        }
        if (key.downArrow) {
          setAcState((s) => s ? { ...s, selectedIndex: Math.min(s.suggestions.length - 1, s.selectedIndex + 1) } : null);
          return;
        }
        if (key.tab || (key.return && acState.suggestions.length > 0)) {
          const completed = applyCompletion(composer, acState);
          setComposer(completed);
          setAcState(resolveAutoComplete(completed, profileNames));
          return;
        }
        if (key.escape) {
          setAcState(null);
          return;
        }
      }

      if (key.upArrow) {
        if (queue.length === 0) {
          return;
        }
        setSelectedIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (key.downArrow) {
        if (queue.length === 0) {
          return;
        }
        setSelectedIndex((current) => Math.min(queue.length - 1, current + 1));
        return;
      }

      if (key.backspace || key.delete) {
        setComposer((current) => {
          const next = current.slice(0, -1);
          setAcState(resolveAutoComplete(next, profileNames));
          return next;
        });
        return;
      }

      if (key.escape) {
        setComposer("");
        setAcState(null);
        return;
      }

      if (key.return) {
        const value = composer.trim();

        if (!value) {
          if (!selectedProfile) {
            return;
          }

          setActivity((current) => [
            ...current,
            {
              role: "arc",
              text: `Launching ${selectedProfile.name} via ${selectedProfile.tool}.`,
              tone: "success",
            },
          ]);
          markLaunchPending();
          await handleLaunch(selectedProfile.name, [], { beforeSpawn: onExitApp });
          return;
        }

        const [command, ...args] = value.split(/\s+/);
        const targetName = args.join(" ").trim();
        const namedTarget = targetName
          ? profiles.find((profile) => profile.name === targetName)
          : undefined;
        const target = targetName ? namedTarget : selectedProfile;

        if (command === "/launch") {
          if (!target) {
            setActivity((current) => [
              ...current,
              {
                role: "arc",
                text: "No profile available to launch.",
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          if (targetName && !namedTarget) {
            setActivity((current) => [
              ...current,
              {
                role: "user",
                text: value,
              },
              {
                role: "arc",
                text: `Profile "${targetName}" was not found.`,
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Launching ${target.name} via ${target.tool}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          markLaunchPending();
          await handleLaunch(target.name, [], { beforeSpawn: onExitApp });
          return;
        }

        if (command === "/switch") {
          if (!target) {
            setActivity((current) => [
              ...current,
              {
                role: "arc",
                text: "Choose a profile with the queue or pass a name to /switch.",
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          if (targetName && !namedTarget) {
            setActivity((current) => [
              ...current,
              {
                role: "user",
                text: value,
              },
              {
                role: "arc",
                text: `Profile "${targetName}" was not found.`,
                tone: "warning",
              },
            ]);
            setComposer("");
            return;
          }

          const config = loadConfig();
          config.activeProfile = target.name;
          saveConfig(config);
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Switched active profile to ${target.name}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          reload();
          return;
        }

        if (command === "/dash" || command === "/profiles" || command === "/doctor" || command === "/settings") {
          const destination = command.slice(1) as ViewName;
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: `Opening ${destination}.`,
              tone: "success",
            },
          ]);
          setComposer("");
          onViewChange(destination);
          return;
        }

        if (command === "/help") {
          setActivity((current) => [
            ...current,
            {
              role: "user",
              text: value,
            },
            {
              role: "arc",
              text: "Ctrl+P for palette, Ctrl+T for theme, Ctrl+Q to quit. Enter launches the selected profile. /switch changes the active profile.",
              tone: "success",
            },
          ]);
          setComposer("");
          return;
        }

        if (command === "/status") {
          setActivity((current) => {
            const lines: ActivityEntry[] = [
              { role: "user", text: value },
            ];
            if (!activeProfile) {
              lines.push({ role: "arc", text: "No active profile.", tone: "warning" });
              return [...current, ...lines];
            }
            const cfg = loadConfig();
            const profile = cfg.profiles[activeProfile.name];
            const authLabel = activeProfile.credential?.authenticated
              ? "ready" : activeProfile.credential?.expired
                ? "expired" : "not set";
            const tierSuffix = activeProfile.credential?.accountTier
              ? `, ${activeProfile.credential.accountTier}` : "";
            const flags = profile?.launchArgs?.length
              ? profile.launchArgs.join(" ")
              : "none";
            const manifest = profile ? getSharedManifest(profile.configDir) : null;
            const sharedLabel = manifest
              ? `enabled (${manifest.mcpServers.length} MCPs)`
              : "disabled";
            const configDir = profile?.configDir ?? "unknown";

            lines.push(
              { role: "arc", text: `Profile: ${activeProfile.name} (${activeProfile.tool})` },
              { role: "arc", text: `Auth: ${activeProfile.authType} (${authLabel}${tierSuffix})` },
              { role: "arc", text: `Flags: ${flags}` },
              { role: "arc", text: `Shared: ${sharedLabel}` },
              { role: "arc", text: `Config: ${configDir}` },
            );
            return [...current, ...lines];
          });
          setComposer("");
          return;
        }

        if (command === "/create") {
          setComposer("");
          if (onCreateProfile) {
            onCreateProfile();
          } else {
            setActivity((current) => [
              ...current,
              { role: "user", text: value },
              { role: "arc", text: "Profile creation is not available.", tone: "warning" },
            ]);
          }
          return;
        }

        if (command === "/clear") {
          setActivity(() => []);
          setComposer("");
          return;
        }

        // Unknown /command → show help
        if (value.startsWith("/")) {
          setActivity((current) => [
            ...current,
            { role: "user", text: value },
            {
              role: "arc",
              text: "Commands: /launch, /switch, /status, /dash, /profiles, /doctor, /settings, /help, /create, /clear. Or type shell commands directly.",
              tone: "warning",
            },
          ]);
          setComposer("");
          return;
        }

        // ── Shell command execution ────────────────────────
        // Non-slash input → run as shell command with active profile env
        if (!activeProfile) {
          setActivity((current) => [
            ...current,
            { role: "user", text: value },
            { role: "arc", text: "No active profile. Create one first.", tone: "warning" },
          ]);
          setComposer("");
          return;
        }

        setActivity((current) => [
          ...current,
          { role: "user", text: value },
          { role: "arc", text: "Running...", tone: "default" },
        ]);
        setComposer("");

        const config = loadConfig();
        const profile = config.profiles[activeProfile.name];
        if (!profile) return;

        const profileEnv = await buildProfileEnv(profile, activeProfile.name);
        // On Windows, wrap in cmd /c so .cmd/.bat scripts resolve properly.
        const shellCmd = process.platform === "win32" ? `cmd /c ${value}` : value;
        exec(shellCmd, {
          env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
          timeout: 30_000,
          maxBuffer: 1024 * 256,
        }, (_err, stdout, stderr) => {
          const raw = (stdout || stderr || "").trim();
          // Strip ANSI escape sequences so they don't corrupt Ink's rendering
          const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          setActivity((current) => {
            const filtered = current.slice(0, -1);
            if (clean) {
              const lineMax = maxLineWidth;
              const lines = clean.split("\n")
                .map((l) => l.trimEnd())
                .filter((l) => l.length > 0)
                .slice(0, 8)
                .map((l) => l.length > lineMax ? l.slice(0, lineMax - 3) + "..." : l);
              const truncated = clean.split("\n").filter((l) => l.trim()).length > 8;
              return [
                ...filtered,
                ...lines.map((line) => ({ role: "shell" as string, text: line, tone: "default" as const })),
                ...(truncated ? [{ role: "arc" as string, text: `(${clean.split("\n").filter((l) => l.trim()).length - 8} more lines truncated)`, tone: "default" as const }] : []),
              ];
            }
            return [
              ...filtered,
              { role: "arc", text: _err ? `Error: ${_err.message}` : "Done (no output).", tone: _err ? "warning" as const : "success" as const },
            ];
          });
        });
        return;
      }

      if (!key.ctrl && !key.meta && input.length === 1) {
        setComposer((current) => {
          const next = current + input;
          setAcState(resolveAutoComplete(next, profileNames));
          return next;
        });
      }
    },
    { isActive: isContentFocused }
  );

  if (loading) {
    return (
      <Box paddingY={1}>
        <Spinner label="Building workspace..." />
      </Box>
    );
  }

  const statusIcon = activeProfile?.credential?.authenticated
    ? { icon: "●", color: colors.success, label: "ready" }
    : activeProfile?.credential?.expired
      ? { icon: "!", color: colors.warning, label: "credentials expired" }
      : activeProfile
        ? { icon: "○", color: colors.warning, label: "needs setup" }
        : { icon: "—", color: colors.dimmed, label: "no active profile" };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Active profile status */}
      {activeProfile ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box gap={2}>
            <Text color={statusIcon.color}>{statusIcon.icon}</Text>
            <Text color={colors.text} bold>{activeProfile.name}</Text>
            <Text color={colors.dimmed}>{activeProfile.tool}</Text>
            <Text color={colors.dimmed}>{activeProfile.authType}</Text>
            <Text color={statusIcon.color}>{statusIcon.label}</Text>
          </Box>
        </Box>
      ) : (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color={colors.dimmed}>No active profile. Use </Text>
            <Text color={colors.primary} bold>arc run claude</Text>
            <Text color={colors.dimmed}> for native launch,</Text>
          </Box>
          <Box>
            <Text color={colors.dimmed}>or switch to a profile (press </Text>
            <Text color={colors.primary} bold>c</Text>
            <Text color={colors.dimmed}> to create one).</Text>
          </Box>
        </Box>
      )}

      {/* Activity log — grows to fill space */}
      <Box flexDirection="column" flexGrow={1}>
        {activity.length > 0 ? (
          activity.slice(-12).map((entry, index) => {
            const toneColor =
              entry.tone === "success" ? colors.success
              : entry.tone === "warning" ? colors.warning
              : colors.dimmed;

            const prefix = entry.role === "shell" ? "$" : entry.role === "user" ? ">" : "\u203A";

            return (
              <Box key={`act-${index}`}>
                <Box width={4} flexShrink={0}>
                  <Text color={entry.role === "shell" ? colors.text : toneColor}>{prefix}</Text>
                </Box>
                <Text color={entry.role === "shell" ? colors.dimmed : colors.text} wrap="truncate">{entry.text}</Text>
              </Box>
            );
          })
        ) : (
          <Text color={colors.dimmed}>
            Type a /command or shell command. Enter launches the selected profile.
          </Text>
        )}
      </Box>

      {/* Profiles queue */}
      <Section label="profiles" />
      <Box flexDirection="column">
        {queue.length > 0 ? (
          queue.map((profile, index) => (
            <QueueRow
              key={profile.name}
              profile={profile}
              selected={index === selectedIndex}
            />
          ))
        ) : (
          <Text color={colors.dimmed}>  No profiles configured.</Text>
        )}
      </Box>

      {/* Auto-complete overlay */}
      {acState && (
        <AutoCompleteOverlay state={acState} colors={colors} maxWidth={Math.min(40, maxLineWidth)} />
      )}

      {/* Command input */}
      <Section label="command" />
      <Box>
        <Text color={colors.primary} bold>{"› "}</Text>
        {composer ? (
          <TokenizedInput
            input={composer}
            colors={colors}
            validation={{
              commands: ["/launch", "/switch", "/status", "/dash", "/profiles", "/doctor", "/settings", "/help", "/create", "/clear"],
              profiles: profileNames,
            }}
          />
        ) : (
          <Text color={colors.dimmed}>
            {activeProfile
              ? `/launch ${activeProfile.name}`
              : "/help for commands"}
          </Text>
        )}
      </Box>

      <ImportHint profiles={profiles} />
    </Box>
  );
}
