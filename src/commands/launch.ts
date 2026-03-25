import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info, warn, cmd } from "../display.js";

/** Check whether a command binary is available on PATH. */
export function findBinary(name: string): boolean {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [name], { shell: true, stdio: "ignore" });
  return result.status === 0;
}

/** Suggest an install command for known agent tool binaries. */
function getInstallHint(tool: string): string {
  switch (tool) {
    case "claude":
      return `Install with: ${cmd("npm install -g @anthropic-ai/claude-code")}`;
    case "gemini":
      return `See Google's documentation for Gemini CLI installation instructions.`;
    case "codex":
      return `Install with: ${cmd("npm install -g @openai/codex")}`;
    default:
      return `Ensure "${tool}" is installed and available on your PATH.`;
  }
}

export async function handleLaunch(
  name: string | undefined,
  rawArgs: string[]
): Promise<void> {
  const config = loadConfig();
  let profileName: string;
  let passthrough: string[];

  if (name && config.profiles[name]) {
    // Valid profile name — everything after it is for the agent tool
    profileName = name;
    passthrough = rawArgs.slice(1);
  } else if (name) {
    // Commander consumed something as name but it's not a valid profile.
    // Treat everything (including the consumed "name") as passthrough.
    profileName = config.activeProfile;
    passthrough = rawArgs;
  } else {
    // No name provided — active profile, everything is passthrough
    profileName = config.activeProfile;
    passthrough = rawArgs;
  }

  // Strip leading -- separator (user explicitly separated args)
  if (passthrough.length > 0 && passthrough[0] === "--") {
    passthrough = passthrough.slice(1);
  }

  const profile = config.profiles[profileName];

  if (!profile) {
    error(
      `Profile "${profileName}" not found. Run "arc list" to see available profiles.`
    );
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";
  const profileEnv = await buildProfileEnv(profile, profileName);

  if (!findBinary(tool)) {
    error(`Binary "${tool}" not found on PATH.`);
    warn(getInstallHint(tool));
    process.exit(1);
  }

  info(`Launching ${tool} with profile: ${profileName}`);

  const child = spawn(tool, passthrough, {
    stdio: "inherit",
    env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
    shell: true,
  });

  child.on("error", (err) => {
    error(`Failed to launch ${tool}: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
