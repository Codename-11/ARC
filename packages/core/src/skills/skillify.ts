/**
 * Skillify — detect repeated patterns in action sequences and generate
 * skill definitions from them (Phase 22).
 */

import type { Skill, SkillStep } from "./types.js";

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

interface ActionRecord {
  tool: string;
  args?: unknown;
}

interface DetectedPattern {
  steps: SkillStep[];
  frequency: number;
}

/**
 * Scan an ordered action list for repeated sub-sequences of length >= 3.
 *
 * Uses a sliding-window approach: for each window size from 3 up to half the
 * action list length, count how many times each unique sequence of tool names
 * appears. Return sequences that occur at least twice.
 */
export function detectRepeatedPatterns(
  actions: ActionRecord[],
): DetectedPattern[] {
  if (actions.length < 6) return []; // need at least 2 repetitions of a 3-step pattern

  const results: DetectedPattern[] = [];
  const seen = new Set<string>();

  const maxWindow = Math.floor(actions.length / 2);
  for (let windowSize = 3; windowSize <= maxWindow; windowSize++) {
    const counts = new Map<string, { steps: SkillStep[]; frequency: number }>();

    for (let i = 0; i <= actions.length - windowSize; i++) {
      const slice = actions.slice(i, i + windowSize);
      const key = slice.map((a) => a.tool).join("|");

      if (!counts.has(key)) {
        const steps: SkillStep[] = slice.map((a) => ({
          action: a.tool,
          description: `Invoke ${a.tool}`,
          onError: "abort" as const,
        }));
        counts.set(key, { steps, frequency: 0 });
      }
      counts.get(key)!.frequency += 1;
    }

    for (const [key, entry] of counts) {
      if (entry.frequency >= 2 && !seen.has(key)) {
        seen.add(key);
        results.push(entry);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Skill generation from pattern
// ---------------------------------------------------------------------------

/**
 * Create a Skill definition from a detected pattern.
 */
export function generateSkillFromPattern(
  pattern: DetectedPattern,
  name: string,
  description: string,
): Skill {
  const tools = [...new Set(pattern.steps.map((s) => s.action))];

  return {
    name,
    description,
    trigger: [name],
    steps: pattern.steps,
    tools,
    adapters: [],
    source: "generated",
    created: new Date().toISOString(),
    successRate: 0,
  };
}
