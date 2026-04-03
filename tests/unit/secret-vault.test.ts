import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deriveKey, generateSalt, VaultEngine, SecretStore } from "@axiom-labs/arc-core";

// ─── Helpers ─────────────────────────────────────────────────────────

const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_PASSWORD_WRONG = "wrong-password-123";

let tmpDir: string;

function vaultPath(): string {
  return path.join(tmpDir, "vault.enc");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-vault-test-"));
  // Point ARC_DIR to our temp dir so SecretStore + logging use it
  process.env["ARC_DIR"] = tmpDir;
});

afterEach(() => {
  delete process.env["ARC_DIR"];
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ─── KDF Tests ───────────────────────────────────────────────────────

describe("deriveKey (Argon2id KDF)", () => {
  it("produces a 32-byte key", async () => {
    const salt = generateSalt();
    const key = await deriveKey(TEST_PASSWORD, salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("produces consistent key from same password + salt", async () => {
    const salt = generateSalt();
    const key1 = await deriveKey(TEST_PASSWORD, salt);
    const key2 = await deriveKey(TEST_PASSWORD, salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it("produces different keys for different passwords", async () => {
    const salt = generateSalt();
    const key1 = await deriveKey(TEST_PASSWORD, salt);
    const key2 = await deriveKey(TEST_PASSWORD_WRONG, salt);
    expect(key1.equals(key2)).toBe(false);
  });

  it("produces different keys for different salts", async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const key1 = await deriveKey(TEST_PASSWORD, salt1);
    const key2 = await deriveKey(TEST_PASSWORD, salt2);
    expect(key1.equals(key2)).toBe(false);
  });
});

// ─── VaultEngine Tests ──────────────────────────────────────────────

describe("VaultEngine", () => {
  it("round-trips encrypt + decrypt for a single secret", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("api-key", "sk-secret-12345");
    const result = engine.decrypt("api-key");
    expect(result).not.toBeNull();
    expect(result!.value).toBe("sk-secret-12345");
    expect(result!.name).toBe("api-key");
  });

  it("round-trips multiple secrets", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key1", "value1");
    engine.encrypt("key2", "value2");
    engine.encrypt("key3", "value3");

    expect(engine.decrypt("key1")!.value).toBe("value1");
    expect(engine.decrypt("key2")!.value).toBe("value2");
    expect(engine.decrypt("key3")!.value).toBe("value3");
  });

  it("returns null for nonexistent secret", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    expect(engine.decrypt("missing")).toBeNull();
  });

  it("overwrites existing secret with new value", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key", "original");
    engine.encrypt("key", "updated");
    expect(engine.decrypt("key")!.value).toBe("updated");
  });

  it("preserves createdAt when overwriting", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key", "v1");
    const created = engine.decrypt("key")!.createdAt;

    // Small delay so updatedAt differs
    await new Promise((r) => setTimeout(r, 10));
    engine.encrypt("key", "v2");

    const entry = engine.decrypt("key")!;
    expect(entry.createdAt).toBe(created);
    expect(entry.updatedAt).not.toBe(created);
  });

  it("generates unique nonces per entry", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("a", "val-a");
    engine.encrypt("b", "val-b");
    engine.save(vaultPath());

    // Read raw vault to extract nonces
    const raw = fs.readFileSync(vaultPath());
    const nonces: Buffer[] = [];
    let offset = 4 + 2 + 16; // header
    while (offset < raw.length) {
      const nameLen = raw.readUInt32BE(offset);
      offset += 4 + nameLen; // skip name
      nonces.push(Buffer.from(raw.subarray(offset, offset + 12)));
      offset += 12;
      const ctLen = raw.readUInt32BE(offset);
      offset += 4 + ctLen + 16; // skip ciphertext + auth tag
    }

    expect(nonces.length).toBe(2);
    expect(nonces[0].equals(nonces[1])).toBe(false);
  });

  it("delete removes entry", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key", "value");
    expect(engine.size).toBe(1);

    const deleted = engine.delete("key");
    expect(deleted).toBe(true);
    expect(engine.size).toBe(0);
    expect(engine.decrypt("key")).toBeNull();
  });

  it("delete returns false for nonexistent key", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    expect(engine.delete("nope")).toBe(false);
  });

  it("list returns metadata without values", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("alpha", "secret-alpha");
    engine.encrypt("beta", "secret-beta");

    const list = engine.list();
    expect(list.length).toBe(2);
    const names = list.map((m) => m.name).sort();
    expect(names).toEqual(["alpha", "beta"]);

    // Metadata should have timestamps, never values
    for (const meta of list) {
      expect(meta).toHaveProperty("createdAt");
      expect(meta).toHaveProperty("updatedAt");
      expect((meta as any).value).toBeUndefined();
    }
  });

  // ── Save / Open cycle ──

  it("save + open round-trip preserves all secrets", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("db-url", "postgres://localhost/mydb");
    engine.encrypt("api-token", "tok_abc123");
    engine.save(vaultPath());

    const engine2 = await VaultEngine.open(vaultPath(), TEST_PASSWORD);
    expect(engine2.decrypt("db-url")!.value).toBe("postgres://localhost/mydb");
    expect(engine2.decrypt("api-token")!.value).toBe("tok_abc123");
    expect(engine2.size).toBe(2);
  });

  it("vault file starts with magic bytes ARCV", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("x", "y");
    engine.save(vaultPath());

    const raw = fs.readFileSync(vaultPath());
    expect(raw.subarray(0, 4).toString("ascii")).toBe("ARCV");
  });

  it("vault file does not contain plaintext secret value", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    const secretValue = "super-secret-value-" + crypto.randomBytes(16).toString("hex");
    engine.encrypt("sensitive", secretValue);
    engine.save(vaultPath());

    const raw = fs.readFileSync(vaultPath()).toString("binary");
    expect(raw).not.toContain(secretValue);
  });

  it("open with wrong password fails with auth error", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key", "value");
    engine.save(vaultPath());

    const engine2 = await VaultEngine.open(vaultPath(), TEST_PASSWORD_WRONG);
    // Decryption should fail due to GCM auth tag mismatch
    expect(() => engine2.decrypt("key")).toThrow();
  });

  it("tampered ciphertext fails auth tag verification", async () => {
    const engine = await VaultEngine.create(TEST_PASSWORD);
    engine.encrypt("key", "value");
    engine.save(vaultPath());

    // Tamper with the ciphertext bytes
    const raw = fs.readFileSync(vaultPath());
    // Find first ciphertext after header (22) + name entry
    const offset = 22 + 4 + 3 + 12 + 4; // header + nameLen(4) + "key"(3) + nonce(12) + ctLen(4)
    if (offset < raw.length) {
      raw[offset] ^= 0xff; // flip bits in first ciphertext byte
    }
    fs.writeFileSync(vaultPath(), raw);

    const engine2 = await VaultEngine.open(vaultPath(), TEST_PASSWORD);
    expect(() => engine2.decrypt("key")).toThrow();
  });

  it("rejects file with invalid magic bytes", async () => {
    fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
    fs.writeFileSync(vaultPath(), Buffer.from("NOTV" + "\x00".repeat(18)));
    await expect(VaultEngine.open(vaultPath(), TEST_PASSWORD)).rejects.toThrow(/magic/i);
  });
});

