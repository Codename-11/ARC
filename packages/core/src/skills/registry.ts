/**
 * SkillRegistry — in-memory registry for skill lookup and trigger matching.
 */

import { writeLogEvent } from "../logging.js";
import type { Skill } from "./types.js";

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Register a skill. Overwrites any existing skill with the same name. */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    writeLogEvent({
      level: "info",
      component: "skills",
      action: "register",
      message: `Skill '${skill.name}' registered.`,
      data: { skillName: skill.name, source: skill.source },
    });
  }

  /** Remove a skill by name. Returns true if it existed. */
  unregister(name: string): boolean {
    const existed = this.skills.delete(name);
    writeLogEvent({
      level: "info",
      component: "skills",
      action: "unregister",
      message: existed
        ? `Skill '${name}' unregistered.`
        : `Skill '${name}' not found (no-op unregister).`,
      data: { skillName: name, existed },
    });
    return existed;
  }

  /** Retrieve a skill by exact name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** List all registered skills. */
  list(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Find skills whose trigger patterns match the input string.
   *
   * Matching is case-insensitive keyword containment: a skill matches if
   * at least one of its trigger patterns appears as a substring of `input`.
   */
  findByTrigger(input: string): Skill[] {
    const lower = input.toLowerCase();
    const results: Skill[] = [];

    for (const skill of this.skills.values()) {
      for (const pattern of skill.trigger) {
        if (lower.includes(pattern.toLowerCase())) {
          results.push(skill);
          break;
        }
      }
    }

    return results;
  }
}
