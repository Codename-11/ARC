/**
 * VaultEngine — binary encrypted vault for storing secrets.
 *
 * Vault binary format:
 *   4-byte magic   'ARCV'
 *   2-byte version  1
 *   16-byte salt
 *   N entries, each:
 *     4-byte name-length (uint32 BE)
 *     <name-length> bytes UTF-8 name
 *     12-byte nonce (GCM IV)
 *     4-byte ciphertext-length (uint32 BE)
 *     <ciphertext-length> bytes ciphertext (AES-256-GCM encrypted JSON)
 *     16-byte auth tag
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deriveKey, generateSalt } from "./crypto.js";
import type { SecretEntry, SecretMetadata, VaultHeader } from "./types.js";

const MAGIC = "ARCV";
const VERSION = 1;
const HEADER_SIZE = 4 + 2 + 16; // magic + version + salt
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ─── Internal encrypted entry as stored in memory ────────────────────

interface EncryptedEntry {
  name: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

// ─── VaultEngine ─────────────────────────────────────────────────────

export class VaultEngine {
  private key: Buffer;
  private salt: Buffer;
  private entries: Map<string, EncryptedEntry> = new Map();

  private constructor(key: Buffer, salt: Buffer) {
    this.key = key;
    this.salt = salt;
  }

  /** Create a new empty vault with a fresh salt. */
  static async create(password: string): Promise<VaultEngine> {
    const salt = generateSalt();
    const key = await deriveKey(password, salt);
    return new VaultEngine(key, salt);
  }

  /** Open an existing vault from a file. */
  static async open(vaultPath: string, password: string): Promise<VaultEngine> {
    const data = fs.readFileSync(vaultPath);
    const header = VaultEngine.parseHeader(data);
    const key = await deriveKey(password, header.salt);
    const engine = new VaultEngine(key, header.salt);
    engine.parseEntries(data);
    return engine;
  }

  /** Encrypt and store a secret. Overwrites if name already exists. */
  encrypt(name: string, value: string): void {
    const now = new Date().toISOString();
    let createdAt = now;

    // Preserve original createdAt if overwriting
    const existing = this.entries.get(name);
    if (existing) {
      try {
        const payload = this.decryptEntry(existing);
        createdAt = payload.createdAt;
      } catch {
        // If decryption fails on the old entry, use now
      }
    }

    const payload: SecretEntry = { value, createdAt, updatedAt: now };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
    const nonce = crypto.randomBytes(NONCE_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    this.entries.set(name, { name, nonce, ciphertext: encrypted, authTag });
  }

  /** Decrypt and return a secret by name. Returns null if not found. */
  decrypt(name: string): (SecretEntry & { name: string }) | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const payload = this.decryptEntry(entry);
    return { name, ...payload };
  }

  /** List metadata for all secrets (never returns values). */
  list(): SecretMetadata[] {
    const result: SecretMetadata[] = [];
    for (const entry of this.entries.values()) {
      try {
        const payload = this.decryptEntry(entry);
        result.push({
          name: entry.name,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
        });
      } catch {
        // Skip entries that can't be decrypted (shouldn't happen if key is correct)
        result.push({
          name: entry.name,
          createdAt: "unknown",
          updatedAt: "unknown",
        });
      }
    }
    return result;
  }

  /** Delete a secret by name. Returns true if it existed. */
  delete(name: string): boolean {
    return this.entries.delete(name);
  }

  /** Return the number of entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Get the vault salt (for testing / serialization). */
  getSalt(): Buffer {
    return this.salt;
  }

  /** Serialize and save the vault to a file. Creates parent directories. */
  save(vaultPath: string): void {
    const dir = path.dirname(vaultPath);
    fs.mkdirSync(dir, { recursive: true });

    const header = this.serializeHeader();
    const entryBuffers: Buffer[] = [];

    for (const entry of this.entries.values()) {
      entryBuffers.push(this.serializeEntry(entry));
    }

    const data = Buffer.concat([header, ...entryBuffers]);
    fs.writeFileSync(vaultPath, data, { mode: 0o600 });
  }

  // ─── Internals ───────────────────────────────────────────────────

  private decryptEntry(entry: EncryptedEntry): SecretEntry {
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, entry.nonce);
    decipher.setAuthTag(entry.authTag);
    const decrypted = Buffer.concat([decipher.update(entry.ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf-8")) as SecretEntry;
  }

  private serializeHeader(): Buffer {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf.write(MAGIC, 0, 4, "ascii");
    buf.writeUInt16BE(VERSION, 4);
    this.salt.copy(buf, 6);
    return buf;
  }

  private serializeEntry(entry: EncryptedEntry): Buffer {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32BE(nameBuf.length, 0);
    const ctLen = Buffer.alloc(4);
    ctLen.writeUInt32BE(entry.ciphertext.length, 0);

    return Buffer.concat([
      nameLen,
      nameBuf,
      entry.nonce,
      ctLen,
      entry.ciphertext,
      entry.authTag,
    ]);
  }

  private static parseHeader(data: Buffer): VaultHeader {
    if (data.length < HEADER_SIZE) {
      throw new Error("Vault file is too small to contain a valid header.");
    }
    const magic = data.subarray(0, 4).toString("ascii");
    if (magic !== MAGIC) {
      throw new Error(`Invalid vault file: expected magic 'ARCV', got '${magic}'.`);
    }
    const version = data.readUInt16BE(4);
    if (version !== VERSION) {
      throw new Error(`Unsupported vault version: ${version}. Expected ${VERSION}.`);
    }
    const salt = Buffer.from(data.subarray(6, 22));
    return { magic, version, salt };
  }

  private parseEntries(data: Buffer): void {
    let offset = HEADER_SIZE;
    while (offset < data.length) {
      if (offset + 4 > data.length) break;
      const nameLen = data.readUInt32BE(offset);
      offset += 4;

      if (offset + nameLen > data.length) {
        throw new Error(`Corrupt vault: name length ${nameLen} exceeds remaining data.`);
      }
      const name = data.subarray(offset, offset + nameLen).toString("utf-8");
      offset += nameLen;

      if (offset + NONCE_LENGTH > data.length) {
        throw new Error("Corrupt vault: truncated nonce.");
      }
      const nonce = Buffer.from(data.subarray(offset, offset + NONCE_LENGTH));
      offset += NONCE_LENGTH;

      if (offset + 4 > data.length) {
        throw new Error("Corrupt vault: truncated ciphertext length.");
      }
      const ctLen = data.readUInt32BE(offset);
      offset += 4;

      if (offset + ctLen > data.length) {
        throw new Error(`Corrupt vault: ciphertext length ${ctLen} exceeds remaining data.`);
      }
      const ciphertext = Buffer.from(data.subarray(offset, offset + ctLen));
      offset += ctLen;

      if (offset + AUTH_TAG_LENGTH > data.length) {
        throw new Error("Corrupt vault: truncated auth tag.");
      }
      const authTag = Buffer.from(data.subarray(offset, offset + AUTH_TAG_LENGTH));
      offset += AUTH_TAG_LENGTH;

      this.entries.set(name, { name, nonce, ciphertext, authTag });
    }
  }
}