// ─── SecretStore Tests ──────────────────────────────────────────────

describe("SecretStore", () => {
  it("set + get round-trips through the store", async () => {
    const store = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });

    await store.setSecret("my-key", "my-value");
    const value = await store.getSecret("my-key");
    expect(value).toBe("my-value");
  });

  it("list returns metadata array", async () => {
    const store = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });

    await store.setSecret("k1", "v1");
    await store.setSecret("k2", "v2");
    const list = await store.listSecrets();
    expect(list.length).toBe(2);
    expect(list.map((m) => m.name).sort()).toEqual(["k1", "k2"]);
  });

  it("delete removes a secret", async () => {
    const store = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });

    await store.setSecret("tmp", "tmpval");
    const deleted = await store.deleteSecret("tmp");
    expect(deleted).toBe(true);
    const val = await store.getSecret("tmp");
    expect(val).toBeNull();
  });

  it("get returns null for nonexistent secret", async () => {
    const store = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });

    // Create vault with one secret so the file exists
    await store.setSecret("exists", "yes");
    const val = await store.getSecret("nope");
    expect(val).toBeNull();
  });

  it("emits audit log events", async () => {
    // Ensure logs dir exists under our temp ARC_DIR
    const logsDir = path.join(tmpDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    const store = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });

    await store.setSecret("audit-key", "audit-val");
    await store.getSecret("audit-key");
    await store.listSecrets();
    await store.deleteSecret("audit-key");

    // Read the log file
    const logPath = path.join(logsDir, "events.ndjson");
    const logLines = fs
      .readFileSync(logPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const secretLogs = logLines.filter((e: any) => e.component === "secret");
    const actions = secretLogs.map((e: any) => e.action);

    expect(actions).toContain("set");
    expect(actions).toContain("get");
    expect(actions).toContain("list");
    expect(actions).toContain("delete");
  });

  it("persists across store instances (vault on disk)", async () => {
    const store1 = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });
    await store1.setSecret("persist-key", "persist-val");

    // New store instance, same vault file
    const store2 = new SecretStore({
      getPassword: async () => TEST_PASSWORD,
      vaultPath: vaultPath(),
    });
    const val = await store2.getSecret("persist-key");
    expect(val).toBe("persist-val");
  });
});
