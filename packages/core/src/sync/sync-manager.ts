// ---------------------------------------------------------------------------
// Phase 11 — SyncManager (provider-agnostic orchestration layer)
// ---------------------------------------------------------------------------

import { writeLogEvent } from "../logging.js";
import type { SyncConfig, SyncProvider } from "./types.js";

export interface SyncStatus {
  connected: boolean;
  provider: string | null;
  lastSyncCursor: string | null;
  lastSyncAt: string | null;
}

/**
 * SyncManager wraps any SyncProvider and provides a high-level sync
 * interface with cursor tracking and status reporting.
 */
export class SyncManager {
  private provider: SyncProvider | null = null;
  private config: SyncConfig | null = null;
  private lastSyncCursor: string | null = null;
  private lastSyncAt: string | null = null;

  // ---- Provider management ------------------------------------------------

  async setProvider(provider: SyncProvider, config: SyncConfig): Promise<void> {
    // Disconnect the current provider if one is active.
    if (this.provider?.isConnected()) {
      await this.provider.disconnect();
    }

    this.provider = provider;
    this.config = config;
    await this.provider.connect(config);

    writeLogEvent({
      level: "info",
      component: "sync",
      action: "set-provider",
      message: `Sync provider set to '${provider.name}'`,
    });
  }

  // ---- Core operations ----------------------------------------------------

  /**
   * Perform a full sync — pull all changes since the last cursor, returning
   * the pulled entries.  The cursor is advanced on success.
   */
  async sync(): Promise<Record<string, unknown>> {
    this.ensureProvider();

    const delta = await this.provider!.pullSince(this.lastSyncCursor ?? "");
    this.lastSyncCursor = delta.cursor;
    this.lastSyncAt = new Date().toISOString();

    const entryCount = Object.keys(delta.entries).length;
    const deletedCount = delta.deleted.length;

    writeLogEvent({
      level: "info",
      component: "sync",
      action: "sync",
      message: `Sync complete — ${entryCount} updated, ${deletedCount} deleted`,
      data: { entryCount, deletedCount, cursor: delta.cursor },
    });

    return delta.entries;
  }

  /** Push a single key-value pair to the remote provider. */
  async push(key: string, value: unknown): Promise<void> {
    this.ensureProvider();
    await this.provider!.push(key, value);

    writeLogEvent({
      level: "debug",
      component: "sync",
      action: "push",
      message: `Pushed key '${key}'`,
    });
  }

  /** Pull a single key from the remote provider. */
  async pull(key: string): Promise<unknown | null> {
    this.ensureProvider();
    return this.provider!.pull(key);
  }

  // ---- Status -------------------------------------------------------------

  getStatus(): SyncStatus {
    return {
      connected: this.provider?.isConnected() ?? false,
      provider: this.provider?.name ?? null,
      lastSyncCursor: this.lastSyncCursor,
      lastSyncAt: this.lastSyncAt,
    };
  }

  // ---- Internals ----------------------------------------------------------

  private ensureProvider(): void {
    if (!this.provider || !this.provider.isConnected()) {
      throw new Error("SyncManager has no connected provider");
    }
  }
}
