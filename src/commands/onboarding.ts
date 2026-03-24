import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { getClaudeDefaultDir } from "../paths.js";
import {
  getLargeBanner,
  cmd,
  subtle,
  sectionHeader,
  stepLine,
} from "../display.js";
import type { AuthType } from "../types.js";

/**
 * Attempt to load @inquirer/prompts. Returns null if not installed.
 * This allows the onboarding to degrade gracefully in minimal installs.
 */
async function tryLoadInquirer(): Promise<typeof import("@inquirer/prompts") | null> {
  try {
    return await import("@inquirer/prompts");
  } catch {
    return null;
  }
}

/**
 * Check if stdin is a TTY (interactive terminal).
 * Onboarding prompts should only run interactively.
 */
function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * Check if existing Claude Code config exists at ~/.claude
 */
function hasExistingClaudeConfig(): boolean {
  const claudeDir = getClaudeDefaultDir();
  return (
    fs.existsSync(path.join(claudeDir, ".credentials.json")) ||
    fs.existsSync(path.join(claudeDir, "settings.json"))
  );
}

/**
 * Run the first-run onboarding wizard.
 * Called when `arc` is invoked with no args and no profiles exist.
 */
export async function runOnboarding(): Promise<void> {
  // --- Banner ---
  console.log();
  console.log(getLargeBanner());
  console.log();

  // Check if we can run interactively
  const inquirer = await tryLoadInquirer();
  if (!inquirer || !isInteractive()) {
    // Non-interactive fallback: show guidance with highlighted commands
    console.log(
      "  " + pc.bold("Welcome to ARC!") + " No profiles configured yet."
    );
    console.log();
    console.log("  To get started, create your first profile:");
    console.log();
    console.log("    " + cmd("arc profile create <name> --auth-type oauth"));
    console.log();
    if (hasExistingClaudeConfig()) {
      console.log("  Or import your existing Claude Code config:");
      console.log();
      console.log("    " + cmd("arc profile import --name default"));
      console.log();
    }
    console.log(
      "  " +
        subtle("Run ") +
        cmd("arc --help") +
        subtle(" for all available commands.")
    );
    console.log();
    return;
  }

  // Interactive wizard starts here
  try {
    console.log(
      "  " + pc.bold("Welcome!") + " Let's set up your first profile."
    );
    console.log();
    console.log(
      "  " + pc.dim("ARC manages profiles for Claude, Gemini, Codex, and other agent CLIs.")
    );
    console.log();

    // --- Step 1: Detect existing config & offer import ---
    if (hasExistingClaudeConfig()) {
      const claudeDir = getClaudeDefaultDir();
      console.log(
        "  Found existing Claude Code config at " + pc.cyan(claudeDir)
      );
      console.log();

      const shouldImport = await inquirer.confirm({
        message: "Import existing Claude config into ARC?",
        default: true,
      });

      if (shouldImport) {
        const { handleImport } = await import("./profile.js");
        await handleImport({ name: "default", from: claudeDir, tool: "claude" });
        console.log();
        printNextSteps("default", "oauth", "claude");
        return;
      }

      console.log();
    }

    // --- Step 2: Profile name ---
    const profileName = await inquirer.input({
      message: "Profile name:",
      default: "default",
      validate: (value: string) => {
        if (value.length === 0) return "Profile name cannot be empty.";
        if (value.length > 32)
          return "Profile name must be 32 characters or less.";
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value)) {
          return "Must be alphanumeric with hyphens only, starting with a letter or number.";
        }
        return true;
      },
    });

    // --- Step 3: Agent tool ---
    const tool = await inquirer.select<string>({
      message: "Agent tool:",
      choices: [
        { value: "claude", name: "Claude Code (claude.ai / Anthropic)" },
        { value: "gemini", name: "Gemini CLI (Google)" },
        { value: "codex", name: "Codex CLI (OpenAI)" },
        { value: "other", name: "Other / custom binary" },
      ],
      default: "claude",
    });

    const toolBinary =
      tool === "other"
        ? await inquirer.input({ message: "Binary name or path:", default: "claude" })
        : tool;

    // --- Step 4: Auth type ---
    const authType = await inquirer.select<AuthType>({
      message: "Authentication type:",
      choices: [
        {
          value: "oauth" as const,
          name: "OAuth (browser sign-in)",
          description: "Sign in via browser",
        },
        {
          value: "api-key" as const,
          name: "API Key",
          description: "Use a provider API key",
        },
        {
          value: "bedrock" as const,
          name: "AWS Bedrock",
          description: "Use AWS credentials",
        },
        {
          value: "vertex" as const,
          name: "Google Vertex AI",
          description: "Use Google Cloud credentials",
        },
        {
          value: "foundry" as const,
          name: "Foundry",
          description: "Use Foundry API key",
        },
      ],
      default: "oauth",
    });

    // --- Step 5: Optional description ---
    const description = await inquirer.input({
      message: "Description (optional, press Enter to skip):",
    });

    // --- Step 6: Create the profile ---
    console.log();
    const { handleCreate } = await import("./profile.js");
    await handleCreate(profileName, {
      authType,
      tool: toolBinary,
      description: description || undefined,
    });

    // --- Step 7: Next steps ---
    console.log();
    printNextSteps(profileName, authType, toolBinary);
  } catch (err) {
    // Handle Ctrl+C gracefully during prompts
    if (err instanceof Error && err.name === "ExitPromptError") {
      console.log();
      return;
    }
    throw err;
  }
}

/**
 * Print post-setup guidance with contextual next steps.
 */
function printNextSteps(profileName: string, authType: string, tool: string): void {
  sectionHeader("Next Steps");
  console.log();

  let stepNum = 1;

  if (authType === "api-key") {
    stepLine(stepNum, "Set API key", `arc set-key ${profileName}`);
    stepNum++;
  } else if (
    authType === "bedrock" ||
    authType === "vertex" ||
    authType === "foundry"
  ) {
    console.log(
      pc.dim(`  ${stepNum}. `) +
        "Configure".padEnd(16) +
        subtle(`See docs for ${authType} environment variables`)
    );
    stepNum++;
  }

  stepLine(stepNum, `Launch ${tool}`, `arc launch ${profileName}`);
  stepNum++;
  if (process.platform === "win32") {
    stepLine(stepNum, "Complete setup", "arc setup");
  } else {
    stepLine(stepNum, "Shell setup", "arc setup");
  }

  console.log();
  console.log(
    "  " +
      subtle("Run ") +
      cmd("arc --help") +
      subtle(" for all available commands.")
  );
  console.log();
}
