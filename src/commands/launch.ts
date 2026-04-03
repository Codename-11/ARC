import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info, warn, cmd } from "../display.js";
import { logAction } from "../log.js";
import { getAdapter } from "../../packages/cli/src/adapters/index.js";
import { waitForProcessExit } from "../../packages/core/src/process.js";
import { createDefaultHookBus } from "../../packages/core/src/hooks/create-default-bus.js";
import { writeLogEvent } from "../../packages/core/src/logging.js";
import type { HookContext } from "../../packages/core/src/hooks/types.js";
import type { AgentProcess } from "../../packages/core/src/adapters/types.js";

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

  // Allow callers (e.g. TUI) to tear down before we take over stdio.
  // For adapter-managed launches, beforeSpawn is passed via LaunchOptions.
  // For legacy spawnSync, we call it directly below.

  logAction("launch", `${profileName} (${tool})`);
  const flagStr = allArgs.length > 0 ? ` [${allArgs.join(" ")}]` : "";
  info(`Launching ${tool} with profile: ${profileName}${flagStr}`);

  // Try the adapter's real lifecycle first. If the adapter still has stubs
  // (throws "not implemented"), fall back to the legacy spawnSync path.
  const adapter = getAdapter(tool);

  // ─── Pre-launch hook pipeline ──────────────────────────────────────
  const enforcement = profile.enforcement ?? "log";
  if (enforcement !== "off") {
    const hookBus = createDefaultHookBus(profile.hooks);
    const hookCtx: HookContext = {
      message: "",
      sessionId: `launch-${profileName}-${Date.now()}`,
      profile,
      adapter: tool,
    };

    const hookResult = await hookBus.runPre(hookCtx, enforcement, "pre-launch");

    if (hookResult.blocked && enforcement === "enforce") {
      const blockReasons = hookResult.results
        .filter((r) => r.block)
        .map((r) => r.reason ?? "blocked by hook")
        .join("; ");
      writeLogEvent({
        level: "error",
        component: "launch",
        action: "hook:block",
        message: `Launch blocked by hook pipeline: ${blockReasons}`,
        data: {
          profile: profileName,
          tool,
          enforcement,
          metadata: hookResult.metadata,
        },
      });
      error(`Launch blocked: ${blockReasons}`);
      process.exit(1);
    }

    // Pass hook metadata to adapter if supported
    if (Object.keys(hookResult.metadata).length > 0) {
      writeLogEvent({
        level: "info",
        component: "launch",
        action: "hook:metadata",
        message: `Pre-launch hooks produced metadata`,
        data: {
          profile: profileName,
          tool,
          enforcement,
          metadataKeys: Object.keys(hookResult.metadata),
        },
      });
    }
  }

  let agentProcess: AgentProcess | null = null;
  try {
    agentProcess = await adapter.launch(profile, {
      args: allArgs,
      env: profileEnv,
      cwd: process.cwd(),
      beforeSpawn: opts?.beforeSpawn ? async () => { await opts!.beforeSpawn!(); } : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "not implemented") {
      // Adapter still has stub lifecycle — fall back to spawnSync
      agentProcess = null;
    } else {
      // Real error from a real adapter
      error(`Failed to launch ${tool}: ${msg}`);
      process.exit(1);
    }
  }

  if (agentProcess) {
    // ─── Adapter-managed process path ──────────────────────────────
    // Register signal handlers for clean shutdown
    const cleanup = async () => {
      try {
        await adapter.terminate(agentProcess!);
      } catch {
        // Best-effort cleanup
      }
    };

    process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)); });
    process.on("SIGTERM", () => { void cleanup().then(() => process.exit(143)); });

    // Forward output to the terminal
    if (adapter.onOutput) {
      adapter.onOutput(agentProcess, (event) => {
        process.stdout.write(event.content + "\n");
      });
    }

    // Block until the child process exits
    await waitForProcessExit(agentProcess.pid);
    process.exit(0);
  }

  // ─── Legacy spawnSync path (stubbed adapters: Claude, Gemini) ────
  // Use spawnSync with stdio:"inherit" — the parent blocks completely and
  // the child process owns the terminal.  No stdin competition, no async
  // race conditions, no DEP0190 warning.
  // On Windows, tools are often .cmd shims that need `cmd /c` to resolve.
  if (opts?.beforeSpawn) {
    await opts.beforeSpawn();
  }

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
