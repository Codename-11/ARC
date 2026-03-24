import { spawn } from "node:child_process";
import { loadConfig, resolveProfileName } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info } from "../display.js";

export async function handleShell(name?: string): Promise<void> {
  const config = loadConfig();
  const profileName = resolveProfileName(config, name);
  const profile = config.profiles[profileName];

  if (!profile) {
    error(`Profile "${profileName}" not found. Run "arc profile list" to see available profiles.`);
    process.exit(1);
  }

  const profileEnv = await buildProfileEnv(profile, profileName);

  let shellCmd: string;
  if (process.platform === "win32") {
    shellCmd = process.env["COMSPEC"] ?? "cmd.exe";
  } else {
    shellCmd = process.env["SHELL"] ?? "/bin/bash";
  }

  info(`Entering arc shell for profile: ${profileName}. Type 'exit' to return.`);

  const child = spawn(shellCmd, [], {
    stdio: "inherit",
    env: { ...process.env, ...profileEnv } as NodeJS.ProcessEnv,
  });

  child.on("error", (err) => {
    error(`Failed to open shell: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
