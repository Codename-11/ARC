import { describe, expect, it } from "vitest";
import { listAdapters, getAdapter } from "../../packages/cli/src/adapters/index.js";

// ─── Characterization tests ─────────────────────────────────────────
// These lock down existing adapter behavior as a regression baseline.
// They describe current behavior, not ideal behavior.

describe("Adapter registry", () => {
  it("listAdapters() returns exactly 3 adapters", () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(3);
    const ids = adapters.map((a) => a.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("gemini");
    expect(ids).toContain("codex");
  });

  it('getAdapter("claude") returns adapter with id "claude" and displayName "Claude Code"', () => {
    const adapter = getAdapter("claude");
    expect(adapter.id).toBe("claude");
    expect(adapter.displayName).toBe("Claude Code");
  });

  it('getAdapter("gemini") returns adapter with id "gemini" and displayName "Gemini CLI"', () => {
    const adapter = getAdapter("gemini");
    expect(adapter.id).toBe("gemini");
    expect(adapter.displayName).toBe("Gemini CLI");
  });

  it('getAdapter("codex") returns adapter with id "codex" and displayName "Codex CLI"', () => {
    const adapter = getAdapter("codex");
    expect(adapter.id).toBe("codex");
    expect(adapter.displayName).toBe("Codex CLI");
  });

  it("getAdapter() with unknown tool returns a fallback adapter (not undefined/null)", () => {
    const adapter = getAdapter("unknown-tool");
    expect(adapter).toBeDefined();
    expect(adapter).not.toBeNull();
    expect(adapter.id).toBe("unknown-tool");
    expect(adapter.displayName).toBe("unknown-tool");
  });
});

describe("Claude adapter capabilities", () => {
  const adapter = getAdapter("claude");

  it("capabilities.hooks is true", () => {
    expect(adapter.capabilities.hooks).toBe(true);
  });

  it("capabilities.sdkControl is true", () => {
    expect(adapter.capabilities.sdkControl).toBe(true);
  });

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is false", () => {
    expect(adapter.capabilities.sandboxing).toBe(false);
  });

  it('getInstallHint() returns a string containing "claude-code"', () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint).toContain("claude-code");
  });
});

describe("Gemini adapter capabilities", () => {
  const adapter = getAdapter("gemini");

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is true", () => {
    expect(adapter.capabilities.sandboxing).toBe(true);
  });

  it("capabilities.hooks is false", () => {
    expect(adapter.capabilities.hooks).toBe(false);
  });

  it("getInstallHint() returns a string", () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint.length).toBeGreaterThan(0);
  });
});

describe("Codex adapter capabilities", () => {
  const adapter = getAdapter("codex");

  it("capabilities.mcpSupport is true", () => {
    expect(adapter.capabilities.mcpSupport).toBe(true);
  });

  it("capabilities.sandboxing is true", () => {
    expect(adapter.capabilities.sandboxing).toBe(true);
  });

  it("capabilities.hooks is false", () => {
    expect(adapter.capabilities.hooks).toBe(false);
  });

  it('getInstallHint() returns a string containing "codex"', () => {
    const hint = adapter.getInstallHint();
    expect(hint).toBeTypeOf("string");
    expect(hint).toContain("codex");
  });
});

describe("Lifecycle stubs (all adapters)", () => {
  const adapterIds = ["claude", "gemini", "codex"] as const;

  for (const id of adapterIds) {
    describe(`${id} adapter`, () => {
      const adapter = getAdapter(id);
      const dummyProfile = {
        authType: "oauth" as const,
        tool: id,
        configDir: "/tmp/fake",
        createdAt: new Date().toISOString(),
      };
      const dummyProcess = {
        pid: 1234,
        tool: id,
        profile: "default",
        startedAt: new Date(),
      };

      it('launch() throws "not implemented"', async () => {
        await expect(
          adapter.launch(dummyProfile, { args: [], env: {} })
        ).rejects.toThrow("not implemented");
      });

      it('terminate() throws "not implemented"', async () => {
        await expect(adapter.terminate(dummyProcess)).rejects.toThrow(
          "not implemented"
        );
      });

      it('isRunning() throws "not implemented"', () => {
        expect(() => adapter.isRunning(dummyProcess)).toThrow(
          "not implemented"
        );
      });
    });
  }
});
