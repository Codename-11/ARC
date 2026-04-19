import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  providerPresets,
  getProviderPreset,
  listProviderPresets,
  resolveProvider,
} from "@axiom-labs/arc-core";
import type { Profile, ProviderConfig } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    authType: "oauth",
    tool: "claude",
    configDir: "/tmp/p",
    createdAt: "2026-04-19T00:00:00Z",
    ...overrides,
  };
}

// ─── Preset lookup ───────────────────────────────────────────────────

describe("providerPresets", () => {
  const expected = [
    "zai-glm",
    "qwen-max",
    "deepseek-chat",
    "ollama-claude-local",
    "claude-work",
    "claude-personal",
  ] as const;

  it("exposes all 6 documented presets", () => {
    for (const id of expected) {
      expect(providerPresets[id]).toBeDefined();
    }
    expect(listProviderPresets()).toEqual(expect.arrayContaining([...expected]));
  });

  it("every preset has `extends: claude` (for this v3 drop)", () => {
    for (const id of expected) {
      expect(providerPresets[id]!.extends).toBe("claude");
    }
  });

  it("zai-glm ships correct Anthropic-compat env and model", () => {
    const p = getProviderPreset("zai-glm")!;
    expect(p.env?.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(p.env?.ANTHROPIC_AUTH_TOKEN_ENV).toBe("ZAI_API_KEY");
    expect(p.models).toEqual(["glm-4.6"]);
  });

  it("qwen-max ships DashScope URL and dual models", () => {
    const p = getProviderPreset("qwen-max")!;
    expect(p.env?.ANTHROPIC_BASE_URL).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v2/apps/anthropic"
    );
    expect(p.env?.ANTHROPIC_AUTH_TOKEN_ENV).toBe("DASHSCOPE_API_KEY");
    expect(p.models).toEqual(["qwen-max", "qwen-plus"]);
  });

  it("deepseek-chat ships Anthropic-compat URL and reasoner model", () => {
    const p = getProviderPreset("deepseek-chat")!;
    expect(p.env?.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(p.env?.ANTHROPIC_AUTH_TOKEN_ENV).toBe("DEEPSEEK_API_KEY");
    expect(p.models).toContain("deepseek-reasoner");
  });

  it("ollama-claude-local points at loopback port 11434 with no auth var", () => {
    const p = getProviderPreset("ollama-claude-local")!;
    expect(p.env?.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:11434/anthropic");
    expect(p.env?.ANTHROPIC_AUTH_TOKEN_ENV).toBeUndefined();
  });

  it("claude-work and claude-personal split CLAUDE_CONFIG_DIR", () => {
    const work = getProviderPreset("claude-work")!;
    const personal = getProviderPreset("claude-personal")!;
    expect(work.env?.CLAUDE_CONFIG_DIR).toBe("~/.arc/profiles/claude-work/config");
    expect(personal.env?.CLAUDE_CONFIG_DIR).toBe(
      "~/.arc/profiles/claude-personal/config"
    );
    expect(work.label).toBe("Claude (work)");
    expect(personal.label).toBe("Claude (personal)");
  });

  it("getProviderPreset returns undefined for unknown id", () => {
    expect(getProviderPreset("does-not-exist")).toBeUndefined();
  });
});

// ─── resolveProvider merge semantics ─────────────────────────────────

describe("resolveProvider", () => {
  it("returns undefined when profile has no provider", () => {
    expect(resolveProvider(baseProfile())).toBeUndefined();
  });

  it("idempotent: no `extends` returns the provider unchanged", () => {
    const provider: ProviderConfig = {
      baseUrl: "https://api.openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4",
    };
    const profile = baseProfile({ provider });
    const resolved = resolveProvider(profile)!;
    expect(resolved).toEqual(provider);
    // must be a fresh object (caller may mutate without affecting profile)
    expect(resolved).not.toBe(provider);
  });

  it("applies preset fields when profile copies a preset into provider", () => {
    // NOTE: resolveProvider keys the preset lookup off `profile.provider.extends`.
    // The preset id values (zai-glm, claude-work, ...) themselves are NOT listed
    // in ProviderExtends — that enum is the builtin-adapter set. When a caller
    // wants the preset's content, they shallow-copy the preset into `provider`
    // (the CLI `--preset` path does exactly this), which makes `extends: "claude"`
    // and all other fields available on the profile itself.
    const profile = baseProfile({
      provider: { ...providerPresets["zai-glm"] } as ProviderConfig,
    });
    const resolved = resolveProvider(profile)!;
    expect(resolved.extends).toBe("claude");
    expect(resolved.env?.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(resolved.models).toEqual(["glm-4.6"]);
  });

  it("profile fields win over preset fields (scalar override)", () => {
    const profile = baseProfile({
      provider: {
        ...providerPresets["zai-glm"],
        model: "glm-4.6-override",
        displayName: "My Z.AI",
      } as ProviderConfig,
    });
    const resolved = resolveProvider(profile)!;
    expect(resolved.model).toBe("glm-4.6-override");
    expect(resolved.displayName).toBe("My Z.AI");
    // Unchanged preset fields still flow through
    expect(resolved.env?.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
  });

  it("env is shallow-merged key-by-key; profile values win over extends source", () => {
    // resolveProvider looks up `extends` against adapter defaults first, then
    // provider presets. To exercise a meaningful env-merge we point `extends`
    // at a preset id (claude-work) — CLI copy-through doesn't normally produce
    // this shape, but it's a valid merge path because ADAPTER_DEFAULTS[claude]
    // is empty.
    const profile = baseProfile({
      provider: {
        extends: "claude-work" as unknown as ProviderConfig["extends"],
        env: {
          CLAUDE_CONFIG_DIR: "/custom/override/path",
          EXTRA_KEY: "set-by-profile",
        },
      },
    });

    const resolved = resolveProvider(profile)!;
    // Profile override wins
    expect(resolved.env?.CLAUDE_CONFIG_DIR).toBe("/custom/override/path");
    // Profile's extra key is preserved
    expect(resolved.env?.EXTRA_KEY).toBe("set-by-profile");
  });

  it("unknown extends value is tolerated (fallback: profile unchanged)", () => {
    const profile = baseProfile({
      provider: {
        extends: "no-such-adapter" as unknown as ProviderConfig["extends"],
        baseUrl: "https://example.com",
      },
    });
    const resolved = resolveProvider(profile)!;
    expect(resolved.baseUrl).toBe("https://example.com");
    expect(resolved.extends).toBe("no-such-adapter");
  });

  it("does not mutate the profile's provider object", () => {
    const provider: ProviderConfig = {
      ...providerPresets["zai-glm"],
    } as ProviderConfig;
    const snapshot = JSON.parse(JSON.stringify(provider));
    const profile = baseProfile({ provider });
    resolveProvider(profile);
    expect(profile.provider).toEqual(snapshot);
  });
});

// ─── CLI smoke: handleProviderSet with --preset ──────────────────────

describe("arc provider set --preset", () => {
  let tmpDir: string;
  let origArcDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-provider-test-"));
    origArcDir = process.env.ARC_DIR;
    process.env.ARC_DIR = tmpDir;
  });

  afterEach(() => {
    if (origArcDir === undefined) delete process.env.ARC_DIR;
    else process.env.ARC_DIR = origArcDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--preset zai-glm writes merged provider to config", async () => {
    // Seed config with a minimal profile so the CLI can find it.
    const { saveConfig } = await import("@axiom-labs/arc-core");
    saveConfig({
      version: 1,
      activeProfile: "myprof",
      profiles: {
        myprof: {
          authType: "oauth",
          tool: "claude",
          configDir: path.join(tmpDir, "profiles", "myprof"),
          createdAt: new Date().toISOString(),
        },
      },
    });

    // process.exit(1) on error — mock it so failures surface as thrown errors
    const realExit = process.exit;
    const exitSpy = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    (process as unknown as { exit: typeof process.exit }).exit = exitSpy;
    try {
      const mod = await import("../packages/cli/src/commands/provider.js");
      await mod.handleProviderSet("myprof", { preset: "zai-glm" });
    } finally {
      (process as unknown as { exit: typeof process.exit }).exit = realExit;
    }

    const { loadConfig } = await import("@axiom-labs/arc-core");
    const config = loadConfig();
    const prov = config.profiles["myprof"]!.provider!;
    expect(prov.extends).toBe("claude");
    expect(prov.env?.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(prov.env?.ANTHROPIC_AUTH_TOKEN_ENV).toBe("ZAI_API_KEY");
    expect(prov.models).toEqual(["glm-4.6"]);
  });

  it("--preset unknown-id exits non-zero and does not mutate config", async () => {
    const { saveConfig } = await import("@axiom-labs/arc-core");
    saveConfig({
      version: 1,
      activeProfile: "myprof",
      profiles: {
        myprof: {
          authType: "oauth",
          tool: "claude",
          configDir: path.join(tmpDir, "profiles", "myprof"),
          createdAt: new Date().toISOString(),
        },
      },
    });

    const realExit = process.exit;
    const exitSpy = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    (process as unknown as { exit: typeof process.exit }).exit = exitSpy;
    try {
      const mod = await import("../packages/cli/src/commands/provider.js");
      await expect(
        mod.handleProviderSet("myprof", { preset: "does-not-exist" })
      ).rejects.toThrow(/process\.exit\(1\)/);
    } finally {
      (process as unknown as { exit: typeof process.exit }).exit = realExit;
    }

    const { loadConfig } = await import("@axiom-labs/arc-core");
    expect(loadConfig().profiles["myprof"]!.provider).toBeUndefined();
  });

  it("--preset + --model explicit override wins over preset model", async () => {
    const { saveConfig } = await import("@axiom-labs/arc-core");
    saveConfig({
      version: 1,
      activeProfile: "myprof",
      profiles: {
        myprof: {
          authType: "oauth",
          tool: "claude",
          configDir: path.join(tmpDir, "profiles", "myprof"),
          createdAt: new Date().toISOString(),
        },
      },
    });

    const realExit = process.exit;
    const exitSpy = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    (process as unknown as { exit: typeof process.exit }).exit = exitSpy;
    try {
      const mod = await import("../packages/cli/src/commands/provider.js");
      await mod.handleProviderSet("myprof", {
        preset: "qwen-max",
        model: "qwen-turbo",
      });
    } finally {
      (process as unknown as { exit: typeof process.exit }).exit = realExit;
    }

    const { loadConfig } = await import("@axiom-labs/arc-core");
    const prov = loadConfig().profiles["myprof"]!.provider!;
    expect(prov.model).toBe("qwen-turbo");
    expect(prov.extends).toBe("claude");
  });
});
