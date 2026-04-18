import { describe, it, expect } from "vitest";
import {
  getAgentClientForProfile,
  buildProfileEnv,
} from "../../../packages/core/src/agent-client/dispatch.js";
import { ClaudeAgentClient } from "../../../packages/core/src/agent-client/claude.js";
import { CodexAgentClient } from "../../../packages/core/src/agent-client/codex.js";
import { GeminiAgentClient } from "../../../packages/core/src/agent-client/gemini.js";
import type { Profile } from "../../../packages/core/src/types.js";

// TODO Phase 1 smoke: integration tests requiring real claude/codex/gemini in CI-skipped mode

function makeProfile(tool: string | undefined, overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "api-key",
    tool,
    configDir: "/tmp/arc-test-profile",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("getAgentClientForProfile", () => {
  it("returns a ClaudeAgentClient for claude profiles", () => {
    const client = getAgentClientForProfile(makeProfile("claude"));
    expect(client).toBeInstanceOf(ClaudeAgentClient);
  });

  it("returns a CodexAgentClient for codex profiles", () => {
    const client = getAgentClientForProfile(makeProfile("codex"));
    expect(client).toBeInstanceOf(CodexAgentClient);
  });

  it("returns a GeminiAgentClient for gemini profiles", () => {
    const client = getAgentClientForProfile(makeProfile("gemini"));
    expect(client).toBeInstanceOf(GeminiAgentClient);
  });

  it("throws on unsupported tool (hermes)", () => {
    expect(() => getAgentClientForProfile(makeProfile("hermes"))).toThrow(
      /No AgentClient implementation/,
    );
  });

  it("throws on unsupported tool (openclaw)", () => {
    expect(() => getAgentClientForProfile(makeProfile("openclaw"))).toThrow(
      /No AgentClient implementation/,
    );
  });

  it("throws on missing tool", () => {
    expect(() => getAgentClientForProfile(makeProfile(undefined))).toThrow(
      /no tool set/,
    );
  });
});

describe("buildProfileEnv", () => {
  it("merges process.env + envOverrides + ARC_CONFIG_DIR", () => {
    const profile = makeProfile("claude", {
      configDir: "/custom/dir",
      envOverrides: { FOO: "bar" },
    });
    const env = buildProfileEnv(profile);
    expect(env["FOO"]).toBe("bar");
    expect(env["ARC_CONFIG_DIR"]).toBe("/custom/dir");
    // Inherit PATH from process.env (sanity: not undefined)
    expect(env["PATH"]).toBeDefined();
  });

  it("applies extraEnv last, overriding profile overrides", () => {
    const profile = makeProfile("claude", { envOverrides: { FOO: "bar" } });
    const env = buildProfileEnv(profile, { FOO: "baz" });
    expect(env["FOO"]).toBe("baz");
  });
});
