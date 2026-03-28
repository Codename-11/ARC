import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info, warn, cmd } from "../display.js";
import { logAction } from "../log.js";

const isWindows = process.platform === "win32";

/** Check whether a command binary is available on PATH. */
export function findBinary(name: string): boolean {
  const result = isWindows
    ? spawnSync("cmd", ["/c", "where", name], { stdio: "ignore" })
    : spawnSync("which", [name], { stdio: "ignore" });
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
  rawArgs: string[],
  opts?: { beforeSpawn?: () => void | Promise<void> }
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

  // Prepend persistent launch flags from profile config
  const allArgs = [...(profile.launchArgs ?? []), ...passthrough];

  // Optional launch confirmation (from settings)
  const arcConfig = loadConfig();
  if (arcConfig.settings?.confirmLaunch && !opts?.beforeSpawn) {
    // CLI-only confirmation (TUI handles its own flow)
    info(`Profile: ${profileName} (${tool})`);
    if (allArgs.length > 0) info(`Flags: ${allArgs.join(" ")}`);
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("  Launch? [Y/n] ", resolve);
    });
    rl.close();
    if (answer.toLowerCase() === "n") {
      info("Cancelled.");
      return;
    }
  }

  // Allow callers (e.g. TUI) to tear down before we take over stdio
  if (opts?.beforeSpawn) {
    await opts.beforeSpawn();
  }

  logAction("launch", `${profileName} (${tool})`);
  const flagStr = allArgs.length > 0 ? ` [${allArgs.join(" ")}]` : "";
  info(`Launching ${tool} with profile: ${profileName}${flagStr}`);

  // Use spawnSync with stdio:"inherit" — the parent blocks completely and
  // the child process owns the terminal.  No stdin competition, no async
  // race conditions, no DEP0190 warning.
  // On Windows, tools are often .cmd shims that need `cmd /c` to resolve.
  const result = isWindows
    ? spawnSync("cmd", ["/c", tool, ...allArgs], {
        stdio: "inherit",
        env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
      })
    : spawnSync(tool, allArgs, {
        stdio: "inherit",
        env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
      });

  if (result.error) {
    error(`Failed to launch ${tool}: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
