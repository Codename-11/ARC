import type { RiskClassification, RiskTier } from "./types.js";

/**
 * Keyword lists per risk tier.
 * Matches use word-boundary RegExp (`\b`) to avoid false positives
 * like "explain the deployment" triggering deploy-affecting.
 *
 * Tiers ordered highest-to-lowest so the first match wins at the highest tier.
 */
const TIER_KEYWORDS: { tier: RiskTier; keywords: string[]; confirmation: boolean; intensity: RiskClassification["checklistIntensity"] }[] = [
  {
    tier: "destructive",
    confirmation: true,
    intensity: "strict",
    keywords: [
      "force push", "force-push",
      "rm -rf", "rm -r",
      "drop table", "drop database", "drop schema",
      "truncate table",
      "delete branch", "delete repo",
      "format disk", "fdisk",
      "reset --hard",
    ],
  },
  {
    tier: "deploy-affecting",
    confirmation: true,
    intensity: "strict",
    keywords: [
      "deploy",
      "release",
      "publish",
      "merge to main", "merge to master", "merge to production",
      "push to main", "push to master", "push to production",
      "promote",
    ],
  },
  {
    tier: "build-affecting",
    confirmation: false,
    intensity: "standard",
    keywords: [
      "npm install", "npm ci",
      "yarn add", "yarn install",
      "pnpm add", "pnpm install",
      "pip install",
      "tsconfig",
      "dockerfile",
      "docker build",
      "webpack",
      "vite config",
      "babel config",
      "eslint config",
      "package.json",
    ],
  },
  {
    tier: "file-modification",
    confirmation: false,
    intensity: "standard",
    keywords: [
      "edit",
      "fix",
      "refactor",
      "create",
      "write",
      "update",
      "modify",
      "rename",
      "move",
      "delete file",
      "add file",
      "change",
    ],
  },
  {
    tier: "read-only",
    confirmation: false,
    intensity: "light",
    keywords: [
      "explain",
      "search",
      "list",
      "show",
      "describe",
      "read",
      "find",
      "look",
      "check",
      "display",
      "print",
      "help",
      "what is",
      "how does",
    ],
  },
];

/**
 * Pre-compiled word-boundary patterns for each tier.
 * Built once at module load for performance.
 */
const TIER_PATTERNS: { tier: RiskTier; patterns: { regex: RegExp; keyword: string }[]; confirmation: boolean; intensity: RiskClassification["checklistIntensity"] }[] =
  TIER_KEYWORDS.map(({ tier, keywords, confirmation, intensity }) => ({
    tier,
    confirmation,
    intensity,
    patterns: keywords.map((kw) => ({
      keyword: kw,
      // Word-boundary match, case-insensitive.
      // For multi-word keywords the whole phrase is boundary-wrapped.
      regex: new RegExp(`\\b${escapeRegex(kw)}\\b`, "i"),
    })),
  }));

/**
 * Classify a message's risk tier using word-boundary keyword matching.
 *
 * Improvement over Axiom-Supervisor's substring matching:
 * - "explain the deployment" does NOT trigger deploy-affecting
 * - "deploy" as a standalone verb DOES trigger deploy-affecting
 *
 * Returns the highest matching tier. If no keywords match, defaults to read-only.
 *
 * Exported as a pure function for reuse by M004 MCP tools.
 */
export function classifyRisk(message: string): RiskClassification {
  if (!message || message.trim().length === 0) {
    return {
      tier: "read-only",
      reasons: ["empty or whitespace-only message"],
      requiresConfirmation: false,
      checklistIntensity: "light",
    };
  }

  // Scan tiers highest-to-lowest; collect all matching reasons from the highest tier found.
  let highestTier: RiskTier | null = null;
  let highestConfirmation = false;
  let highestIntensity: RiskClassification["checklistIntensity"] = "light";
  const allReasons: string[] = [];

  for (const { tier, patterns, confirmation, intensity } of TIER_PATTERNS) {
    const tierReasons: string[] = [];

    for (const { regex, keyword } of patterns) {
      if (regex.test(message)) {
        tierReasons.push(keyword);
      }
    }

    if (tierReasons.length > 0) {
      // Record reasons from this tier
      allReasons.push(...tierReasons.map((r) => `[${tier}] ${r}`));

      // If this is the first (highest) matching tier, set the classification
      if (highestTier === null) {
        highestTier = tier;
        highestConfirmation = confirmation;
        highestIntensity = intensity;
      }
    }
  }

  if (highestTier === null) {
    return {
      tier: "read-only",
      reasons: ["no keyword matches — defaulting to read-only"],
      requiresConfirmation: false,
      checklistIntensity: "light",
    };
  }

  return {
    tier: highestTier,
    reasons: allReasons,
    requiresConfirmation: highestConfirmation,
    checklistIntensity: highestIntensity,
  };
}

/** Escape special regex characters in a keyword string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
