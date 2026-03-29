import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Creates a temporary directory that mimics the ~/.arc/ data layout.
 * Sets the ARC_DIR environment variable so the app uses this temp dir
 * instead of the real ~/.arc/.
 *
 * Returns the temp dir path and a cleanup function.
 */
export function createTempArcDir(): { arcDir: string; cleanup: () => void } {
  const arcDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-test-"));

  // Create standard subdirectories
  fs.mkdirSync(path.join(arcDir, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "shared", "commands"), { recursive: true });
  fs.mkdirSync(path.join(arcDir, "credentials"), { recursive: true });

  const cleanup = () => {
    try {
      fs.rmSync(arcDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup — may fail on Windows if handles are still open
    }
  };

  return { arcDir, cleanup };
}

/**
 * Writes a mock config.json into the given arc directory.
 */
export function writeMockConfig(
  arcDir: string,
  config?: Record<string, unknown>
): void {
  const defaultConfig = {
    version: 1,
    activeProfile: "default",
    profiles: {},
  };

  fs.writeFileSync(
    path.join(arcDir, "config.json"),
    JSON.stringify(config ?? defaultConfig, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Writes a mock config with pre-populated profiles.
 */
export function writeMockConfigWithProfiles(
  arcDir: string,
  profiles: Record<
    string,
    {
      authType?: string;
      tool?: string;
      description?: string;
    }
  >
): void {
  const now = new Date().toISOString();
  const profileEntries: Record<string, unknown> = {};

  for (const [name, opts] of Object.entries(profiles)) {
    const profileDir = path.join(arcDir, "profiles", name);
    fs.mkdirSync(profileDir, { recursive: true });

    profileEntries[name] = {
      authType: opts.authType ?? "oauth",
      tool: opts.tool ?? "claude",
      configDir: profileDir,
      description: opts.description ?? "",
      createdAt: now,
    };
  }

  const firstProfile = Object.keys(profiles)[0] ?? "default";

  writeMockConfig(arcDir, {
    version: 1,
    activeProfile: firstProfile,
    profiles: profileEntries,
  });
}

/**
 * Writes shared layer settings.json into the given arc directory.
 */
export function writeSharedSettings(
  arcDir: string,
  settings: Record<string, unknown>
): void {
  const sharedDir = path.join(arcDir, "shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedDir, "settings.json"),
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Writes a shared CLAUDE.md into the given arc directory.
 */
export function writeSharedClaudeMd(arcDir: string, content: string): void {
  const sharedDir = path.join(arcDir, "shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(sharedDir, "CLAUDE.md"), content, "utf-8");
}

/**
 * Writes a shared command file.
 */
export function writeSharedCommand(
  arcDir: string,
  filename: string,
  content: string
): void {
  const commandsDir = path.join(arcDir, "shared", "commands");
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, filename), content, "utf-8");
}
