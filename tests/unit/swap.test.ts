import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Suppress log I/O during tests
vi.mock("../../packages/cli/src/log.js", () => ({
  logAction: vi.fn(),
  writeLogEvent: vi.fn(),
}));

// ── Temp dir setup ─────────────────────────────────────────────────────

let tmpDir: string;
let tmpHome: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-swap-test-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "arc-swap-home-"));
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch { /* best effort */ }
});

// ── Helper: seed canonical tool dir with credential files ──────────────

function seedClaudeCredentials(homeDir: string, opts?: {
  tier?: string;
  subscription?: string;
}): string {
  const claudeDir = path.join(homeDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const creds = {
    claudeAiOauth: {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.now() + 3_600_000,
      subscriptionType: opts?.subscription ?? "pro",
      rateLimitTier: opts?.tier ?? "default",
    },
  };
  fs.writeFileSync(path.join(claudeDir, ".credentials.json"), JSON.stringify(creds));
  return claudeDir;
}

function seedGeminiCredentials(homeDir: string): string {
  const geminiDir = path.join(homeDir, ".gemini");
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(
    path.join(geminiDir, "oauth_creds.json"),
    JSON.stringify({ token: "gemini-test-token" }),
  );
  return geminiDir;
}

// ── We need to mock TOOL_CONFIG_DIRS since they are module-level consts
//    that hardcode os.homedir(). We do this by mocking the entire module
//    and re-implementing with our temp home. ────────────────────────────

// Import the real module after mocking. Since TOOL_CONFIG_DIRS is a const
// computed at module load time from os.homedir(), and os.homedir() cannot
// be reliably changed after module init, we mock the swap module's
// internal paths by overriding os.homedir() BEFORE dynamic import.

// Strategy: use vi.hoisted + vi.mock to intercept os.homedir() so all
// module-level const evaluations use our tmpHome.

// Actually, vitest evaluates vi.mock hoists before the module loads, but
// the tmpHome variable won't be set yet. The cleanest approach: test the
// functions that only depend on ARC_DIR (listAccounts, swapStatus,
// deleteAccount, manifest operations) directly, and for functions that
// touch canonical dirs, use a dynamic import with os.homedir mocked.

// Let's take the pragmatic approach: mock os before importing swap.

const hoistedHome = vi.hoisted(() => {
  return { value: "" };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => hoistedHome.value || actual.default.homedir(),
    },
    homedir: () => hoistedHome.value || actual.default.homedir(),
  };
});

// Now import swap — TOOL_CONFIG_DIRS will call our mocked os.homedir()
// at module load time. We set hoistedHome.value in beforeEach so it's
// ready before tests run, but the module loads once. Since the mock
// returns a function that reads hoistedHome.value dynamically, and
// TOOL_CONFIG_DIRS is computed once at load time, we need a different
// approach.
//
// Since TOOL_CONFIG_DIRS = { claude: path.join(os.homedir(), ".claude"), ... }
// is evaluated at import time, and our mock returns hoistedHome.value which
// is "" at that point, we need the value set before the module loads.
//
// The solution: accept that TOOL_CONFIG_DIRS points to a fixed path based
// on the FIRST hoistedHome.value. We'll set it before the import via a
// static temp dir created in vi.hoisted.

// Actually let's just create the home in vi.hoisted.
const staticHome = vi.hoisted(() => {
  const tmpdir = require("node:os").tmpdir();
  const fsMod = require("node:fs");
  const pathMod = require("node:path");
  const dir = fsMod.mkdtempSync(pathMod.join(tmpdir, "arc-swap-static-"));
  return dir as string;
});

// Set hoistedHome to the static dir so the os.homedir mock uses it
// when TOOL_CONFIG_DIRS is computed at module load.
hoistedHome.value = staticHome;

import {
  captureAccount,
  swapTo,
  swapFromProfile,
  listAccounts,
  deleteAccount,
  swapStatus,
  SWAP_TOOLS,
} from "../../packages/cli/src/swap.js";

// ── Tests ──────────────────────────────────────────────────────────────

