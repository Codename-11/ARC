// ---------------------------------------------------------------------------
// Phase 11 — Filesystem-backed SyncProvider
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeLogEvent } from "../logging.js";
import type { SyncConfig, SyncDelta, SyncProvider } from "./types.js";

/**
 * FilesystemSyncProvider — stores sync entries as individual JSON files in a
 * shared directory.  Uses file mtime for change detection and atomic writes
 * (write to temp → rename) for crash safety.
 */
export class FilesystemSyncProvider implements SyncProvider {
  readonly name = "filesystem";

  private syncDir: string | null = null;
  private connected = false;

  // ---- SyncProvider implementation ----------------------------------------

  async connect(config: SyncConfig): Promise<void> {
    // The provider field doubles as the shared-directory path for this provider.
    this.syncDir = config.provider;
    fs.mkdirSync(this.syncDir, { recursive: true });
    this.connected = true;

    writeLogEvent({
      level: "info",
      component: "sync",
      action: "connect",
      message: `Filesystem sync provider connected to ${this.syncDir}`,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.syncDir = null;

    writeLogEvent({
      level: "info",
      component: "sync",
      action: "disconnect",
      message: "Filesystem sync provider disconnected",
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async push(key: string, value: unknown): Promise<void> {
    this.ensureConnected();
    const filePath = this.keyToPath(key);
    this.atomicWrite(filePath, value);
  }

  async pull(key: string): Promise<unknown | null> {
    this.ensureConnected();
    const filePath = this.keyToPath(key);
    return this.readEntry(filePath);
  }

  async pullAll(prefix?: string): Promise<Record<string, unknown>> {
    this.ensureConnected();

    const dir = prefix ? path.join(this.syncDir!, prefix) : this.syncDir!;
    const result: Record<string, unknown> = {};

    if (!fs.existsSync(dir)) return result;

    for (const entry of this.walkFiles(dir)) {
      const relative = path.relative(this.syncDir!, entry).replace(/\\/g, "/");
      const key = relative.replace(/\.json$/, "");
      const value = this.readEntry(entry);
      if (value !== null) {
        result[key] = value;
      }
    }

    return result;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    const filePath = this.keyToPath(key);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Entry may not exist — that is fine.
    }
  }

  async pushBatch(entries: Record<string, unknown>): Promise<void> {
    this.ensureConnected();
    for (const [key, value] of Object.entries(entries)) {
      const filePath = this.keyToPath(key);
      this.atomicWrite(filePath, value);
    }
  }

  async pullSince(cursor: string): Promise<SyncDelta> {
    this.ensureConnected();

    const sinceMs = cursor ? new Date(cursor).getTime() : 0;
    const entries: Record<string, unknown> = {};
    const now = new Date().toISOString();

    for (const filePath of this.walkFiles(this.syncDir!)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > sinceMs) {
          const relative = path.relative(this.syncDir!, filePath).replace(/\\/g, "/");
          const key = relative.replace(/\.json$/, "");
          const value = this.readEntry(filePath);
          if (value !== null) {
            entries[key] = value;
          }
        }
      } catch {
        // Skip unreadable entries.
      }
    }

    return { entries, cursor: now, deleted: [] };
  }

  // ---- Internals ----------------------------------------------------------

  private ensureConnected(): void {
    if (!this.connected || !this.syncDir) {
      throw new Error("FilesystemSyncProvider is not connected");
    }
  }

  private keyToPath(key: string): string {
    return path.join(this.syncDir!, `${key}.json`);
  }

  private atomicWrite(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
    fs.renameSync(tempPath, filePath);
  }

  private readEntry(filePath: string): unknown | null {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  /** Recursively yield all `.json` files under a directory. */
  private walkFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(full);
      }
    }

    return results;
  }
}
