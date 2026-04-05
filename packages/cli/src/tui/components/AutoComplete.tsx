/**
 * AutoComplete — suggestion overlay for the workspace shell input.
 *
 * Triggers:
 *   /  at start of input → command suggestions
 *   @  anywhere           → profile suggestions
 *   After /launch or /switch + space → profile suggestions
 *
 * Arrow keys navigate, Tab/Enter accepts, Escape dismisses.
 */

import { Box, Text } from "ink";
import type { ThemeColors } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface Suggestion {
  value: string;
  label: string;
  hint?: string;
  type: "command" | "profile";
}

export interface AutoCompleteState {
  suggestions: Suggestion[];
  selectedIndex: number;
  trigger: string; // the text that triggered completion (e.g., "/sw", "@wo")
  replaceFrom: number; // index in input where replacement starts
}

// ─── Built-in commands ──────────────────────────────────────────────

const COMMANDS: Suggestion[] = [
  { value: "/launch", label: "/launch", hint: "Launch agent tool", type: "command" },
  { value: "/switch", label: "/switch", hint: "Switch active profile", type: "command" },
  { value: "/status", label: "/status", hint: "Show profile status", type: "command" },
  { value: "/dash", label: "/dash", hint: "Open dashboard", type: "command" },
  { value: "/profiles", label: "/profiles", hint: "Profile manager", type: "command" },
  { value: "/doctor", label: "/doctor", hint: "Run diagnostics", type: "command" },
  { value: "/settings", label: "/settings", hint: "Open settings", type: "command" },
  { value: "/help", label: "/help", hint: "Show commands", type: "command" },
  { value: "/create", label: "/create", hint: "Create profile", type: "command" },
  { value: "/clear", label: "/clear", hint: "Clear activity log", type: "command" },
];

// ─── Resolve suggestions from input ─────────────────────────────────

export function resolveAutoComplete(
  input: string,
  profileNames: string[],
): AutoCompleteState | null {
  if (!input) return null;

  // After /launch or /switch + space → profile suggestions
  const profileArgMatch = input.match(/^\/(launch|switch)\s+(\S*)$/);
  if (profileArgMatch) {
    const partial = profileArgMatch[2]!.toLowerCase();
    const filtered = profileNames
      .filter((name) => name.toLowerCase().startsWith(partial))
      .map((name) => ({
        value: name,
        label: name,
        type: "profile" as const,
      }));
    if (filtered.length === 0) return null;
    return {
      suggestions: filtered.slice(0, 8),
      selectedIndex: 0,
      trigger: profileArgMatch[2]!,
      replaceFrom: input.length - profileArgMatch[2]!.length,
    };
  }

  // / at start → command suggestions
  if (input.startsWith("/")) {
    const partial = input.toLowerCase();
    const filtered = COMMANDS.filter((cmd) =>
      cmd.value.toLowerCase().startsWith(partial)
    );
    if (filtered.length === 0 || (filtered.length === 1 && filtered[0]!.value === input)) return null;
    return {
      suggestions: filtered,
      selectedIndex: 0,
      trigger: input,
      replaceFrom: 0,
    };
  }

  // @ anywhere → profile suggestions (find the last @ token being typed)
  const mentionMatch = input.match(/@([\w-]*)$/);
  if (mentionMatch) {
    const partial = mentionMatch[1]!.toLowerCase();
    const filtered = profileNames
      .filter((name) => name.toLowerCase().startsWith(partial))
      .map((name) => ({
        value: `@${name}`,
        label: `@${name}`,
        type: "profile" as const,
      }));
    if (filtered.length === 0) return null;
    return {
      suggestions: filtered.slice(0, 8),
      selectedIndex: 0,
      trigger: mentionMatch[0]!,
      replaceFrom: input.length - mentionMatch[0]!.length,
    };
  }

  return null;
}

// ─── Apply a completion ─────────────────────────────────────────────

export function applyCompletion(
  input: string,
  state: AutoCompleteState,
): string {
  const selected = state.suggestions[state.selectedIndex];
  if (!selected) return input;
  const before = input.slice(0, state.replaceFrom);
  const value = selected.value;
  // Add trailing space for commands that take arguments
  const suffix = selected.type === "command" && (value === "/launch" || value === "/switch")
    ? " "
    : "";
  return before + value + suffix;
}

// ─── Component ──────────────────────────────────────────────────────

interface Props {
  state: AutoCompleteState;
  colors: ThemeColors;
  maxWidth?: number;
}

export function AutoCompleteOverlay({ state, colors, maxWidth }: Props) {
  const width = Math.min(maxWidth ?? 40, 40);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={colors.border}
      width={width}
      marginLeft={2}
    >
      {state.suggestions.map((suggestion, index) => {
        const selected = index === state.selectedIndex;
        const typeColor = suggestion.type === "command" ? colors.accent : colors.primary;

        return (
          <Box
            key={suggestion.value}
            backgroundColor={selected ? colors.bgSelected : undefined}
            paddingX={1}
          >
            <Box width={width - 6} flexShrink={0}>
              <Text color={selected ? typeColor : colors.text} bold={selected}>
                {suggestion.label}
              </Text>
            </Box>
            {suggestion.hint && (
              <Text color={colors.dimmed} wrap="truncate">
                {suggestion.hint}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
