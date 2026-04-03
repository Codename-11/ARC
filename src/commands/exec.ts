import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error } from "../display.js";
import { resolveEffectiveProfile } from "../../packages/core/src/workspace.js";
import { writeLogEvent } from "../../packages/core/src/logging.js";
import { SessionStore } from "../../packages/core/src/sessions.js";
import { TelemetryProvider, JsonFileExporter, startSessionSpan } from "../../packages/core/src/telemetry/index.js";

const isWindows = process.platform === "win32";

export async function handleExec(
  name: string | undefined,
  rawArgs: string[]
): Promise<void> {
  const config = loadConfig();
  let profileName: string;
  let passthrough: string[];

  if (name && config.profiles[name]) {
    // Valid profile name — everything after it is the command
    profileName = name;
    passthrough = rawArgs.slice(1);
  } else if (name) {
    // Commander consumed something as name but it's not a valid profile.
    // Treat everything (including the consumed "name") as the command.
    profileName = config.activeProfile;
    passthrough = rawArgs;
  } else {
    // No name provided — active profile, everything is the command
    profileName = config.activeProfile;
    passthrough = rawArgs;
  }

  // Strip leading -- separator (user explicitly separated args)
  if (passthrough.length > 0 && passthrough[0] === "--") {
    passthrough = passthrough.slice(1);
  }

  // Resolve profile through workspace-aware pipeline (arc.json > explicit > activeProfile)
  let profile;
  try {
    const result = resolveEffectiveProfile(config, profileName);
    profile = result.profile;
    profileName = result.profileName; // may be overridden by arc.json
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
    process.exit(1);
  }

  if (passthrough.length === 0) {
    error(
      "No command specified.\n\n" +
        "Usage:\n" +
        "  arc exec [profile] <command...>\n\n" +
        "Examples:\n" +
        "  arc exec work node app.js\n" +
        "  arc exec work npm test\n" +
        "  arc exec -- npm test"
    );
    process.exit(1);
  }

  const tool = profile.tool ?? "claude";
  const enforcement = profile.enforcement ?? "log";

  // ─── Core module initialization ─────────────────────────────────────
  let sessionStore: SessionStore | undefined;
  let sessionId: string | undefined;
  let telemetry: TelemetryProvider | undefined;
  let sessionSpan: string | undefined;

  try {
    sessionStore = new SessionStore();
    const session = sessionStore.create(`ARC exec: ${profileName}`, profileName, tool);
    sessionId = session.id;

    telemetry = new TelemetryProvider({ enabled: true, exporters: ["json"], sampleRate: 1.0 });
    telemetry.addExporter(new JsonFileExporter());
    sessionSpan = startSessionSpan(telemetry, session.id, profileName, tool, enforcement);

    writeLogEvent({
      level: "debug",
      component: "exec",
      action: "core:init",
      message: `Core modules initialized for exec session ${session.id}`,
      data: { profile: profileName, tool, sessionId: session.id },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLogEvent({
      level: "warn",
      component: "exec",
      action: "core:init:error",
      message: `Core module initialization failed (non-blocking): ${msg}`,
      data: { profile: profileName },
    });
  }

  // ─── Finalization helper ──────────────────────────────────────────
  const finalizeCoreModules = async (exitCode: number): Promise<void> => {
    try {
      if (sessionStore && sessionId) {
        sessionStore.complete(sessionId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeLogEvent({
        level: "warn",
        component: "exec",
        action: "session:complete:error",
        message: `Failed to complete session: ${msg}`,
      });
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
        component: "exec",
        action: "telemetry:flush:error",
        message: `Failed to flush telemetry: ${msg}`,
      });
    }
  };

  const profileEnv = await buildProfileEnv(profile, profileName);
  const [cmd, ...args] = passthrough;
  const env = { ...process.env, ...profileEnv } as NodeJS.ProcessEnv;

  // spawnSync with stdio:"inherit" — child owns the terminal.
  // On Windows, use cmd /c to resolve .cmd shims without shell:true (avoids DEP0190).
  const result = isWindows
    ? spawnSync("cmd", ["/c", cmd, ...args], { stdio: "inherit", env })
    : spawnSync(cmd, args, { stdio: "inherit", env });

  if (result.error) {
    await finalizeCoreModules(1);
    error(`Failed to execute command: ${result.error.message}`);
    process.exit(1);
  }

  const exitCode = result.status ?? 0;
  await finalizeCoreModules(exitCode);
  process.exit(exitCode);
}
