import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import { buildProfileEnv } from "../auth.js";
import { error, info } from "../display.js";
import { resolveEffectiveProfile } from "@axiom-labs/arc-core";

export async function handleShell(name?: string): Promise<void> {
  const config = loadConfig();

  // Resolve profile through workspace-aware pipeline (arc.json > explicit > activeProfile)
  let profileName: string;
  let profile;
  try {
    const result = resolveEffectiveProfile(config, name);
    profile = result.profile;
    profileName = result.profileName; // may be overridden by arc.json
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(msg);
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
