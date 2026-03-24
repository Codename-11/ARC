import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info } from "../display.js";

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
