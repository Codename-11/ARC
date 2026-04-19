import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  writeMcpConfigFile,
  buildMcpConfigArgs,
  cleanupMcpTempFiles,
  __peekTempFiles,
} from "../../../packages/core/src/agent-client/mcp-injection.js";
import type { McpConfigInjection } from "../../../packages/core/src/agent-client/types.js";

// TODO Phase 1 smoke: integration tests requiring real claude/codex/gemini in CI-skipped mode

afterEach(() => {
  cleanupMcpTempFiles();
});

describe("writeMcpConfigFile", () => {
  it("writes { mcpServers: {...} } JSON to a temp file", () => {
    const injection: McpConfigInjection = {
      mode: "config-file",
      servers: {
        arc: {
          command: "node",
          args: ["server.mjs"],
          env: { TOKEN: "xyz" },
        },
      },
    };
    const file = writeMcpConfigFile(injection);
    expect(existsSync(file)).toBe(true);

    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed).toEqual({
      mcpServers: {
        arc: {
          command: "node",
          args: ["server.mjs"],
          env: { TOKEN: "xyz" },
        },
      },
    });
  });

  it("tracks temp files so cleanup can remove them", () => {
    const injection: McpConfigInjection = {
      mode: "config-file",
      servers: { arc: { command: "node" } },
    };
    const file = writeMcpConfigFile(injection);
    expect(__peekTempFiles().files).toContain(file);
    cleanupMcpTempFiles();
    expect(existsSync(file)).toBe(false);
    expect(__peekTempFiles().files).toHaveLength(0);
  });

  it("rejects the wrong mode", () => {
    expect(() =>
      writeMcpConfigFile({ mode: "config-args", servers: {} } as McpConfigInjection),
    ).toThrow(/config-file/);
  });
});

describe("buildMcpConfigArgs", () => {
  it("emits -c flags with TOML literals for command/args/env", () => {
    const injection: McpConfigInjection = {
      mode: "config-args",
      servers: {
        arc: {
          command: "node",
          args: ["/path/to/server.mjs"],
          env: { TOKEN: "abc", NAME: "bob's server" },
        },
      },
    };
    const args = buildMcpConfigArgs(injection);

    // Flat pairs of ["-c", "expr"]
    expect(args[0]).toBe("-c");
    expect(args[1]).toBe("mcp.servers.arc.command='node'");
    expect(args[2]).toBe("-c");
    expect(args[3]).toBe("mcp.servers.arc.args=['/path/to/server.mjs']");

    // Env entries follow — order not guaranteed but each comes as a -c pair
    const env1Idx = args.indexOf("mcp.servers.arc.env.TOKEN='abc'");
    expect(env1Idx).toBeGreaterThan(0);
    expect(args[env1Idx - 1]).toBe("-c");

    const env2Idx = args.indexOf("mcp.servers.arc.env.NAME='bob''s server'");
    expect(env2Idx).toBeGreaterThan(0);
  });

  it("handles servers with no args / env", () => {
    const injection: McpConfigInjection = {
      mode: "config-args",
      servers: { bare: { command: "echo" } },
    };
    const args = buildMcpConfigArgs(injection);
    expect(args).toEqual(["-c", "mcp.servers.bare.command='echo'"]);
  });

  it("rejects the wrong mode", () => {
    expect(() =>
      buildMcpConfigArgs({ mode: "config-file", servers: {} } as McpConfigInjection),
    ).toThrow(/config-args/);
  });
});

describe("cleanupMcpTempFiles", () => {
  it("is idempotent (safe to call with nothing tracked)", () => {
    cleanupMcpTempFiles();
    cleanupMcpTempFiles();
    expect(__peekTempFiles().files).toHaveLength(0);
  });
});
