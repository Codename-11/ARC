import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, saveConfig } from "../config.js";
import { resolveInstructions } from "@axiom-labs/arc-core";
import { success, error, info, warn } from "../display.js";

function getProfile(name?: string) {
  const config = loadConfig();
  const profileName = name ?? config.activeProfile;
  const profile = config.profiles[profileName];
  if (!profile) {
    error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }
  return { config, profileName, profile };
}

export async function handleInstructionsShow(name?: string): Promise<void> {
  const { profileName, profile } = getProfile(name);
  const text = resolveInstructions(profile);

  if (!text) {
    info(`No instructions configured for "${profileName}".`);
    info("Set with: arc instructions set <profile> --from-file ./INSTRUCTIONS.md");
    return;
  }

  const source = profile.instructionsFile ? `file: ${profile.instructionsFile}` : "inline";
  info(`Instructions for "${profileName}" (${source}, ${text.length} chars):`);
  console.log();
  console.log(text);
}

export async function handleInstructionsSet(
  name: string,
  opts: { fromFile?: string; file?: string },
): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  if (opts.file) {
    // Set instructionsFile path (lazy-loaded at launch time)
    const resolved = path.resolve(opts.file);
    if (!fs.existsSync(resolved)) {
      warn(`File "${resolved}" does not exist yet — it will be read at launch time.`);
    }
    profile.instructionsFile = resolved;
    delete profile.instructions;
    saveConfig(config);
    success(`Instructions file for "${profileName}" set to: ${resolved}`);
    return;
  }

  if (opts.fromFile) {
    // Read file and store as inline instructions
    const resolved = path.resolve(opts.fromFile);
    try {
      const text = fs.readFileSync(resolved, "utf-8");
      profile.instructions = text;
      delete profile.instructionsFile;
      saveConfig(config);
      success(`Inline instructions for "${profileName}" set from: ${resolved} (${text.length} chars)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Failed to read "${resolved}": ${msg}`);
      process.exit(1);
    }
    return;
  }

  // Interactive: read from stdin
  info("Enter instructions (paste text, then press Ctrl+D when done):");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();

  if (!text) {
    error("No instructions provided.");
    process.exit(1);
  }

  profile.instructions = text;
  delete profile.instructionsFile;
  saveConfig(config);
  success(`Inline instructions for "${profileName}" set (${text.length} chars).`);
}

export async function handleInstructionsEdit(name: string): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  const editor = process.env["EDITOR"] || process.env["VISUAL"] || (process.platform === "win32" ? "notepad" : "vi");

  // Write current instructions to a temp file
  const tmpDir = path.join(profile.configDir, ".arc-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, "instructions.md");

  const existing = resolveInstructions(profile) ?? "";
  fs.writeFileSync(tmpFile, existing, "utf-8");

  info(`Opening ${editor}...`);
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });

  if (result.status !== 0) {
    error(`Editor exited with code ${result.status}.`);
    try { fs.unlinkSync(tmpFile); fs.rmdirSync(tmpDir); } catch { /* ignore */ }
    process.exit(1);
  }

  const updated = fs.readFileSync(tmpFile, "utf-8").trim();
  try { fs.unlinkSync(tmpFile); fs.rmdirSync(tmpDir); } catch { /* ignore */ }

  if (!updated) {
    profile.instructions = undefined;
    profile.instructionsFile = undefined;
    saveConfig(config);
    info(`Instructions cleared for "${profileName}".`);
    return;
  }

  profile.instructions = updated;
  delete profile.instructionsFile;
  saveConfig(config);
  success(`Instructions for "${profileName}" updated (${updated.length} chars).`);
}

export async function handleInstructionsClear(name: string): Promise<void> {
  const { config, profileName, profile } = getProfile(name);

  if (!profile.instructions && !profile.instructionsFile) {
    info(`No instructions configured for "${profileName}".`);
    return;
  }

  profile.instructions = undefined;
  profile.instructionsFile = undefined;
  saveConfig(config);
  success(`Instructions cleared for "${profileName}".`);
}
