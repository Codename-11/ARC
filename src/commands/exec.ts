import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error } from "../display.js";
import { resolveEffectiveProfile } from "../../packages/core/src/workspace.js";

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

  const profileEnv = await buildProfileEnv(profile, profileName);
  const [cmd, ...args] = passthrough;
  const env = { ...process.env, ...profileEnv } as NodeJS.ProcessEnv;

  // spawnSync with stdio:"inherit" — child owns the terminal.
  // On Windows, use cmd /c to resolve .cmd shims without shell:true (avoids DEP0190).
  const result = isWindows
    ? spawnSync("cmd", ["/c", cmd, ...args], { stdio: "inherit", env })
    : spawnSync(cmd, args, { stdio: "inherit", env });

  if (result.error) {
    error(`Failed to execute command: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
