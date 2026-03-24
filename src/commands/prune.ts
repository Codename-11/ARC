import fs from "node:fs";
import { loadConfig } from "../config.js";
import { getArcDir } from "../paths.js";
import { SERVICE_NAME } from "../keyring.js";
import { success, error, warn, detail, sectionHeader } from "../display.js";
import pc from "picocolors";

/**
 * Attempt to load @inquirer/prompts for interactive confirmation.
 */
async function tryLoadInquirer(): Promise<typeof import("@inquirer/prompts") | null> {
  try {
    return await import("@inquirer/prompts");
  } catch {
    return null;
  }
}

/**
 * Delete OS keyring entries for all known profiles.
 */
async function clearKeyringEntries(profileNames: string[]): Promise<void> {
  let Entry: (new (service: string, account: string) => { deletePassword(): void }) | null = null;
  try {
    const mod = await import("@napi-rs/keyring");
    Entry = mod.Entry;
  } catch {
    // Keyring module not available -- nothing to clear
    return;
  }
  if (!Entry) return;

  for (const name of profileNames) {
    try {
      const entry = new Entry(SERVICE_NAME, name);
      entry.deletePassword();
    } catch {
      // Entry may not exist -- ignore
    }
  }
}

export async function handlePrune(opts: { force?: boolean }): Promise<void> {
  const arcDir = getArcDir();

  if (!fs.existsSync(arcDir)) {
    error("Nothing to remove. No arc data directory found.");
    return;
  }

  // Discover what exists
  let profileNames: string[] = [];
  try {
    const config = loadConfig();
    profileNames = Object.keys(config.profiles);
  } catch {
    // Config may be corrupted -- still proceed with directory removal
  }

  // Show what will be removed
  console.log();
  sectionHeader("Prune");
  console.log();
  console.log("  This will permanently remove " + pc.bold("all") + " arc data:");
  console.log();
  detail(`Directory: ${arcDir}`);
  if (profileNames.length > 0) {
    detail(`Profiles:  ${profileNames.join(", ")}`);
    detail("Keyring:   OS keyring entries for each profile");
  }
  console.log();

  // Confirm
  if (!opts.force) {
    const inquirer = await tryLoadInquirer();
    if (!inquirer || !process.stdin.isTTY) {
      error("Refusing to prune without confirmation. Use --force to skip.");
      process.exit(1);
    }

    try {
      const confirmed = await inquirer.confirm({
        message: "Are you sure? This cannot be undone.",
        default: false,
      });

      if (!confirmed) {
        console.log();
        warn("Aborted.");
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        console.log();
        return;
      }
      throw err;
    }
  }

  // 1. Clear OS keyring entries
  if (profileNames.length > 0) {
    await clearKeyringEntries(profileNames);
  }

  // 2. Remove the entire arc directory
  try {
    fs.rmSync(arcDir, { recursive: true, force: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Failed to remove ${arcDir}: ${message}`);
    process.exit(1);
  }

  console.log();
  success("All arc data has been removed.");
  if (profileNames.length > 0) {
    detail(`Removed ${profileNames.length} profile(s): ${profileNames.join(", ")}`);
  }
  detail(`Deleted: ${arcDir}`);
  console.log();
}