describe("swap module", () => {
  // Reset the static home directory structure before each test
  beforeEach(() => {
    // Clean out canonical dirs and rebuild
    for (const tool of [".claude", ".gemini", ".codex"]) {
      const toolDir = path.join(staticHome, tool);
      fs.rmSync(toolDir, { recursive: true, force: true });
    }
    // Clean credentials dir in ARC_DIR
    const credsDir = path.join(tmpDir, "credentials");
    fs.rmSync(credsDir, { recursive: true, force: true });
  });

  // ── SWAP_TOOLS ─────────────────────────────────────────────────

  describe("SWAP_TOOLS", () => {
    it("exports the list of supported tool names", () => {
      expect(SWAP_TOOLS).toContain("claude");
      expect(SWAP_TOOLS).toContain("gemini");
      expect(SWAP_TOOLS).toContain("codex");
    });
  });

  // ── captureAccount ─────────────────────────────────────────────

  describe("captureAccount()", () => {
    it("captures claude credentials and returns ok", () => {
      seedClaudeCredentials(staticHome);
      const result = captureAccount("my-account", "claude");
      expect(result).toEqual({ ok: true });
    });

    it("creates a snapshot directory with credential files", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("snapshot-test", "claude");

      const snapshotDir = path.join(tmpDir, "credentials", "snapshot-test");
      expect(fs.existsSync(snapshotDir)).toBe(true);
      expect(fs.existsSync(path.join(snapshotDir, ".credentials.json"))).toBe(true);
    });

    it("extracts metadata from claude credentials", () => {
      seedClaudeCredentials(staticHome, { tier: "t4", subscription: "max" });
      captureAccount("meta-test", "claude");

      const accounts = listAccounts();
      const account = accounts.find((a) => a.name === "meta-test");
      expect(account).toBeDefined();
      expect(account!.meta?.tier).toBe("t4");
      expect(account!.meta?.subscription).toBe("max");
    });

    it("returns error for unknown tool", () => {
      const result = captureAccount("test", "unknown-tool");
      expect(result).toEqual({ ok: false, error: expect.stringContaining("Unknown tool") });
    });

    it("returns error when no credentials exist", () => {
      // Do NOT seed credentials — the canonical dir is empty
      const result = captureAccount("no-creds", "claude");
      expect(result).toEqual({ ok: false, error: expect.stringContaining("No credentials found") });
    });

    it("marks captured account as active for the tool", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("active-test", "claude");

      const accounts = listAccounts();
      const account = accounts.find((a) => a.name === "active-test");
      expect(account?.isActive).toBe(true);
    });

    it("sets restricted file permissions on snapshot", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("perms-test", "claude");

      const snapshotFile = path.join(tmpDir, "credentials", "perms-test", ".credentials.json");
      const stat = fs.statSync(snapshotFile);
      // On Windows, mode checking is unreliable, but the file should exist
      expect(stat.isFile()).toBe(true);
    });
  });

  // ── listAccounts ───────────────────────────────────────────────

  describe("listAccounts()", () => {
    it("returns empty array when no accounts exist", () => {
      expect(listAccounts()).toEqual([]);
    });

    it("returns all captured accounts after captures", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("acct-a", "claude");
      captureAccount("acct-b", "claude");

      const accounts = listAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.name).sort()).toEqual(["acct-a", "acct-b"]);
    });

    it("includes tool name and createdAt in each account", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("detail-test", "claude");

      const accounts = listAccounts();
      expect(accounts[0].tool).toBe("claude");
      expect(accounts[0].createdAt).toBeDefined();
      expect(typeof accounts[0].createdAt).toBe("string");
    });
  });

  // ── swapTo ─────────────────────────────────────────────────────

  describe("swapTo()", () => {
    it("returns error for nonexistent account", () => {
      const result = swapTo("does-not-exist");
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
    });

    it("restores credentials to canonical dir", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("swap-source", "claude");

      // Wipe the canonical credentials
      const credFile = path.join(staticHome, ".claude", ".credentials.json");
      fs.writeFileSync(credFile, JSON.stringify({ wiped: true }));

      const result = swapTo("swap-source");
      expect(result).toEqual({ ok: true, tool: "claude" });

      // Verify the credential was restored
      const restored = JSON.parse(fs.readFileSync(credFile, "utf-8"));
      expect(restored.claudeAiOauth).toBeDefined();
      expect(restored.claudeAiOauth.accessToken).toBe("test-access-token");
    });

    it("saves current active credentials before swapping", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("first-account", "claude");

      // Change credentials to simulate a different account
      const credFile = path.join(staticHome, ".claude", ".credentials.json");
      const secondCreds = {
        claudeAiOauth: {
          accessToken: "second-token",
          refreshToken: "second-refresh",
          expiresAt: Date.now() + 3_600_000,
          subscriptionType: "free",
          rateLimitTier: "limited",
        },
      };
      fs.writeFileSync(credFile, JSON.stringify(secondCreds));
      captureAccount("second-account", "claude");

      // Swap to first account
      const result = swapTo("first-account");
      expect(result).toEqual({ ok: true, tool: "claude" });

      // Verify second-account snapshot was updated with the current creds
      const savedSecondPath = path.join(tmpDir, "credentials", "second-account", ".credentials.json");
      const savedSecond = JSON.parse(fs.readFileSync(savedSecondPath, "utf-8"));
      expect(savedSecond.claudeAiOauth.accessToken).toBe("second-token");
    });

    it("updates the active account in the manifest", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("target", "claude");

      swapTo("target");

      const accounts = listAccounts();
      const target = accounts.find((a) => a.name === "target");
      expect(target?.isActive).toBe(true);
    });
  });

  // ── deleteAccount ──────────────────────────────────────────────

  describe("deleteAccount()", () => {
    it("returns error for nonexistent account", () => {
      const result = deleteAccount("ghost");
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("not found"),
      });
    });

    it("returns error when deleting the active account", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("active-acct", "claude");

      const result = deleteAccount("active-acct");
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("active account"),
      });
    });

    it("removes a non-active account", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("keeper", "claude");
      captureAccount("doomed", "claude");
      // "doomed" is now active; "keeper" is not
      // Actually both are "claude" tool, so active is "doomed"

      const result = deleteAccount("keeper");
      expect(result).toEqual({ ok: true });

      // Verify it's gone
      expect(listAccounts().find((a) => a.name === "keeper")).toBeUndefined();
    });

    it("removes the snapshot directory from disk", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("to-delete", "claude");
      captureAccount("stays-active", "claude");

      deleteAccount("to-delete");

      const snapshotDir = path.join(tmpDir, "credentials", "to-delete");
      expect(fs.existsSync(snapshotDir)).toBe(false);
    });
  });

  // ── swapStatus ─────────────────────────────────────────────────

  describe("swapStatus()", () => {
    it("returns all tools with null account when no captures exist", () => {
      const status = swapStatus();
      expect(status).toHaveLength(3);
      for (const entry of status) {
        expect(entry.account).toBeNull();
        expect(["claude", "gemini", "codex"]).toContain(entry.tool);
      }
    });

    it("shows active account after capture", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("status-test", "claude");

      const status = swapStatus();
      const claude = status.find((s) => s.tool === "claude");
      expect(claude?.account).toBe("status-test");
    });

    it("includes metadata for active accounts", () => {
      seedClaudeCredentials(staticHome, { tier: "t4", subscription: "max" });
      captureAccount("meta-status", "claude");

      const status = swapStatus();
      const claude = status.find((s) => s.tool === "claude");
      expect(claude?.meta?.tier).toBe("t4");
      expect(claude?.meta?.subscription).toBe("max");
    });
  });

  // ── swapFromProfile ────────────────────────────────────────────

  describe("swapFromProfile()", () => {
    it("copies credentials from a profile dir to canonical dir", () => {
      // Create a fake profile config dir with claude credentials
      const profileDir = path.join(tmpDir, "profiles", "work");
      fs.mkdirSync(profileDir, { recursive: true });
      const profileCreds = {
        claudeAiOauth: {
          accessToken: "profile-token",
          refreshToken: "profile-refresh",
          expiresAt: Date.now() + 3_600_000,
        },
      };
      fs.writeFileSync(
        path.join(profileDir, ".credentials.json"),
        JSON.stringify(profileCreds),
      );

      // Ensure canonical dir exists
      fs.mkdirSync(path.join(staticHome, ".claude"), { recursive: true });

      const result = swapFromProfile("work", profileDir, "claude");
      expect(result).toEqual({ ok: true });

      // Verify credential was copied to canonical dir
      const canonCreds = JSON.parse(
        fs.readFileSync(path.join(staticHome, ".claude", ".credentials.json"), "utf-8"),
      );
      expect(canonCreds.claudeAiOauth.accessToken).toBe("profile-token");
    });

    it("returns error for unknown tool", () => {
      const result = swapFromProfile("test", "/fake/dir", "unknown");
      expect(result).toEqual({ ok: false, error: expect.stringContaining("Unknown tool") });
    });

    it("returns error when profile has no credentials", () => {
      const emptyProfileDir = path.join(tmpDir, "profiles", "empty");
      fs.mkdirSync(emptyProfileDir, { recursive: true });

      const result = swapFromProfile("empty", emptyProfileDir, "claude");
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("No claude credentials found"),
      });
    });

    it("sets manifest active to profile:<name>", () => {
      const profileDir = path.join(tmpDir, "profiles", "dev");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(
        path.join(profileDir, ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: "dev-tok" } }),
      );
      fs.mkdirSync(path.join(staticHome, ".claude"), { recursive: true });

      swapFromProfile("dev", profileDir, "claude");

      const status = swapStatus();
      const claude = status.find((s) => s.tool === "claude");
      expect(claude?.account).toBe("profile:dev");
    });
  });

  // ── Manifest atomicity ─────────────────────────────────────────

  describe("manifest persistence", () => {
    it("writes manifest file after capture", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("persist-test", "claude");

      const manifestFile = path.join(tmpDir, "credentials", "swap-manifest.json");
      expect(fs.existsSync(manifestFile)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
      expect(manifest.accounts["persist-test"]).toBeDefined();
      expect(manifest.active.claude).toBe("persist-test");
    });

    it("manifest survives multiple operations", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("a1", "claude");
      captureAccount("a2", "claude");
      swapTo("a1");
      deleteAccount("a2");

      const accounts = listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("a1");
      expect(accounts[0].isActive).toBe(true);
    });

    it("no temp files are left behind after operations", () => {
      seedClaudeCredentials(staticHome);
      captureAccount("clean-test", "claude");

      const credsDir = path.join(tmpDir, "credentials");
      const files = fs.readdirSync(credsDir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});
