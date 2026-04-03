import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeLogEvent } from "@axiom-labs/arc-core";

// ─── Criterion extraction ────────────────────────────────────────────

interface DerivedCriterion {
  /** What the task description asks for. */
  criterion: string;
  /** Whether evidence of completion was found in the response. */
  met: boolean;
  /** The evidence snippet that matched, or null if not met. */
  evidence: string | null;
}

/** Structural patterns that indicate task steps or requirements. */
const STEP_PATTERNS = [
  // Markdown checkbox items: "- [ ] do X" or "- [x] do X"
  /^[-*]\s*\[[ x]\]\s*(.+)$/gim,
  // Numbered list items: "1. do X"
  /^\d+\.\s+(.+)$/gim,
  // "should" requirements: "it should do X"
  /\bshould\s+(.{10,80})/gi,
  // "must" requirements: "must handle X"
  /\bmust\s+(.{10,80})/gi,
  // "need to" requirements
  /\bneed\s+to\s+(.{10,80})/gi,
  // Imperative after colon in headers: "## Goal: create X"
  /^#+\s*.+?:\s*(.{10,80})$/gim,
];

/** Extract criteria from a task description. */
function extractCriteria(taskDescription: string): string[] {
  const criteria: string[] = [];
  const seen = new Set<string>();

  for (const pattern of STEP_PATTERNS) {
    // Reset stateful RegExp
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(taskDescription)) !== null) {
      const raw = match[1].trim().replace(/[.;,]+$/, "");
      const normalized = raw.toLowerCase();
      if (raw.length >= 5 && !seen.has(normalized)) {
        seen.add(normalized);
        criteria.push(raw);
      }
    }
  }

  // If no structural criteria found, split by sentence boundaries and take
  // sentences that look like requirements (contain a verb-like word).
  if (criteria.length === 0) {
    const sentences = taskDescription.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 10);
    for (const sentence of sentences.slice(0, 10)) {
      const normalized = sentence.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        criteria.push(sentence);
      }
    }
  }

  return criteria;
}

/** Check if a response contains evidence that a criterion was met. */
function checkCriterion(criterion: string, response: string): { met: boolean; evidence: string | null } {
  const lowerResponse = response.toLowerCase();
  const lowerCriterion = criterion.toLowerCase();

  // Extract key words from the criterion (3+ char words, excluding common stop words)
  const stopWords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "has", "have", "with", "that", "this", "from", "they", "been", "will", "each", "make", "like", "long", "look", "many", "some", "than", "them", "then", "very", "when", "what", "where", "which", "who", "how", "should", "must", "need"]);
  const keywords = lowerCriterion
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (keywords.length === 0) {
    return { met: false, evidence: null };
  }

  // Count how many keywords appear in the response
  const matchCount = keywords.filter((kw) => lowerResponse.includes(kw)).length;
  const matchRatio = matchCount / keywords.length;

  if (matchRatio >= 0.5) {
    // Find the first response line containing the most keywords
    const lines = response.split(/\n/);
    let bestLine = "";
    let bestScore = 0;
    for (const line of lines) {
      const ll = line.toLowerCase();
      const score = keywords.filter((kw) => ll.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestLine = line.trim();
      }
    }
    return {
      met: true,
      evidence: bestLine.length > 200 ? bestLine.slice(0, 200) + "…" : bestLine,
    };
  }

  return { met: false, evidence: null };
}

/**
 * Register the arc_derive_completion tool on an MCP server.
 *
 * Derives completion criteria from a task description and checks the agent
 * response against them. Uses keyword-matching to evaluate each derived criterion.
 */
export function registerDeriveCompletion(server: McpServer): void {
  server.tool(
    "arc_derive_completion",
    "Derive completion criteria from a task description and check an agent response against them. Returns per-criterion pass/fail with evidence, overall score, and recommendation.",
    {
      task_description: z.string().describe("The task description to derive criteria from"),
      agent_response: z.string().describe("The agent's response to check against derived criteria"),
    },
    async ({ task_description, agent_response }) => {
      writeLogEvent({
        level: "info",
        component: "mcp:tool:derive_completion",
        message: `Deriving completion for task (${task_description.length} chars) against response (${agent_response.length} chars)`,
      });

      const criteria = extractCriteria(task_description);
      const evaluated: DerivedCriterion[] = criteria.map((criterion) => {
        const { met, evidence } = checkCriterion(criterion, agent_response);
        return { criterion, met, evidence };
      });

      const metCount = evaluated.filter((c) => c.met).length;
      const total = evaluated.length;
      const score = total > 0 ? metCount / total : 0;

      // Recommendation based on score thresholds
      let recommendation: "complete" | "continue" | "retry" | "escalate";
      if (score >= 0.8) {
        recommendation = "complete";
      } else if (score >= 0.5) {
        recommendation = "continue";
      } else if (score >= 0.2) {
        recommendation = "retry";
      } else {
        recommendation = "escalate";
      }

      const result = {
        criteriaCount: total,
        metCount,
        score: Math.round(score * 100) / 100,
        recommendation,
        criteria: evaluated,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
