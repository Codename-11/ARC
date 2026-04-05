/**
 * TokenizedInput — syntax-highlighted text rendering for the workspace shell.
 *
 * Parses input into colored segments:
 *   /command  → accent (green)
 *   @profile  → primary (blue)
 *   #tag      → dimmed
 *   plain     → normal text
 */

import { Text } from "ink";
import type { ThemeColors } from "../theme.js";

// ─── Token types ────────────────────────────────────────────────────

export type TokenType = "command" | "mention" | "tag" | "text";

export interface Token {
  type: TokenType;
  value: string;
}

// ─── Tokenizer ──────────────────────────────────────────────────────

const TOKEN_REGEX = /(@[\w-]+|\/[\w-]+|#[\w-]+)/g;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(TOKEN_REGEX)) {
    const matchIndex = match.index!;

    // Text before the match
    if (matchIndex > lastIndex) {
      tokens.push({ type: "text", value: input.slice(lastIndex, matchIndex) });
    }

    const value = match[0]!;
    if (value.startsWith("/")) {
      tokens.push({ type: "command", value });
    } else if (value.startsWith("@")) {
      tokens.push({ type: "mention", value });
    } else {
      tokens.push({ type: "tag", value });
    }

    lastIndex = matchIndex + value.length;
  }

  // Trailing text
  if (lastIndex < input.length) {
    tokens.push({ type: "text", value: input.slice(lastIndex) });
  }

  return tokens;
}

// ─── Token color mapping ────────────────────────────────────────────

function tokenColor(type: TokenType, colors: ThemeColors, valid: boolean): string {
  if (!valid && type !== "text") return colors.error;
  switch (type) {
    case "command":
      return colors.accent;
    case "mention":
      return colors.primary;
    case "tag":
      return colors.dimmed;
    default:
      return colors.text;
  }
}

// ─── Validation ─────────────────────────────────────────────────────

export interface ValidationContext {
  commands: string[];
  profiles: string[];
  tags?: string[];
}

function isValidToken(token: Token, ctx: ValidationContext): boolean {
  switch (token.type) {
    case "command":
      return ctx.commands.includes(token.value);
    case "mention":
      return ctx.profiles.includes(token.value.slice(1)); // strip @
    case "tag":
      return ctx.tags ? ctx.tags.includes(token.value.slice(1)) : true;
    default:
      return true;
  }
}

// ─── Component ──────────────────────────────────────────────────────

interface Props {
  input: string;
  colors: ThemeColors;
  validation?: ValidationContext;
}

export function TokenizedInput({ input, colors, validation }: Props) {
  const tokens = tokenize(input);

  return (
    <Text>
      {tokens.map((token, i) => {
        const valid = validation ? isValidToken(token, validation) : true;
        return (
          <Text key={i} color={tokenColor(token.type, colors, valid)}>
            {token.value}
          </Text>
        );
      })}
    </Text>
  );
}
