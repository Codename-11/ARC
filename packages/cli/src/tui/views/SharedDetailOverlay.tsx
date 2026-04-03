import { useState, useEffect } from "react";
import fs from "node:fs";
import { Box, Text, useInput } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";
import { getSharedSettings, getSharedSourceTool } from "../../shared.js";
import {
  getSharedCommandsDir,
  getSharedClaudeMdPath,
  getSharedMemoryDir,
  getSharedProjectsDir,
} from "../../paths.js";
import type { ArcConfig } from "../../types.js";

interface Props {
  config: ArcConfig;
  onClose: () => void;
}

interface SharedState {
  sourceTool: string | null;
  mcpServers: string[];
  commands: string[];
  claudeMdExists: boolean;
  memoryExists: boolean;
  projectsExists: boolean;
}

function loadSharedState(): SharedState {
  const settings = getSharedSettings();
  const sourceTool = getSharedSourceTool();

  // MCP server names from shared settings.json
  let mcpServers: string[] = [];
  if (settings) {
    const mcp = settings["mcpServers"];
    if (typeof mcp === "object" && mcp !== null && !Array.isArray(mcp)) {
      mcpServers = Object.keys(mcp as Record<string, unknown>);
    }
  }

  // Command files
  let commands: string[] = [];
  const commandsDir = getSharedCommandsDir();
  try {
    if (fs.existsSync(commandsDir)) {
      commands = fs.readdirSync(commandsDir).filter((f) => !f.startsWith("."));
    }
  } catch {
    // ignore
  }

  // CLAUDE.md existence
  let claudeMdExists = false;
  try {
    claudeMdExists = fs.existsSync(getSharedClaudeMdPath());
  } catch {
    // ignore
  }

  // Memory dir existence
  let memoryExists = false;
  try {
    memoryExists = fs.existsSync(getSharedMemoryDir());
  } catch {
    // ignore
  }

  // Projects dir existence
  let projectsExists = false;
  try {
    projectsExists = fs.existsSync(getSharedProjectsDir());
  } catch {
    // ignore
  }

  return { sourceTool, mcpServers, commands, claudeMdExists, memoryExists, projectsExists };
}

export function SharedDetailOverlay({ config, onClose }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [state, setState] = useState<SharedState | null>(null);

  useEffect(() => {
    setState(loadSharedState());
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  if (!state) {
    return (
      <Overlay title="Shared Layer" subtitle="~/.arc/shared/">
        <Text color={colors.dimmed}>Loading...</Text>
      </Overlay>
    );
  }

  const hasAnything =
    state.mcpServers.length > 0 ||
    state.commands.length > 0 ||
    state.claudeMdExists ||
    state.memoryExists ||
    state.projectsExists;

  return (
    <Overlay title="Shared Layer" subtitle="~/.arc/shared/">
      <Box flexDirection="column">
        {/* Source tool */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Source tool:</Text>
          <Text color={state.sourceTool ? colors.text : colors.dimmed}>
            {state.sourceTool ?? "not set"}
          </Text>
        </Box>

        {/* Sync source profile */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Sync source:</Text>
          <Text color={config.sharedSource ? colors.primary : colors.dimmed}>
            {config.sharedSource ?? "not set"}
          </Text>
        </Box>

        {!hasAnything && (
          <Box marginTop={1}>
            <Text color={colors.dimmed}>
              Shared layer is empty. Use shift+H on a profile to push config.
            </Text>
          </Box>
        )}

        {/* MCP Servers */}
        {state.mcpServers.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={colors.secondary} bold>
              MCP Servers ({state.mcpServers.length})
            </Text>
            {state.mcpServers.map((name) => (
              <Box key={name} paddingLeft={1}>
                <Text color={colors.dimmed}>{"\u2022"} </Text>
                <Text color={colors.text}>{name}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Commands */}
        {state.commands.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={colors.secondary} bold>
              Commands ({state.commands.length})
            </Text>
            {state.commands.map((file) => (
              <Box key={file} paddingLeft={1}>
                <Text color={colors.dimmed}>{"\u2022"} </Text>
                <Text color={colors.text}>{file}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* CLAUDE.md */}
        <Box marginTop={1} gap={1}>
          <Text color={colors.dimmed}>CLAUDE.md:</Text>
          <Text color={state.claudeMdExists ? colors.success : colors.dimmed}>
            {state.claudeMdExists ? "present" : "not found"}
          </Text>
        </Box>

        {/* Memory */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Memory:</Text>
          <Text color={state.memoryExists ? colors.success : colors.dimmed}>
            {state.memoryExists ? "present" : "not found"}
          </Text>
        </Box>

        {/* Projects */}
        <Box gap={1}>
          <Text color={colors.dimmed}>Projects:</Text>
          <Text color={state.projectsExists ? colors.success : colors.dimmed}>
            {state.projectsExists ? "present" : "not found"}
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
