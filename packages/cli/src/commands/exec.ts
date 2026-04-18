import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error } from "../display.js";
import { runCommandWithLifecycle, resolveEffectiveProfile } from "@axiom-labs/arc-core";
import { writeLogEvent } from "../log.js";

const isWindows = process.platform === "win32";

export async function handleExec(
  name: string | undefined,
  rawArgs: string[]
): Promise<void> {
  const config = loadConfig();
  let profileName: string;
  let passthrough: string[];

  if (name && config.profiles[name]) {
    profileName = name;
    passthrough = rawArgs.slice(1);
  } else {
    if (config.activeProfile === null) {
      error("No active profile. Use 'arc profile switch <name>' or pass a profile argument.");
      process.exit(1);
    }
    profileName = config.activeProfile;
    passthrough = rawArgs;
  }

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

  const profileEnv = await buildProfileEnv(profile, profileName);
  const [command, ...args] = passthrough;
  writeLogEvent({
    level: "info",
    component: "exec",
    action: "exec:start",
    profile: profileName,
    tool: profile.tool ?? "claude",
    message: [command, ...args].join(" "),
  });

  const result = await runCommandWithLifecycle({
    component: "exec",
    profile: profileName,
    tool: profile.tool ?? "claude",
    command: isWindows ? "cmd" : command,
    args: isWindows ? ["/c", command, ...args] : args,
    env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
  });

  process.exit(result.exitCode);
}
