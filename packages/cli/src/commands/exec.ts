import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error } from "../display.js";
import { runCommandWithLifecycle } from "../../../core/src/lifecycle.js";
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
  } else if (name) {
    profileName = config.activeProfile;
    passthrough = rawArgs;
  } else {
    profileName = config.activeProfile;
    passthrough = rawArgs;
  }

  if (passthrough.length > 0 && passthrough[0] === "--") {
    passthrough = passthrough.slice(1);
  }

  const profile = config.profiles[profileName];
  if (!profile) {
    error(`Profile "${profileName}" not found. Run "arc list" to see available profiles.`);
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
