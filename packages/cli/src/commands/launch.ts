import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { resolveEffectiveProfile } from "@axiom-labs/arc-core";
import { error, info, warn, cmd } from "../display.js";
import { logAction } from "../log.js";
import { getAdapter } from "../adapters/index.js";
import { waitForProcessExit } from "@axiom-labs/arc-core";
import { createDefaultHookBus } from "@axiom-labs/arc-core";
import { writeLogEvent, queryLogEvents } from "@axiom-labs/arc-core";
import { recordLaunch } from "@axiom-labs/arc-core";
import { SessionStore, isResumeIntent } from "@axiom-labs/arc-core";
import { TelemetryProvider, JsonFileExporter, startSessionSpan } from "@axiom-labs/arc-core";
import { CircuitBreaker } from "@axiom-labs/arc-core";
import { createPermissionPolicy, evaluatePermission } from "@axiom-labs/arc-core";
import { ContextManager } from "@axiom-labs/arc-core";
import { getArcDir } from "@axiom-labs/arc-core";
import { SkillRegistry, loadSkillsFromDirectory } from "@axiom-labs/arc-core";
import { PersistentMemory, extractMemories } from "@axiom-labs/arc-core";
import type { Profile } from "../types.js";
import type { HookContext } from "@axiom-labs/arc-core";
import type { AgentProcess } from "@axiom-labs/arc-core";

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
  opts?: {
    beforeSpawn?: () => void | Promise<void>;
    dashboard?: boolean;
    /**
     * Force a specific launch mode regardless of profile setting or CLI flags.
     * Used by orchestrators (Phase 5+ roundtable, pipelines) to guarantee
     * `worker` mode so stdout can be captured.
     */
    launchMode?: "native" | "worker";
  }
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

  // Extract launch-mode flags from passthrough so they are not forwarded to the agent
  let cliLaunchMode: "native" | "worker" | undefined;
  passthrough = passthrough.filter((arg) => {
    if (arg === "--native") {
      cliLaunchMode = "native";
      return false;
    }
    if (arg === "--worker") {
      cliLaunchMode = "worker";
      return false;
    }
    return true;
  });

  // Resolve profile through workspace-aware pipeline (arc.json > explicit > activeProfile)
  let profile: Profile;
  try {
    const result = resolveEffectiveProfile(config, profileName);
    profile = result.profile;
    profileName = result.profileName; // may be overridden by arc.json
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";
  const enforcement = profile.enforcement ?? "log";

  // Resolve effective launch mode: caller override > CLI flag > profile setting > default native.
  // Orchestrators (roundtable, pipelines) pass `opts.launchMode = "worker"` to force supervision.
  const effectiveLaunchMode: "native" | "worker" =
    opts?.launchMode ?? cliLaunchMode ?? profile.launchMode ?? "native";

  // ─── Session auto-resume detection ──────────────────────────────────
  // Lightweight: detect whether the user's launch args suggest resume intent
  // and whether a suspended session exists. Informational only for now.
  try {
    const resumeStore = new SessionStore();
    const suspended = resumeStore.list({ profile: profileName, status: "suspended" });
    if (suspended.length > 0) {
      const resumeText = passthrough.join(" ");
      const hasResumeIntent = resumeText.length > 0 && isResumeIntent(resumeText);
      if (hasResumeIntent || suspended.length === 1) {
        const target = suspended[0];
        writeLogEvent({
          level: "info",
          component: "launch",
          action: "session:resume-available",
          message: `Suspended session available: ${target.name}`,
          data: { sessionId: target.id, profile: profileName, resumeIntent: hasResumeIntent },
        });
      }
    }
  } catch {
    // Non-fatal — resume detection must never block launch
  }

  // ─── Core module initialization ─────────────────────────────────────
  // These integrations are non-blocking: failures are logged but never
  // prevent the agent from launching.

  let sessionStore: SessionStore | undefined;
  let sessionId: string | undefined;
  let telemetry: TelemetryProvider | undefined;
  let sessionSpan: string | undefined;
  let breaker: CircuitBreaker | undefined;
  let contextManager: ContextManager | undefined;

  try {
    // Session continuity — create session on launch
    sessionStore = new SessionStore();
    const session = sessionStore.create(`ARC: ${profileName}`, profileName, tool);
    sessionId = session.id;

    // Telemetry — start session span
    telemetry = new TelemetryProvider({ enabled: true, exporters: ["json"], sampleRate: 1.0 });
    telemetry.addExporter(new JsonFileExporter());
    sessionSpan = startSessionSpan(telemetry, session.id, profileName, tool, enforcement);

    // Circuit breaker — create per-session
    breaker = new CircuitBreaker({ maxConsecutiveFailures: 3 });

    // Permissions — evaluate tool permissions for this profile
    const permissionPolicy = createPermissionPolicy("interactive");
    const toolPermission = evaluatePermission(permissionPolicy, tool);
    if (toolPermission === "deny") {
      writeLogEvent({
        level: "warn",
        component: "launch",
        action: "permission:deny",
        message: `Permission policy denies tool "${tool}" for profile "${profileName}"`,
        data: { profile: profileName, tool, tier: "interactive" },
      });
    } else if (toolPermission === "ask") {
      writeLogEvent({
        level: "info",
        component: "launch",
        action: "permission:ask",
        message: `Permission policy requires approval for tool "${tool}" in profile "${profileName}"`,
        data: { profile: profileName, tool, tier: "interactive" },
      });
    }

    // Context manager — initialize for future use (turn tracking)
    contextManager = new ContextManager();

    writeLogEvent({
      level: "debug",
      component: "launch",
      action: "core:init",
      message: `Core modules initialized for session ${session.id}`,
      data: {
        profile: profileName,
        tool,
        enforcement,
        sessionId: session.id,
        modules: ["session", "telemetry", "circuit-breaker", "permissions", "context-manager"],
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLogEvent({
      level: "warn",
      component: "launch",
      action: "core:init:error",
      message: `Core module initialization failed (non-blocking): ${msg}`,
      data: { profile: profileName, tool },
    });
  }

  // ─── Skills auto-load ───────────────────────────────────────────────
  // Auto-load skills from ~/.arc/skills/ if the directory exists
  try {
    const skillsDir = path.join(getArcDir(), "skills");
    if (fs.existsSync(skillsDir)) {
      const skills = await loadSkillsFromDirectory(skillsDir);
      const registry = new SkillRegistry();
      for (const skill of skills) {
        registry.register(skill);
      }
      writeLogEvent({
        level: "info",
        component: "launch",
        action: "skills:loaded",
        message: `${skills.length} skills loaded`,
        data: { profile: profileName, count: skills.length },
      });
    }
  } catch {
    // Non-fatal — skill loading must never block launch
  }

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

  // ─── Optional web dashboard ────────────────────────────────────────
  // When --dashboard is passed, spin up the dashboard server in the
  // background using the SAME store instances so it shows real-time data.
  if (opts?.dashboard) {
    try {
      const { createDashboardServer } = await import("../../../dashboard/src/server.js");
      const { TaskStore } = await import("@axiom-labs/arc-core");
      const { SkillRegistry } = await import("@axiom-labs/arc-core");
      const { PersistentMemory } = await import("@axiom-labs/arc-core");
      const { RemoteAgentRegistry } = await import("@axiom-labs/arc-core");

      const dashSessions = sessionStore ?? new SessionStore();
      const dashTasks = new TaskStore();
      const dashSkills = new SkillRegistry();
      const dashMemory = new PersistentMemory("persistent");
      const dashRemote = new RemoteAgentRegistry();

      const dashboard = createDashboardServer(
        { port: 3700, host: "localhost" },
        {
          sessions: dashSessions,
          tasks: dashTasks,
          skills: dashSkills,
          memory: dashMemory,
          remoteAgents: dashRemote,
        },
      );

      await dashboard.start();
      dashboard.startPolling();

      writeLogEvent({
        level: "info",
        component: "launch",
        action: "dashboard:started",
        message: "http://localhost:3700/",
      });
      info("Dashboard: http://localhost:3700/");
    } catch {
      // Non-fatal if dashboard fails to start
      writeLogEvent({
        level: "warn",
        component: "launch",
        action: "dashboard:error",
        message: "Failed to start dashboard (non-fatal)",
      });
    }
  }

  // Try the adapter's real lifecycle first. If the adapter still has stubs
  // (throws "not implemented"), fall back to the legacy spawnSync path.
  const adapter = getAdapter(tool);

  // ─── Pre-launch hook pipeline ──────────────────────────────────────
  // Circuit breaker degrades enforcement when hooks are failing repeatedly
  const effectiveEnforcement = breaker
    ? breaker.getEffectiveEnforcement(enforcement)
    : enforcement;

  if (effectiveEnforcement !== "off") {
    const hookBus = createDefaultHookBus(profile.hooks);
    const hookCtx: HookContext = {
      message: "",
      sessionId: sessionId ?? `launch-${profileName}-${Date.now()}`,
      profile,
      adapter: tool,
    };

    let hookResult;
    try {
      hookResult = await hookBus.runPre(hookCtx, effectiveEnforcement, "pre-launch");
      // Record success with circuit breaker
      breaker?.recordSuccess();
    } catch (hookErr: unknown) {
      // Record failure with circuit breaker
      breaker?.recordFailure();
      const hookMsg = hookErr instanceof Error ? hookErr.message : String(hookErr);
      writeLogEvent({
        level: "warn",
        component: "launch",
        action: "hook:error",
        message: `Hook pipeline threw (circuit breaker tracking): ${hookMsg}`,
        data: { profile: profileName, tool, enforcement: effectiveEnforcement },
      });
      hookResult = null;
    }

    if (hookResult?.blocked && effectiveEnforcement === "enforce") {
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
          enforcement: effectiveEnforcement,
          metadata: hookResult.metadata,
        },
      });
      error(`Launch blocked: ${blockReasons}`);
      process.exit(1);
    }

    // Pass hook metadata to adapter if supported
    if (hookResult && Object.keys(hookResult.metadata).length > 0) {
      writeLogEvent({
        level: "info",
        component: "launch",
        action: "hook:metadata",
        message: `Pre-launch hooks produced metadata`,
        data: {
          profile: profileName,
          tool,
          enforcement: effectiveEnforcement,
          metadataKeys: Object.keys(hookResult.metadata),
        },
      });
    }
  }

  recordLaunch({
    profile: profileName,
    tool,
    timestamp: new Date().toISOString(),
    outcome: "started",
  });

  let agentProcess: AgentProcess | null = null;
  if (effectiveLaunchMode === "worker") {
    // Worker mode: hand off to the adapter for managed supervision.
    try {
      agentProcess = await adapter.launch(profile, {
        args: allArgs,
        env: profileEnv,
        cwd: process.cwd(),
        beforeSpawn: opts?.beforeSpawn ? async () => { await opts!.beforeSpawn!(); } : undefined,
        launchMode: "worker",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "not implemented") {
        // Adapter still has stub lifecycle — fall back to spawnSync
        agentProcess = null;
      } else {
        // Real error from a real adapter
        recordLaunch({
          profile: profileName,
          tool,
          timestamp: new Date().toISOString(),
          outcome: "failed",
        });
        error(`Failed to launch ${tool}: ${msg}`);
        process.exit(1);
      }
    }
  }
  // Native mode falls straight through to the spawnSync path below for full TTY handoff.

  // ─── Finalization helper ──────────────────────────────────────────
  // Completes session tracking and flushes telemetry. Wrapped in try/catch
  // so it never prevents the process from exiting.
  const finalizeCoreModules = async (exitCode: number): Promise<void> => {
    try {
      if (sessionStore && sessionId) {
        sessionStore.complete(sessionId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeLogEvent({
        level: "warn",
        component: "launch",
        action: "session:complete:error",
        message: `Failed to complete session: ${msg}`,
      });
    }

    // Auto-extract memories from session log (lightweight)
    try {
      const logEntries = queryLogEvents({ profile: profileName, limit: 50 });
      const textForExtraction = logEntries
        .map((e) => e.message || e.detail || "")
        .filter(Boolean)
        .join("\n");
      if (textForExtraction.length > 0) {
        const extracted = extractMemories(textForExtraction, sessionId || "unknown");
        if (extracted.length > 0) {
          const mem = new PersistentMemory("persistent");
          for (const entry of extracted) {
            mem.add(entry.content, entry.type, {
              tags: entry.tags,
              ttl: entry.ttl,
              relevanceScore: entry.relevanceScore,
              sourceSession: entry.sourceSession,
              sourceAgent: entry.sourceAgent,
            });
          }
          writeLogEvent({
            level: "info",
            component: "launch",
            action: "memory:extracted",
            message: `${extracted.length} memories extracted`,
            data: { profile: profileName, sessionId: sessionId || "unknown", count: extracted.length },
          });
        }
      }
    } catch {
      // Non-fatal — memory extraction must never block exit
    }

    try {
      if (telemetry && sessionSpan) {
        telemetry.endSpan(sessionSpan, exitCode === 0 ? "ok" : "error");
        await telemetry.flush();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeLogEvent({
        level: "warn",
        component: "launch",
        action: "telemetry:flush:error",
        message: `Failed to flush telemetry: ${msg}`,
      });
    }
  };

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

    process.on("SIGINT", () => {
      void cleanup()
        .then(() => finalizeCoreModules(130))
        .then(() => process.exit(130));
    });
    process.on("SIGTERM", () => {
      void cleanup()
        .then(() => finalizeCoreModules(143))
        .then(() => process.exit(143));
    });

    // Forward output to the terminal
    if (adapter.onOutput) {
      adapter.onOutput(agentProcess, (event) => {
        process.stdout.write(event.content + "\n");
      });
    }

    // Block until the child process exits
    await waitForProcessExit(agentProcess.pid);
    recordLaunch({
      profile: profileName,
      tool,
      timestamp: new Date().toISOString(),
      outcome: "exited",
      exitCode: 0,
    });
    await finalizeCoreModules(0);
    process.exit(0);
  }

  // ─── Native TTY handoff path (default mode + adapter-stub fallback) ─
  // Use spawnSync with stdio:"inherit" — the parent blocks completely and
  // the child process owns the terminal, so the tool can paint its own TUI
  // (e.g. Claude's statusLine).  No stdin competition, no async race
  // conditions, no DEP0190 warning.
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
    recordLaunch({
      profile: profileName,
      tool,
      timestamp: new Date().toISOString(),
      outcome: "failed",
    });
    await finalizeCoreModules(1);
    error(`Failed to launch ${tool}: ${result.error.message}`);
    process.exit(1);
  }

  const exitCode = result.status ?? 0;
  recordLaunch({
    profile: profileName,
    tool,
    timestamp: new Date().toISOString(),
    outcome: exitCode === 0 ? "exited" : "failed",
    exitCode,
  });
  await finalizeCoreModules(exitCode);
  process.exit(exitCode);
}
