import { loadConfig } from "../config.js";

export async function handleResolveConfigDir(): Promise<void> {
  const profileName = process.env["ARC_PROFILE"];

  let config;
  try {
    config = loadConfig();
  } catch {
    process.exit(1);
  }

  const resolved = profileName ?? config.activeProfile;
  if (!resolved) {
    process.exit(1);
  }
  const profile = config.profiles[resolved];

  if (!profile) {
    process.exit(1);
  }

  process.stdout.write(profile.configDir);
}
