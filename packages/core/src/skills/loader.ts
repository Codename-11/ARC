/**
 * Skill loader — reads JSON skill definitions from a directory.
 */

import fs from "node:fs";
import path from "node:path";
import { writeLogEvent } from "../logging.js";
import type { Skill } from "./types.js";

/**
 * Load all `.json` files from `dir` and parse each as a {@link Skill}.
 *
 * Files that fail to parse are logged and skipped rather than throwing.
 */
export async function loadSkillsFromDirectory(dir: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  if (!fs.existsSync(dir)) {
    writeLogEvent({
      level: "warn",
      component: "skills",
      action: "load",
      message: `Skills directory does not exist: ${dir}`,
    });
    return skills;
  }

  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Skill;

      // Minimal validation — require at least a name
      if (!parsed.name || typeof parsed.name !== "string") {
        throw new Error("missing or invalid 'name' field");
      }

      // Apply defaults for optional fields
      skills.push({
        name: parsed.name,
        description: parsed.description ?? "",
        trigger: Array.isArray(parsed.trigger) ? parsed.trigger : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
        adapters: Array.isArray(parsed.adapters) ? parsed.adapters : [],
        source: parsed.source ?? "user",
        created: parsed.created ?? new Date().toISOString(),
        lastUsed: parsed.lastUsed,
        successRate: typeof parsed.successRate === "number" ? parsed.successRate : 0,
      });
    } catch (err) {
      writeLogEvent({
        level: "warn",
        component: "skills",
        action: "load-error",
        message: `Failed to load skill from ${entry}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  writeLogEvent({
    level: "info",
    component: "skills",
    action: "load",
    message: `Loaded ${skills.length} skill(s) from ${dir}`,
    data: { directory: dir, count: skills.length },
  });

  return skills;
}
