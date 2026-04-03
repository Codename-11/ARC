import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeAdapter } from "@axiom-labs/arc-core";
import { getClaudeCredentialStatus, buildClaudeProfileEnv } from "./auth.js";
import { pullSharedClaudeMd, removeSharedClaudeMd, syncSharedClaudeMd } from "./shared.js";

function detectConfigs() {
  const configDir = path.join(os.homedir(), ".claude");
  if (!fs.existsSync(configDir)) return [];
  const hasMarker = [".credentials.json", "settings.json"].some((file) =>
    fs.existsSync(path.join(configDir, file))
  );
  return hasMarker ? [{ tool: "claude", configDir, displayName: "Claude Code" }] : [];
}

function detectAuthType(sourceDir: string) {
  if (
    process.env["AWS_PROFILE"] ||
    process.env["AWS_ACCESS_KEY_ID"] ||
    process.env["CLAUDE_CODE_USE_BEDROCK"] === "1"
  ) {
    return "bedrock" as const;
  }
  if (
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] ||
    process.env["CLAUDE_CODE_USE_VERTEX"] === "1"
  ) {
    return "vertex" as const;
  }
  if (process.env["FOUNDRY_API_KEY"]) {
    return "foundry" as const;
  }
  if (fs.existsSync(path.join(sourceDir, ".api-key"))) {
    return "api-key" as const;
  }
  return "oauth" as const;
}

function describeImportEntry(entryName: string): string | undefined {
  if (entryName === ".credentials.json") return "Copying OAuth credentials...";
  if (entryName === ".claude.json") return "Copying MCP servers & session config...";
  if (entryName === "commands") return "Copying custom commands...";
  return undefined;
}

function finalizeImport({
  sourceDir,
  profileDir,
  copiedItems,
}: {
  sourceDir: string;
  profileDir: string;
  copiedItems: string[];
}) {
  if (copiedItems.includes(".claude.json")) {
    return { copiedItems };
  }

  const inSource = path.join(sourceDir, ".claude.json");
  const inHome = path.join(os.homedir(), ".claude.json");
  const source = fs.existsSync(inSource) ? inSource : fs.existsSync(inHome) ? inHome : null;
  if (!source) {
    return { copiedItems };
  }

  fs.copyFileSync(source, path.join(profileDir, ".claude.json"));
  return { copiedItems: [...copiedItems, ".claude.json"] };
}

export const claudeAdapter: RuntimeAdapter = {
  id: "claude",
  displayName: "Claude Code",
  detectConfigs,
  getCredentialStatus: getClaudeCredentialStatus,
  buildProfileEnv: buildClaudeProfileEnv,
  getInstallHint: () => "Install with: npm install -g @anthropic-ai/claude-code",
  detectAuthType,
  describeImportEntry,
  finalizeImport,
  sharedArtifacts: {
    syncProfile(profileConfigDir) {
      return syncSharedClaudeMd(profileConfigDir) ? ["CLAUDE.md"] : [];
    },
    unsyncProfile(profileConfigDir) {
      removeSharedClaudeMd(profileConfigDir);
    },
    pullProfile(profileConfigDir) {
      return pullSharedClaudeMd(profileConfigDir) ? ["CLAUDE.md"] : [];
    },
  },
};

export function createClaudeAdapter(): RuntimeAdapter {
  return claudeAdapter;
}
