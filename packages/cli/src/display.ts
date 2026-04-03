import pc from "picocolors";

// ── ANSI Helpers ───────────────────────────────────

/** Strip ANSI escape codes for visible-length calculations. */
export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

// ── Message Functions ──────────────────────────────

export function success(msg: string): void {
  console.log(pc.green("\u2714") + " " + msg);
}

export function error(msg: string): void {
  process.stderr.write(pc.red("\u2716") + " " + msg + "\n");
}

export function warn(msg: string): void {
  process.stderr.write(pc.yellow("\u26A0") + " " + msg + "\n");
}

export function info(msg: string): void {
  console.log(pc.blue("\u2139") + " " + msg);
}

// ── Formatting Helpers ─────────────────────────────

/** Bold cyan for inline command references. */
export function cmd(text: string): string {
  return pc.bold(pc.cyan(text));
}

/** Dim text for secondary information. */
export function subtle(text: string): string {
  return pc.dim(text);
}

/** Detail line with left pipe border (sub-info under a success/error). */
export function detail(msg: string): void {
  console.log(pc.dim("  \u2502 ") + pc.dim(msg));
}

/** Section header: ─── Title ──────────────────────── */
export function sectionHeader(title: string, width = 48): void {
  const prefix = "\u2500\u2500\u2500 ";
  const titleLen = title.length;
  const remaining = Math.max(1, width - prefix.length - titleLen - 1);
  console.log(
    pc.dim(prefix) + pc.bold(title) + " " + pc.dim("\u2500".repeat(remaining))
  );
}

/** Formatted numbered step with highlighted command. */
export function stepLine(num: number, label: string, command: string): void {
  console.log(pc.dim(`  ${num}. `) + label.padEnd(16) + cmd(command));
}

// ── Box Drawing ────────────────────────────────────

/**
 * Wrap lines in a rounded-corner border box.
 * Handles ANSI-colored content by computing visible width.
 */
export function box(
  lines: string[],
  borderColor: (s: string) => string = pc.cyan
): string {
  const padX = 3;
  const strippedWidths = lines.map((l) => stripAnsi(l).length);
  const maxLen = Math.max(...strippedWidths);
  const innerWidth = maxLen + padX * 2;

  const b = borderColor;
  const top = b("\u256D" + "\u2500".repeat(innerWidth) + "\u256E");
  const bottom = b("\u2570" + "\u2500".repeat(innerWidth) + "\u256F");
  const empty = b("\u2502") + " ".repeat(innerWidth) + b("\u2502");

  const content = lines.map((line, i) => {
    const rightPad = Math.max(0, innerWidth - padX - strippedWidths[i]);
    return (
      b("\u2502") +
      " ".repeat(padX) +
      line +
      " ".repeat(rightPad) +
      b("\u2502")
    );
  });

  return [top, empty, ...content, empty, bottom].join("\n");
}

// ── Tables ─────────────────────────────────────────

export function profileTable(
  profiles: Array<{
    name: string;
    active: boolean;
    authType: string;
    description?: string;
  }>
): string {
  const headers = ["Name", "Active", "Auth Type", "Description"];
  const rows = profiles.map((p) => [
    p.name,
    p.active ? "*" : "",
    p.authType,
    p.description ?? "",
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  const sep = "  ";
  const headerRow = headers
    .map((h, i) => pc.bold(h.padEnd(colWidths[i])))
    .join(sep);
  const separator = pc.dim(
    colWidths.map((w) => "\u2500".repeat(w)).join(sep)
  );
  const dataRows = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(sep)
  );

  return [
    "  " + headerRow,
    "  " + separator,
    ...dataRows.map((r) => "  " + r),
  ].join("\n");
}

// ── Redaction ──────────────────────────────────────

export function redact(value: string): string {
  if (value.length < 12) {
    return "****";
  }
  return value.slice(0, 8) + "..." + value.slice(-4);
}

// ── Version & Branding ─────────────────────────────

import { VERSION } from "./version.js";

export function getVersion(): string {
  return VERSION;
}

/** Compact single-line banner for --help output. */
export function getBanner(): string {
  return (
    pc.dim("[") +
    pc.bold(pc.cyan(">")) +
    pc.dim("]") +
    " " +
    pc.bold(pc.cyan("arc")) +
    " " +
    pc.dim(`v${VERSION}`) +
    pc.dim(" \u2500 Agent Runtime Control")
  );
}

/** Large bordered banner for onboarding welcome screen. */
export function getLargeBanner(): string {
  return box(
    [
      pc.dim("[") +
        pc.bold(pc.cyan(">")) +
        pc.dim("]") +
        "  " +
        pc.bold(pc.cyan("ARC")) +
        " " +
        pc.dim(`v${VERSION}`),
      "   " + pc.dim("Agent Runtime Control"),
      "   " + pc.dim("Unified profile manager for agent CLIs"),
    ],
    pc.cyan
  );
}
