import { useCallback, useEffect, useState } from "react";
import fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { ProfileList } from "../components/ProfileList.js";
import { saveConfig, loadConfig } from "../../config.js";
import type { ProfileEntry } from "../useProfiles.js";

type Action = "idle" | "launching" | "confirm-delete";

interface Props {
  profiles: ProfileEntry[];
  loading: boolean;
  reload: () => void;
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

export function ProfilesView({
  profiles,
  loading,
  reload,
  focusedPane,
  inputEnabled,
}: Props) {
  const isActive = focusedPane === "content";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [action, setAction] = useState<Action>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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
            const { handleLaunch } = await import("../../commands/launch.js");
            await handleLaunch(selected.name, []);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`Launch failed: ${msg}`);
          }
          setAction("idle");
        }, 50);
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

      if (input === "d") {
        if (profiles.length <= 1) {
          showMessage("Cannot delete the only remaining profile");
          return;
        }

        setDeleteTarget(selected.name);
        setAction("confirm-delete");
      }
    },
    { isActive: isActive && inputEnabled }
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {loading ? (
        <Box paddingY={1} paddingLeft={2} gap={1}>
          <Spinner label="Loading profiles…" />
        </Box>
      ) : (
        <ProfileList profiles={profiles} selectedIndex={selectedIndex} />
      )}

      {action === "launching" && (
        <Box paddingLeft={2} gap={1}>
          <Spinner label={`Launching ${profiles[selectedIndex]?.name}…`} />
        </Box>
      )}

      {action === "confirm-delete" && deleteTarget && (
        <Box paddingLeft={2}>
          <Text color="red">Delete {deleteTarget}? (y/n)</Text>
        </Box>
      )}

      {message && (
        <Box paddingLeft={2}>
          <Text color="yellow">{message}</Text>
        </Box>
      )}
    </Box>
  );
}
