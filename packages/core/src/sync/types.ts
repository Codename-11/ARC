// ---------------------------------------------------------------------------
// Phase 11 — Cloud Sync types
// ---------------------------------------------------------------------------

export interface SyncConfig {
  enabled: boolean;
  provider: string;
  autoSync: boolean;
  syncIntervalMs: number;
  syncOnLaunch: boolean;
  syncOnExit: boolean;
  localOnlyProfiles: string[];
  exclude: string[];
}

export interface SyncDelta {
  entries: Record<string, unknown>;
  cursor: string;
  deleted: string[];
}

export interface SyncChange {
  key: string;
  value: unknown;
  timestamp: string;
  device: string;
}

export interface SyncProvider {
  readonly name: string;
  connect(config: SyncConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  push(key: string, value: unknown): Promise<void>;
  pull(key: string): Promise<unknown | null>;
  pullAll(prefix?: string): Promise<Record<string, unknown>>;
  delete(key: string): Promise<void>;
  pushBatch(entries: Record<string, unknown>): Promise<void>;
  pullSince(cursor: string): Promise<SyncDelta>;
}
