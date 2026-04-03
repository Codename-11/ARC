import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createTempArcDir,
  writeMockConfigWithProfiles,
  writeSharedSettings,
  writeSharedClaudeMd,
  writeSharedCommand,
} from "../fixtures/setup.js";

let arcDir: string;
let cleanup: () => void;
let originalArcDir: string | undefined;

beforeEach(() => {
  originalArcDir = process.env["ARC_DIR"];
  const tmp = createTempArcDir();
  arcDir = tmp.arcDir;
  cleanup = tmp.cleanup;
  process.env["ARC_DIR"] = arcDir;
});

afterEach(() => {
  cleanup();
  if (originalArcDir !== undefined) {
    process.env["ARC_DIR"] = originalArcDir;
  } else {
    delete process.env["ARC_DIR"];
  }
});

describe("Shared layer sync", () => {
  it("syncSharedToProfile merges MCP servers into profile settings", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    // Write shared settings with MCP servers
    writeSharedSettings(arcDir, {
      mcpServers: {
        "shared-mcp": { command: "shared-server", args: [] },
      },
    });

    const profileDir = path.join(arcDir, "profiles", "work");

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    syncSharedToProfile(profileDir);

    // Verify the profile's settings.json now contains the shared MCP server
    const settingsPath = path.join(profileDir, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.mcpServers).toBeDefined();
    expect(settings.mcpServers["shared-mcp"]).toBeDefined();
    expect(settings.mcpServers["shared-mcp"].command).toBe("shared-server");
  });

  it("syncSharedToProfile preserves profile-specific MCP servers", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    const profileDir = path.join(arcDir, "profiles", "work");

    // Write profile-specific settings first
    fs.writeFileSync(
      path.join(profileDir, "settings.json"),
      JSON.stringify({
        mcpServers: {
          "my-mcp": { command: "my-server", args: [] },
        },
      }),
      "utf-8"
    );

    // Write shared settings
    writeSharedSettings(arcDir, {
      mcpServers: {
        "shared-mcp": { command: "shared-server", args: [] },
      },
    });

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    syncSharedToProfile(profileDir);

    const settings = JSON.parse(
      fs.readFileSync(path.join(profileDir, "settings.json"), "utf-8")
    );
    // Both profile-specific and shared MCP servers should be present
    expect(settings.mcpServers["my-mcp"]).toBeDefined();
    expect(settings.mcpServers["shared-mcp"]).toBeDefined();
  });

  it("syncSharedToProfile copies shared commands", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    writeSharedCommand(arcDir, "my-command.md", "# My Command\nDo something");

    const profileDir = path.join(arcDir, "profiles", "work");

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    syncSharedToProfile(profileDir);

    const commandPath = path.join(profileDir, "commands", "my-command.md");
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(fs.readFileSync(commandPath, "utf-8")).toContain("My Command");
  });

  it("syncSharedToProfile injects CLAUDE.md when opted in", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    writeSharedClaudeMd(arcDir, "# Shared Instructions\nAlways be polite.");

    const profileDir = path.join(arcDir, "profiles", "work");

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    syncSharedToProfile(profileDir, { claudeMd: true });

    const claudeMdPath = path.join(profileDir, "CLAUDE.md");
    expect(fs.existsSync(claudeMdPath)).toBe(true);
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("Shared Instructions");
    expect(content).toContain("arc:shared:start");
    expect(content).toContain("arc:shared:end");
  });

  it("syncSharedToProfile writes a manifest file", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    writeSharedSettings(arcDir, {
      mcpServers: {
        "test-mcp": { command: "test", args: [] },
      },
    });

    const profileDir = path.join(arcDir, "profiles", "work");

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    syncSharedToProfile(profileDir);

    const manifestPath = path.join(profileDir, ".arc-shared.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.syncedAt).toBeDefined();
    expect(manifest.mcpServers).toContain("test-mcp");
  });

  it("unsyncSharedFromProfile removes shared MCP servers", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    writeSharedSettings(arcDir, {
      mcpServers: {
        "shared-mcp": { command: "shared-server", args: [] },
      },
    });

    const profileDir = path.join(arcDir, "profiles", "work");

    // First sync
    const { syncSharedToProfile, unsyncSharedFromProfile } = await import(
      "@axiom-labs/arc-core"
    );
    syncSharedToProfile(profileDir);

    // Verify it was synced
    let settings = JSON.parse(
      fs.readFileSync(path.join(profileDir, "settings.json"), "utf-8")
    );
    expect(settings.mcpServers["shared-mcp"]).toBeDefined();

    // Now unsync
    unsyncSharedFromProfile(profileDir);

    settings = JSON.parse(
      fs.readFileSync(path.join(profileDir, "settings.json"), "utf-8")
    );
    expect(settings.mcpServers["shared-mcp"]).toBeUndefined();

    // Manifest should be removed
    expect(fs.existsSync(path.join(profileDir, ".arc-shared.json"))).toBe(false);
  });

  it("unsyncSharedFromProfile removes synced commands", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    writeSharedCommand(arcDir, "shared-cmd.md", "# Shared");

    const profileDir = path.join(arcDir, "profiles", "work");

    const { syncSharedToProfile, unsyncSharedFromProfile } = await import(
      "@axiom-labs/arc-core"
    );
    syncSharedToProfile(profileDir);
    expect(
      fs.existsSync(path.join(profileDir, "commands", "shared-cmd.md"))
    ).toBe(true);

    unsyncSharedFromProfile(profileDir);
    expect(
      fs.existsSync(path.join(profileDir, "commands", "shared-cmd.md"))
    ).toBe(false);
  });
});

