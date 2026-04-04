# Cloud Sync

Synchronize ARC configuration across machines using a configurable storage backend. Cloud sync pushes and pulls `config.json`, shared layer content, and task data.

## Quick Start

```bash
arc sync configure --provider filesystem --path /mnt/nas/arc-sync
arc sync push
arc sync pull
arc sync status
```

## Sync Providers

ARC uses a `SyncProvider` interface with pluggable backends. The filesystem provider ships built-in; additional providers (S3, etc.) are planned.

### Filesystem Provider

Works with any mounted path — NAS, Dropbox folder, USB drive, or a network share.

```bash
arc sync configure --provider filesystem --path ~/Dropbox/arc-sync
arc sync configure --provider filesystem --path /mnt/nas/arc-config
```

The filesystem provider uses:
- **Atomic writes** — temp file + rename to prevent corruption
- **Mtime change detection** — only syncs files that have actually changed
- **Cursor tracking** — remembers the last sync point for efficient deltas

## What Gets Synced

| Data | Synced |
|------|--------|
| `config.json` | Profile registry, active profile, settings |
| `shared/` | Shared layer content (MCP servers, commands, CLAUDE.md) |
| `tasks/` | Task store |
| `memory/` | Persistent memory (if shared memory enabled) |
| Credentials | **Never synced** — stays local |

::: warning
Credentials and API keys are never included in sync. Each machine maintains its own authentication state.
:::

## Conflict Resolution

Sync uses **last-write-wins** conflict resolution. When a conflict is detected, the newer version wins and the older version is logged to `~/.arc/sync-conflicts.json` for manual review.

```bash
# Check for drift between local and remote
arc sync status

# View conflict log
cat ~/.arc/sync-conflicts.json
```

## Shared Layer

The shared layer (`~/.arc/shared/`) is the primary mechanism for sharing configuration across profiles on the same machine. Cloud sync extends this to work across machines.

```bash
# Enable shared layer for a profile
arc shared enable work --memory --claude-md

# Sync shared content to all enabled profiles
arc shared sync

# Check what's shared and which profiles are enabled
arc shared status
```

### How Shared Syncing Works

- **MCP servers** — shared keys merged into profile's `settings.json`, profile-specific keys win on conflict
- **Commands** — files from `shared/commands/` copied into profile, existing files preserved
- **CLAUDE.md** — shared content wrapped in sentinel markers and prepended
- **Memory/Projects** — directories linked via Windows junction or Unix symlink

A manifest file (`.arc-shared.json`) tracks what was synced, enabling clean reversal and re-sync.

## SyncManager

The `SyncManager` wraps any `SyncProvider` with cursor tracking and status reporting:

```typescript
interface SyncProvider {
  push(data: SyncDelta): Promise<void>;
  pull(cursor: string): Promise<SyncDelta>;
  status(): Promise<SyncStatus>;
}
```

Use `arc sync status` to see the last sync time and detect drift between local and remote state.
