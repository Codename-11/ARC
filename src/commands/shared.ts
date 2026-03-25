import fs from "node:fs";
import { loadConfig, saveConfig, resolveProfileName } from "../config.js";
import {
  getSharedDir,
  getSharedSettingsPath,
  getSharedCommandsDir,
  getSharedClaudeMdPath,
  getSharedMemoryDir,
  getSharedProjectsDir,
} from "../paths.js";
import {
  getSharedSettings,
  getSharedManifest,
  syncSharedToProfile,
  unsyncSharedFromProfile,
} from "../shared.js";
import { success, error, info, warn, detail, sectionHeader } from "../display.js";

export async function handleSharedStatus(): Promise<void> {
  const config = loadConfig();
  const sharedDir = getSharedDir();
  const sharedSettings = getSharedSettings();

  console.log();
  sectionHeader("Shared Layer");
  console.log();

  if (!fs.existsSync(sharedDir)) {
    info(`No shared layer at ${sharedDir}`);
    info('Add a settings.json or commands/ there, then run "arc shared enable".');
    console.log();
    return;
  }

  // MCP servers
  const mcpServers = sharedSettings?.["mcpServers"] as
    | Record<string, unknown>
    | undefined;
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    info("MCP servers:");
    for (const name of Object.keys(mcpServers)) {
      detail(`${name}`);
    }
  } else {
    info("No shared MCP servers configured.");
  }

  // Commands
  const sharedCommandsDir = getSharedCommandsDir();
  if (fs.existsSync(sharedCommandsDir)) {
    const files = fs.readdirSync(sharedCommandsDir);
    if (files.length > 0) {
      console.log();
      info("Shared commands:");
      for (const f of files) detail(f);
    }
  }

  // CLAUDE.md
  const sharedClaudeMdPath = getSharedClaudeMdPath();
  if (fs.existsSync(sharedClaudeMdPath)) {
    console.log();
    info(`Shared CLAUDE.md: ${sharedClaudeMdPath}`);
  }

  // memory/
  const sharedMemoryDir = getSharedMemoryDir();
  if (fs.existsSync(sharedMemoryDir)) {
    console.log();
    info(`Shared memory dir: ${sharedMemoryDir}`);
  }

  // projects/
  const sharedProjectsDir = getSharedProjectsDir();
  if (fs.existsSync(sharedProjectsDir)) {
    console.log();
    info(`Shared projects dir: ${sharedProjectsDir}`);
  }

  // Per-profile status
  console.log();
  sectionHeader("Profiles");
  console.log();

  for (const [name, profile] of Object.entries(config.profiles)) {
    const enabled = profile.useShared === true;
    if (enabled) {
      const manifest = getSharedManifest(profile.configDir);
      const syncedAt = manifest?.syncedAt
        ? new Date(manifest.syncedAt).toLocaleString()
        : "never";
      const extras: string[] = [];
      if (manifest?.claudeMd) extras.push("CLAUDE.md");
      if (manifest?.memoryLinked) extras.push("memory linked");
      if (manifest?.projectsLinked) extras.push("projects linked");
      const extrasStr = extras.length > 0 ? `  [${extras.join(", ")}]` : "";
      detail(`${name}  enabled  (last sync: ${syncedAt})${extrasStr}`);
    } else {
      detail(`${name}  disabled`);
    }
  }
  console.log();
}

export interface SharedEnableOptions {
  memory?: boolean;
  projects?: boolean;
  claudeMd?: boolean;
}

export async function handleSharedEnable(
  name?: string,
  opts: SharedEnableOptions = {}
): Promise<void> {
  const config = loadConfig();
  const profileName = resolveProfileName(config, name);
  const profile = config.profiles[profileName];

  if (!profile) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  if (profile.useShared) {
    info(`Shared layer already enabled for "${profileName}" — re-syncing...`);
  }

  // Update profile flags
  profile.useShared = true;
  if (opts.memory !== undefined) profile.useSharedMemory = opts.memory;
  if (opts.projects !== undefined) profile.useSharedProjects = opts.projects;

  saveConfig(config);

  syncSharedToProfile(profile.configDir, {
    claudeMd: opts.claudeMd,
    memory: profile.useSharedMemory,
    projects: profile.useSharedProjects,
  });

  success(`Shared layer enabled and synced for profile "${profileName}".`);
}

export async function handleSharedDisable(
  name?: string,
  opts: { memory?: boolean; projects?: boolean } = {}
): Promise<void> {
  const config = loadConfig();
  const profileName = resolveProfileName(config, name);
  const profile = config.profiles[profileName];

  if (!profile) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  const disableMemoryOnly = opts.memory === true;
  const disableProjectsOnly = opts.projects === true;
  const disableSpecificFlag = disableMemoryOnly || disableProjectsOnly;

  if (disableSpecificFlag) {
    // Only disabling a specific sub-feature, not the whole shared layer
    if (!profile.useShared) {
      info(`Shared layer is not enabled for "${profileName}".`);
      return;
    }
    if (disableMemoryOnly) profile.useSharedMemory = false;
    if (disableProjectsOnly) profile.useSharedProjects = false;
    saveConfig(config);
    syncSharedToProfile(profile.configDir, {
      memory: profile.useSharedMemory,
      projects: profile.useSharedProjects,
    });
    success(`Updated shared layer for profile "${profileName}".`);
    return;
  }

  if (!profile.useShared) {
    info(`Shared layer is not enabled for "${profileName}".`);
    return;
  }

  unsyncSharedFromProfile(profile.configDir);
  profile.useShared = false;
  profile.useSharedMemory = false;
  profile.useSharedProjects = false;
  saveConfig(config);
  success(`Shared layer disabled and unsynced for profile "${profileName}".`);
}

export async function handleSharedSync(opts: {
  all?: boolean;
  name?: string;
}): Promise<void> {
  const config = loadConfig();

  let targets: Array<[string, (typeof config.profiles)[string]]>;

  if (opts.all) {
    targets = Object.entries(config.profiles).filter(([, p]) => p.useShared);
    if (targets.length === 0) {
      info("No profiles have the shared layer enabled.");
      return;
    }
  } else {
    const profileName = resolveProfileName(config, opts.name);
    const profile = config.profiles[profileName];
    if (!profile) {
      error(`Profile "${profileName}" not found.`);
      process.exit(1);
    }
    if (!profile.useShared) {
      warn(
        `Shared layer is not enabled for "${profileName}". Run "arc shared enable ${profileName}" first.`
      );
      process.exit(1);
    }
    targets = [[profileName, profile]];
  }

  for (const [profileName, profile] of targets) {
    syncSharedToProfile(profile.configDir, {
      memory: profile.useSharedMemory,
      projects: profile.useSharedProjects,
    });
    success(`Synced shared layer to "${profileName}".`);
  }
}

export async function handleSharedShow(): Promise<void> {
  const sharedSettings = getSharedSettings();
  const sharedSettingsPath = getSharedSettingsPath();

  if (!sharedSettings) {
    info(`No shared settings found.`);
    info(`Create ${sharedSettingsPath} to get started.`);
    return;
  }

  console.log(JSON.stringify(sharedSettings, null, 2));
}
