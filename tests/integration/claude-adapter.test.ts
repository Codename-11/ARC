import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempArcDir } from "../fixtures/setup.js";

let arcDir: string;
let cleanup: () => void;
let originalArcDir: string | undefined;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  originalArcDir = process.env["ARC_DIR"];
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];

  const tmp = createTempArcDir();
  arcDir = tmp.arcDir;
  cleanup = tmp.cleanup;
  process.env["ARC_DIR"] = arcDir;
});

afterEach(() => {
  cleanup();
  if (originalArcDir !== undefined) process.env["ARC_DIR"] = originalArcDir;
  else delete process.env["ARC_DIR"];

  if (originalHome !== undefined) process.env["HOME"] = originalHome;
  else delete process.env["HOME"];

  if (originalUserProfile !== undefined) process.env["USERPROFILE"] = originalUserProfile;
  else delete process.env["USERPROFILE"];
});

describe("Claude adapter parity", () => {
  it("reads wrapped Claude OAuth credentials and preserves account tier", async () => {
    const configDir = path.join(arcDir, "profiles", "work");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, ".credentials.json"),
      JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: "token",
            refreshToken: "refresh",
            expiresAt: Date.now() - 60_000,
            rateLimitTier: "default_claude_max_20x",
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const { getClaudeCredentialStatus } = await import("../../packages/adapter-claude/src/auth.js");
    const status = await getClaudeCredentialStatus({
      authType: "oauth",
      tool: "claude",
      configDir,
      createdAt: new Date().toISOString(),
    });

    expect(status.authenticated).toBe(true);
    expect(status.accountTier).toBe("max (20x)");
    expect(status.expired).toBe(false);
  });

  it("builds Claude launch env with auth sanitization and mode flags", async () => {
    const { buildClaudeProfileEnv } = await import("../../packages/adapter-claude/src/auth.js");
    const env = await buildClaudeProfileEnv(
      {
        authType: "bedrock",
        tool: "claude",
        configDir: "C:/tmp/claude-profile",
        createdAt: new Date().toISOString(),
        envOverrides: {
          AWS_PROFILE: "work",
        },
      },
      "work"
    );

    expect(env["CLAUDE_CONFIG_DIR"]).toBe("C:/tmp/claude-profile");
    expect(env["CLAUDE_CODE_USE_BEDROCK"]).toBe("1");
    expect(env["AWS_PROFILE"]).toBe("work");
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("imports fallback .claude.json when the source config omits it", async () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "arc-home-"));
    process.env["HOME"] = fakeHome;
    process.env["USERPROFILE"] = fakeHome;

    fs.writeFileSync(
      path.join(fakeHome, ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "test" } } }, null, 2),
      "utf-8"
    );

    const sourceDir = path.join(fakeHome, ".claude");
    const targetDir = path.join(arcDir, "profiles", "work");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    const { importClaudeArtifacts } = await import("../../packages/adapter-claude/src/import.js");
    const copied = importClaudeArtifacts(sourceDir, targetDir);

    expect(copied).toContain(".claude.json");
    expect(fs.existsSync(path.join(targetDir, ".claude.json"))).toBe(true);
  });
});
