import { useCallback, useEffect, useState } from "react";
import fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { ProfileList } from "../components/ProfileList.js";
import { saveConfig, loadConfig, cloneProfile } from "../../config.js";
import { syncSharedToProfile, unsyncSharedFromProfile, getSharedManifest, pullProfileToShared } from "../../shared.js";
import { RENDER_DEFER_MS, validateName } from "../createProfile.js";
import type { ProfileEntry } from "../useProfiles.js";

type Action = "idle" | "launching" | "confirm-delete" | "edit-flags" | "clone";

interface Props {
  profiles: ProfileEntry[];
  loading: boolean;
  reload: () => void;
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
  onCreateProfile?: () => void;
  onExitApp?: () => void;
  onShowInfo?: (name: string) => void;
}

export function ProfilesView({
  profiles,
  loading,
  onCreateProfile,
  onExitApp,
  reload,
  focusedPane,
  inputEnabled,
  onShowInfo,
}: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [action, setAction] = useState<Action>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [flagsInput, setFlagsInput] = useState("");
  const [cloneSource, setCloneSource] = useState<string | null>(null);
  const [cloneInput, setCloneInput] = useState("");

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 2000);
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, profiles.length - 1)));
  }, [profiles.length]);

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      if (action === "confirm-delete" && deleteTarget) {
        if (input === "y") {
          try {
            const config = loadConfig();
            const profileDir = config.profiles[deleteTarget]?.configDir;

            delete config.profiles[deleteTarget];

            if (config.activeProfile === deleteTarget) {
              const remaining = Object.keys(config.profiles);
              config.activeProfile = remaining[0] ?? "default";
            }

            saveConfig(config);

            if (profileDir) {
              try {
                fs.rmSync(profileDir, { recursive: true, force: true });
              } catch {
                // Ignore missing or inaccessible directories.
              }
            }

            showMessage(`Deleted ${deleteTarget}`);
            reload();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`Delete failed: ${msg}`);
          }

          setDeleteTarget(null);
          setAction("idle");
          return;
        }

        if (input === "n" || key.escape) {
          setDeleteTarget(null);
          setAction("idle");
          showMessage("Delete cancelled");
        }

        return;
      }

      // ── Clone mode ──
      if (action === "clone") {
        if (key.escape) {
          setAction("idle");
          setCloneInput("");
          setCloneSource(null);
          showMessage("Clone cancelled");
          return;
        }
        if (key.return) {
          const src = cloneSource;
          const dst = cloneInput.trim();
          if (!src) {
            setAction("idle");
            setCloneInput("");
            setCloneSource(null);
            return;
          }
          try {
            const config = loadConfig();
            const nameError = validateName(dst, Object.keys(config.profiles));
            if (nameError) {
              showMessage(nameError);
              return;
            }
            const updated = cloneProfile(config, src, dst, { copyConfigDir: true });
            saveConfig(updated);
            showMessage(`Cloned ${src} → ${dst}`);
            reload();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`Clone failed: ${msg}`);
          }
          setAction("idle");
          setCloneInput("");
          setCloneSource(null);
          return;
        }
        if (key.backspace || key.delete) {
          setCloneInput((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input.length === 1) {
          setCloneInput((v) => v + input);
        }
        return;
      }

      // ── Edit flags mode ──
      if (action === "edit-flags") {
        if (key.escape) {
          setAction("idle");
          setFlagsInput("");
          return;
        }
        if (key.return) {
          try {
            const selected = profiles[selectedIndex];
            if (!selected) return;
            const config = loadConfig();
            const profile = config.profiles[selected.name];
            if (!profile) return;
            const trimmed = flagsInput.trim();
            if (trimmed) {
              profile.launchArgs = trimmed.split(/\s+/);
              showMessage(`Flags set: ${trimmed}`);
            } else {
              profile.launchArgs = undefined;
              showMessage("Flags cleared");
            }
            saveConfig(config);
            reload();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`Failed: ${msg}`);
          }
          setAction("idle");
          setFlagsInput("");
          return;
        }
        if (key.backspace || key.delete) {
          setFlagsInput((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input.length === 1) {
          setFlagsInput((v) => v + input);
        }
        return;
      }

      if (action !== "idle") return;

      if (key.upArrow) {
        setSelectedIndex((index) => Math.max(0, index - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((index) => Math.min(profiles.length - 1, index + 1));
        return;
      }

      if (profiles.length === 0) return;

      const selected = profiles[selectedIndex];
      if (!selected) return;

      if (key.return) {
        setAction("launching");
        setTimeout(async () => {
          try {
            const [{ handleLaunch }, { markLaunchPending }] = await Promise.all([
              import("../../commands/launch.js"),
              import("../render.js"),
            ]);
            markLaunchPending();
            await handleLaunch(selected.name, [], { beforeSpawn: onExitApp });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`Launch failed: ${msg}`);
          }
          setAction("idle");
        }, RENDER_DEFER_MS);
        return;
      }

      if (input === "s") {
        try {
          const config = loadConfig();
          config.activeProfile = selected.name;
          saveConfig(config);
          showMessage(`Switched to ${selected.name}`);
          reload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Switch failed: ${msg}`);
        }
        return;
      }

      // [C] clone profile (uppercase — lowercase `c` still means create)
      if (input === "C") {
        setCloneSource(selected.name);
        setCloneInput("");
        setAction("clone");
        return;
      }

      if (input === "c") {
        onCreateProfile?.();
        return;
      }

      if (input === "d") {
        if (profiles.length <= 1) {
          showMessage("Cannot delete the only remaining profile");
          return;
        }

        setDeleteTarget(selected.name);
        setAction("confirm-delete");
        return;
      }

      // [S] set as shared sync source
      if (input === "S") {
        try {
          const config = loadConfig();
          if (config.sharedSource === selected.name) {
            config.sharedSource = undefined;
            saveConfig(config);
            showMessage(`Removed ${selected.name} as sync source`);
          } else {
            config.sharedSource = selected.name;
            saveConfig(config);
            showMessage(`${selected.name} set as sync source — shift+h to push now`);
          }
          reload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Failed: ${msg}`);
        }
        return;
      }

      // [H] push profile config to shared layer
      if (input === "H") {
        try {
          const config = loadConfig();
          const profile = config.profiles[selected.name];
          if (!profile) return;
          const result = pullProfileToShared(profile.configDir, selected.tool);
          const parts: string[] = [];
          if (result.mcpServers.length) parts.push(`${result.mcpServers.length} MCPs`);
          if (result.commands.length) parts.push(`${result.commands.length} cmds`);
          if (result.adapterArtifacts.length) parts.push(`${result.adapterArtifacts.length} artifacts`);
          if (parts.length > 0) {
            showMessage(`Pushed to shared: ${parts.join(", ")}. Press h on other profiles to sync.`);
          } else {
            showMessage("No MCPs, commands, or artifacts found to share.");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Push to shared failed: ${msg}`);
        }
        return;
      }

      // [h] toggle shared layer
      if (input === "h") {
        try {
          const config = loadConfig();
          const profile = config.profiles[selected.name];
          if (!profile) return;
          const manifest = getSharedManifest(profile.configDir);
          if (manifest) {
            unsyncSharedFromProfile(profile.configDir);
            showMessage(`Shared layer disabled for ${selected.name}`);
          } else {
            const syncResult = syncSharedToProfile(profile.configDir, {}, selected.tool);
            // Show what was synced
            const newManifest = getSharedManifest(profile.configDir);
            if (newManifest) {
              const parts: string[] = [];
              if (newManifest.mcpServers.length) parts.push(`${newManifest.mcpServers.length} MCPs`);
              if (newManifest.commands.length) parts.push(`${newManifest.commands.length} cmds`);
              if (newManifest.claudeMd) parts.push("CLAUDE.md");
              if (newManifest.memoryLinked) parts.push("memory");
              if (newManifest.projectsLinked) parts.push("projects");
              const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
              const warn = syncResult.warning ? ` \u26A0 ${syncResult.warning}` : "";
              showMessage(`Shared layer enabled for ${selected.name}${detail}${warn}`);
            } else {
              showMessage(`Shared layer enabled for ${selected.name}`);
            }
          }
          reload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Shared layer error: ${msg}`);
        }
        return;
      }

      // [f] edit launch flags
      if (input === "f") {
        const config = loadConfig();
        const profile = config.profiles[selected.name];
        setFlagsInput(profile?.launchArgs?.join(" ") ?? "");
        setAction("edit-flags");
        return;
      }

      // [i] show profile info overlay
      if (input === "i") {
        onShowInfo?.(selected.name);
        return;
      }

      // [m] toggle launch mode (native <-> worker)
      if (input === "m") {
        try {
          const config = loadConfig();
          const profile = config.profiles[selected.name];
          if (!profile) return;
          const current = profile.launchMode ?? "native";
          const next: "native" | "worker" = current === "native" ? "worker" : "native";
          profile.launchMode = next;
          saveConfig(config);
          showMessage(`Launch mode: ${next}`);
          reload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Toggle failed: ${msg}`);
        }
        return;
      }
    },
    { isActive: isActive && inputEnabled }
  );

  // Profile detail for selected profile
  const selectedProfile = profiles[selectedIndex];
  const currentConfig = !loading ? loadConfig() : undefined;
  const selectedConfig = selectedProfile && currentConfig ? currentConfig.profiles[selectedProfile.name] : undefined;
  const selectedManifest = selectedConfig ? getSharedManifest(selectedConfig.configDir) : null;
  const isSyncSource = selectedProfile && currentConfig?.sharedSource === selectedProfile.name;

  return (
    <Box flexDirection="column" marginTop={1}>
      {loading ? (
        <Box paddingY={1} paddingLeft={2} gap={1}>
          <Spinner label="Loading profiles…" />
        </Box>
      ) : (
        <ProfileList profiles={profiles} selectedIndex={selectedIndex} sharedSource={currentConfig?.sharedSource} />
      )}

      {/* Profile detail panel for selected profile */}
      {!loading && selectedProfile && action === "idle" && (
        <Box paddingLeft={2} paddingTop={1} flexDirection="column">
          {/* Sync source badge */}
          {isSyncSource && (
            <Text color={colors.primary} bold>{"\u2605"} sync source — shared layer auto-pulls from this profile</Text>
          )}
          {/* Launch mode indicator */}
          <Text color={colors.dimmed}>
            launch: <Text color={colors.text}>[{selectedConfig?.launchMode ?? "native"}]</Text>
          </Text>
          {/* Shared layer status */}
          {selectedManifest ? (
            <Box gap={2}>
              <Text color={colors.success}>{"\u29C9"} shared</Text>
              {(() => {
                const parts: string[] = [];
                if (selectedManifest.mcpServers.length > 0)
                  parts.push(`${selectedManifest.mcpServers.length} MCPs (${selectedManifest.mcpServers.join(", ")})`);
                if (selectedManifest.commands.length > 0)
                  parts.push(`${selectedManifest.commands.length} commands`);
                if (selectedManifest.claudeMd) parts.push("CLAUDE.md");
                if (selectedManifest.memoryLinked) parts.push("memory");
                if (selectedManifest.projectsLinked) parts.push("projects");
                if (parts.length === 0) {
                  return <Text color={colors.dimmed}>enabled but empty — add config to ~/.arc/shared/ or press shift+h</Text>;
                }
                return <Text color={colors.dimmed} wrap="truncate">{parts.join("  ")}</Text>;
              })()}
            </Box>
          ) : (
            <Text color={colors.dimmed}>shared: off  flags: {selectedConfig?.launchArgs?.join(" ") || "none"} — press h/f to configure</Text>
          )}
        </Box>
      )}

      {/* Clone mode */}
      {action === "clone" && (
        <Box paddingLeft={2} paddingTop={1} flexDirection="column">
          <Box gap={1}>
            <Text color={colors.dimmed}>Clone {cloneSource} as:</Text>
            <Text color={colors.text}>{cloneInput}</Text>
            <Text color={colors.primary}>{"\u258C"}</Text>
          </Box>
          <Box gap={2} marginTop={0}>
            <Text color={colors.dimmed}>enter save  esc cancel</Text>
          </Box>
        </Box>
      )}

      {/* Edit flags mode */}
      {action === "edit-flags" && (
        <Box paddingLeft={2} paddingTop={1} flexDirection="column">
          <Box gap={1}>
            <Text color={colors.dimmed}>Launch flags:</Text>
            <Text color={colors.text}>{flagsInput}</Text>
            <Text color={colors.primary}>{"\u258C"}</Text>
          </Box>
          <Box gap={2} marginTop={0}>
            <Text color={colors.dimmed}>enter save  esc cancel  empty to clear</Text>
          </Box>
        </Box>
      )}

      {action === "launching" && (
        <Box paddingLeft={2} gap={1}>
          <Spinner label={`Launching ${profiles[selectedIndex]?.name}…`} />
        </Box>
      )}

      {action === "confirm-delete" && deleteTarget && (
        <Box paddingLeft={2}>
          <Text color={colors.error}>Delete {deleteTarget}? (y/n)</Text>
        </Box>
      )}

      {message && (
        <Box paddingLeft={2}>
          <Text color={colors.warning}>{message}</Text>
        </Box>
      )}

      {/* Key hints */}
      {!loading && action === "idle" && (
        <Box paddingLeft={2} paddingTop={1} gap={2}>
          <Text color={colors.dimmed}>
            <Text color={colors.primary} bold>{"\u21B5"}</Text> launch  <Text color={colors.primary} bold>s</Text> switch  <Text color={colors.primary} bold>i</Text> info  <Text color={colors.primary} bold>m</Text> mode  <Text color={colors.primary} bold>d</Text> delete  <Text color={colors.primary} bold>h</Text> sync  <Text color={colors.primary} bold>shift+h</Text> push  <Text color={colors.primary} bold>shift+s</Text> source  <Text color={colors.primary} bold>f</Text> flags  <Text color={colors.primary} bold>c</Text> create  <Text color={colors.primary} bold>shift+c</Text> clone
          </Text>
        </Box>
      )}
    </Box>
  );
}

