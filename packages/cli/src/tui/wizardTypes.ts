/**
 * Shared step types and helpers for the profile creation/import wizards.
 * Used by both OnboardingScreen and CreateProfileOverlay.
 */
import type { DetectedTool } from "../detect.js";
import type { AuthType } from "../types.js";
import type { CreateProfileInput } from "./createProfile.js";

// ── Shared step shapes ────────────────────────────────────────────────

export type SelectStep = { id: "select"; detected: DetectedTool[]; selected: boolean[]; cursor: number };
export type NamingStep = { id: "naming"; queue: { tool: DetectedTool; name: string }[]; cursor: number; editing: boolean; editValue: string; error: string | null };
export type ImportingStep = { id: "importing"; queue: { tool: DetectedTool; name: string }[]; completed: number; results: string[]; errors: string[]; status: string };
export type NameStep = { id: "name"; value: string; error: string | null };
export type ToolStep = { id: "tool"; selectedIndex: number; name: string };
export type AuthStep = { id: "auth"; selectedIndex: number; name: string; tool: string };
export type ConfirmStep = { id: "confirm"; name: string; tool: string; authType: AuthType };
export type CreatingStep = { id: "creating"; input: CreateProfileInput };

// ── Step metadata helpers ─────────────────────────────────────────────

const STEP_NUMBERS: Record<string, number> = {
  name: 1,
  tool: 2,
  auth: 3,
  confirm: 4,
};

const STEP_LABELS: Record<string, string> = {
  welcome: "Welcome",
  select: "Select tools to import",
  naming: "Review & rename",
  name: "Profile name",
  tool: "Select tool",
  auth: "Auth type",
  confirm: "Confirm",
  creating: "Creating...",
  importing: "Importing...",
  done: "Done",
  error: "Error",
};

const NON_NUMBERED_STEPS = new Set(["welcome", "select", "naming", "importing", "done", "error"]);

export function getStepNumber(stepId: string): number {
  return STEP_NUMBERS[stepId] ?? 0;
}

export function getStepLabel(stepId: string): string {
  return STEP_LABELS[stepId] ?? "";
}

export function getSubtitle(stepId: string): string {
  const label = getStepLabel(stepId);
  if (NON_NUMBERED_STEPS.has(stepId)) return label;
  const num = getStepNumber(stepId);
  return num > 0 ? `Step ${num} of 4 \u2014 ${label}` : label;
}