describe("Shared layer pull", () => {
  it("pullProfileToShared extracts MCP servers to shared layer", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    const profileDir = path.join(arcDir, "profiles", "work");

    // Write profile settings with MCP servers
    fs.writeFileSync(
      path.join(profileDir, "settings.json"),
      JSON.stringify({
        mcpServers: {
          "profile-mcp": { command: "profile-server", args: [] },
        },
      }),
      "utf-8"
    );

    const { pullProfileToShared } = await import("@axiom-labs/arc-core");
    const result = pullProfileToShared(profileDir, "claude");

    expect(result.mcpServers).toContain("profile-mcp");

    // Verify shared settings.json was created
    const sharedSettingsPath = path.join(arcDir, "shared", "settings.json");
    expect(fs.existsSync(sharedSettingsPath)).toBe(true);
    const sharedSettings = JSON.parse(
      fs.readFileSync(sharedSettingsPath, "utf-8")
    );
    expect(sharedSettings.mcpServers["profile-mcp"]).toBeDefined();
    expect(sharedSettings._sourceTool).toBe("claude");
  });

  it("pullProfileToShared copies commands to shared layer", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    const profileDir = path.join(arcDir, "profiles", "work");
    const commandsDir = path.join(profileDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "review.md"),
      "# Review\nReview code",
      "utf-8"
    );

    const { pullProfileToShared } = await import("@axiom-labs/arc-core");
    const result = pullProfileToShared(profileDir);

    expect(result.commands).toContain("review.md");

    const sharedCommandPath = path.join(
      arcDir,
      "shared",
      "commands",
      "review.md"
    );
    expect(fs.existsSync(sharedCommandPath)).toBe(true);
  });

  it("pullProfileToShared copies CLAUDE.md to shared layer", async () => {
    writeMockConfigWithProfiles(arcDir, {
      work: { authType: "oauth", tool: "claude" },
    });

    const profileDir = path.join(arcDir, "profiles", "work");
    fs.writeFileSync(
      path.join(profileDir, "CLAUDE.md"),
      "# My Custom Instructions\nBe concise.",
      "utf-8"
    );

    const { pullProfileToShared } = await import("@axiom-labs/arc-core");
    const result = pullProfileToShared(profileDir);

    expect(result.claudeMd).toBe(true);

    const sharedClaudeMdPath = path.join(arcDir, "shared", "CLAUDE.md");
    expect(fs.existsSync(sharedClaudeMdPath)).toBe(true);
    expect(fs.readFileSync(sharedClaudeMdPath, "utf-8")).toContain(
      "My Custom Instructions"
    );
  });

  it("cross-tool sync produces a warning", async () => {
    writeMockConfigWithProfiles(arcDir, {
      gemini: { authType: "api-key", tool: "gemini" },
    });

    // Shared layer was configured for claude
    writeSharedSettings(arcDir, {
      _sourceTool: "claude",
      mcpServers: {
        "claude-mcp": { command: "claude-server", args: [] },
      },
    });

    const profileDir = path.join(arcDir, "profiles", "gemini");

    const { syncSharedToProfile } = await import("@axiom-labs/arc-core");
    const result = syncSharedToProfile(profileDir, {}, "gemini");

    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("claude");
    expect(result.warning).toContain("gemini");
  });
});
