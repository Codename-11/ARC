/**
 * arc skills — CLI commands for the skill registry.
 *
 * Subcommands: list, load, info
 */
import pc from "picocolors";
import path from "node:path";
import { SkillRegistry, loadSkillsFromDirectory } from "../../packages/core/src/skills/index.js";
import type { SkillSource } from "../../packages/core/src/skills/index.js";
import { getArcDir } from "../../packages/core/src/paths.js";

// ---------------------------------------------------------------------------
// Shared registry instance
// ---------------------------------------------------------------------------

async function getRegistry(): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  const skillsDir = path.join(getArcDir(), "skills");
  const skills = await loadSkillsFromDirectory(skillsDir);
  for (const skill of skills) {
    registry.register(skill);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_COLOR: Record<string, (s: string) => string> = {
  builtin: pc.blue,
  user: pc.green,
  generated: pc.yellow,
  mcp: pc.cyan,
};

function formatSource(source: string): string {
  const color = SOURCE_COLOR[source] ?? pc.white;
  return color(source);
}

function formatSuccessRate(rate: number): string {
  if (rate >= 0.8) return pc.green(`${(rate * 100).toFixed(0)}%`);
  if (rate >= 0.5) return pc.yellow(`${(rate * 100).toFixed(0)}%`);
  if (rate > 0) return pc.red(`${(rate * 100).toFixed(0)}%`);
  return pc.dim("—");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleSkillsList(opts: {
  source?: string;
  json?: boolean;
}): Promise<void> {
  const registry = await getRegistry();
  let skills = registry.list();

  if (opts.source) {
    skills = skills.filter((s) => s.source === opts.source);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(skills, null, 2) + "\n");
    return;
  }

  if (skills.length === 0) {
    process.stdout.write(pc.dim("No skills registered.\n"));
    return;
  }

  const nameW = Math.max(6, ...skills.map((s) => s.name.length)) + 2;
  const sourceW = 12;
  const rateW = 9;
  const trigW = 30;

  process.stdout.write(
    `  ${"Name".padEnd(nameW)}${pc.dim("│")} ${"Source".padEnd(sourceW)}${pc.dim("│")} ${"Rate".padEnd(rateW)}${pc.dim("│")} Triggers\n`,
  );
  process.stdout.write(
    pc.dim(`  ${"─".repeat(nameW)}┼${"─".repeat(sourceW + 1)}┼${"─".repeat(rateW + 1)}┼${"─".repeat(trigW)}`) + "\n",
  );

  for (const skill of skills) {
    const name = pc.bold(skill.name);
    const source = formatSource(skill.source);
    const rate = formatSuccessRate(skill.successRate);
    const triggers = skill.trigger.length > 0
      ? pc.dim(skill.trigger.slice(0, 3).join(", "))
      : pc.dim("—");

    process.stdout.write(
      `  ${name.padEnd(nameW + 10)}${pc.dim("│")} ${source.padEnd(sourceW + 10)}${pc.dim("│")} ${rate.padEnd(rateW + 10)}${pc.dim("│")} ${triggers}\n`,
    );
  }

  process.stdout.write(pc.dim(`\n  ${skills.length} skill(s) total.\n`));
}

export async function handleSkillsLoad(directory: string): Promise<void> {
  const resolvedDir = path.resolve(directory);
  const skills = await loadSkillsFromDirectory(resolvedDir);

  if (skills.length === 0) {
    process.stdout.write(pc.yellow("No valid skill definitions found in ") + pc.dim(resolvedDir) + "\n");
    return;
  }

  const registry = await getRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }

  process.stdout.write(pc.green(`Loaded ${skills.length} skill(s)`) + ` from ${pc.dim(resolvedDir)}\n`);
  for (const skill of skills) {
    process.stdout.write(`  ${pc.dim("•")} ${skill.name} ${pc.dim(`(${skill.source})`)}\n`);
  }
}

export async function handleSkillsInfo(name: string): Promise<void> {
  const registry = await getRegistry();
  const skill = registry.get(name);

  if (!skill) {
    process.stderr.write(pc.red(`Skill '${name}' not found.`) + "\n");
    process.exit(1);
  }

  process.stdout.write(`${pc.bold("Name:")}         ${skill.name}\n`);
  process.stdout.write(`${pc.bold("Source:")}       ${formatSource(skill.source)}\n`);
  process.stdout.write(`${pc.bold("Description:")}  ${skill.description || pc.dim("(none)")}\n`);
  process.stdout.write(`${pc.bold("Success Rate:")} ${formatSuccessRate(skill.successRate)}\n`);
  process.stdout.write(`${pc.bold("Created:")}      ${pc.dim(skill.created)}\n`);
  if (skill.lastUsed) {
    process.stdout.write(`${pc.bold("Last Used:")}    ${pc.dim(skill.lastUsed)}\n`);
  }

  if (skill.trigger.length > 0) {
    process.stdout.write(`${pc.bold("Triggers:")}\n`);
    for (const t of skill.trigger) {
      process.stdout.write(`  ${pc.dim("•")} ${t}\n`);
    }
  }

  if (skill.tools.length > 0) {
    process.stdout.write(`${pc.bold("Tools:")}\n`);
    for (const t of skill.tools) {
      process.stdout.write(`  ${pc.dim("•")} ${t}\n`);
    }
  }

  if (skill.adapters.length > 0) {
    process.stdout.write(`${pc.bold("Adapters:")}    ${skill.adapters.join(", ")}\n`);
  }

  if (skill.steps.length > 0) {
    process.stdout.write(`${pc.bold("Steps:")}        ${skill.steps.length}\n`);
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      process.stdout.write(`  ${pc.dim(`${i + 1}.`)} ${step.action} ${pc.dim(`— ${step.description}`)}\n`);
    }
  }
}
