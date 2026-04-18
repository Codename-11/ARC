/**
 * MCP injection helpers for the three supported modes:
 * - `config-file` — write `{ mcpServers: {...} }` JSON to a temp file.
 * - `config-args` — emit repeated `-c mcp.servers.<name>.<field>=<value>` args.
 * - `mcp-add` — run `<binary> mcp add --scope <scope> <name> <cmd> [args]`
 *   before the main launch.
 *
 * See docs/plans/ai-and-roundtable.md AD-1 / AD-7.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { McpConfigInjection, McpServerDef } from "./types.js";

/** Temp files created this session, cleaned up on demand. */
const tempFiles: string[] = [];
const tempDirs: string[] = [];

/**
 * Write the MCP injection as a JSON file suitable for Claude's `--mcp-config`.
 * Returns the absolute path of the file. The file is tracked for later cleanup
 * via `cleanupMcpTempFiles`.
 *
 * Throws if `injection.mode !== "config-file"` — callers must use the matching
 * helper for other modes.
 */
export function writeMcpConfigFile(injection: McpConfigInjection): string {
  if (injection.mode !== "config-file") {
    throw new Error(
      `writeMcpConfigFile requires mode=config-file (got ${injection.mode})`,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "arc-mcp-"));
  tempDirs.push(dir);
  const file = path.join(dir, "mcp-config.json");

  const payload = { mcpServers: injection.servers };
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  tempFiles.push(file);
  return file;
}

/**
 * Build the `-c mcp.servers.<name>.<field>=<value>` flag pairs for Codex.
 * Produces flat tokens, e.g.:
 *
 *   ["-c", "mcp.servers.arc.command='node'",
 *    "-c", "mcp.servers.arc.args=['...']",
 *    "-c", "mcp.servers.arc.env.FOO='bar'"]
 *
 * Values are emitted as TOML single-quoted literals (`'...'`) with `'`
 * doubled per TOML escape rules. Arrays are serialized as TOML inline arrays.
 */
export function buildMcpConfigArgs(injection: McpConfigInjection): string[] {
  if (injection.mode !== "config-args") {
    throw new Error(
      `buildMcpConfigArgs requires mode=config-args (got ${injection.mode})`,
    );
  }

  const out: string[] = [];
  for (const [name, def] of Object.entries(injection.servers)) {
    const base = `mcp.servers.${name}`;
    out.push("-c", `${base}.command=${toTomlLiteral(def.command)}`);

    if (def.args && def.args.length > 0) {
      const list = def.args.map(toTomlLiteral).join(", ");
      out.push("-c", `${base}.args=[${list}]`);
    }

    if (def.env) {
      for (const [k, v] of Object.entries(def.env)) {
        out.push("-c", `${base}.env.${k}=${toTomlLiteral(v)}`);
      }
    }
  }
  return out;
}

/**
 * Execute `<binary> mcp add --scope <scope> <name> <cmd> [args...]` for each
 * server in the injection. Used by Gemini (and any other tool that registers
 * servers via CLI pre-launch).
 */
export async function runMcpAdd(
  injection: McpConfigInjection,
  binary: string,
  scope: "user" | "project" = "project",
): Promise<void> {
  if (injection.mode !== "mcp-add") {
    throw new Error(
      `runMcpAdd requires mode=mcp-add (got ${injection.mode})`,
    );
  }

  for (const [name, def] of Object.entries(injection.servers)) {
    const envFlags: string[] = [];
    if (def.env) {
      for (const [k, v] of Object.entries(def.env)) {
        envFlags.push("-e", `${k}=${v}`);
      }
    }

    const args = [
      "mcp",
      "add",
      "--scope",
      scope,
      name,
      ...envFlags,
      def.command,
      ...(def.args ?? []),
    ];

    await runCmd(binary, args);
  }
}

/**
 * Remove every temp file / dir created during this process lifetime.
 * Safe to call more than once; errors are swallowed (best-effort cleanup).
 */
export function cleanupMcpTempFiles(): void {
  for (const f of tempFiles.splice(0)) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Internal: run a child process to completion. Rejects on non-zero exit. */
function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

/** Render a value as a TOML single-quoted string literal. */
function toTomlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Internal accessor for tests (not exported from the package barrel).
export function __peekTempFiles(): { files: string[]; dirs: string[] } {
  return { files: [...tempFiles], dirs: [...tempDirs] };
}

// Re-export type for convenience.
export type { McpServerDef };
