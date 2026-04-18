import { describe, it, expect } from "vitest";
import {
  AGENT_PROGRAMS,
  resolveAgentProgram,
} from "../../../packages/core/src/agent-client/registry.js";

describe("AGENT_PROGRAMS", () => {
  it("has claude entry with stream-json output and --mcp-config mode", () => {
    const p = AGENT_PROGRAMS["claude"];
    expect(p).toBeDefined();
    expect(p?.command).toBe("claude");
    expect(p?.oneShotFlags).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(p?.inputMethod).toBe("direct");
    expect(p?.mcpMode).toBe("config-file");
    expect(p?.outputFormat).toBe("stream-json");
  });

  it("has codex entry with exec --json and config-args mcp mode", () => {
    const p = AGENT_PROGRAMS["codex"];
    expect(p).toBeDefined();
    expect(p?.command).toBe("codex");
    expect(p?.oneShotFlags).toEqual(["exec", "--json"]);
    expect(p?.mcpMode).toBe("config-args");
    expect(p?.outputFormat).toBe("codex-json");
  });

  it("has gemini entry with -p plain output and mcp-add injection", () => {
    const p = AGENT_PROGRAMS["gemini"];
    expect(p).toBeDefined();
    expect(p?.command).toBe("gemini");
    expect(p?.oneShotFlags).toEqual(["-p"]);
    expect(p?.mcpMode).toBe("mcp-add");
    expect(p?.outputFormat).toBe("plain");
  });
});

describe("resolveAgentProgram", () => {
  it("returns the entry for known tools", () => {
    expect(resolveAgentProgram("claude")?.command).toBe("claude");
    expect(resolveAgentProgram("codex")?.command).toBe("codex");
    expect(resolveAgentProgram("gemini")?.command).toBe("gemini");
  });

  it("returns undefined for unknown tools", () => {
    expect(resolveAgentProgram("nope")).toBeUndefined();
    expect(resolveAgentProgram("openclaw")).toBeUndefined();
    expect(resolveAgentProgram("hermes")).toBeUndefined();
  });

  it("returns undefined for missing tool", () => {
    expect(resolveAgentProgram(undefined)).toBeUndefined();
  });
});
