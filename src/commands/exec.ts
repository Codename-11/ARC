import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error } from "../display.js";

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

  const profile = config.profiles[profileName];

  if (!profile) {
    error(
      `Profile "${profileName}" not found. Run "arc list" to see available profiles.`
    );
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

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
    shell: true,
  });

  child.on("error", (err) => {
    error(`Failed to execute command: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
