# @axiom-labs/arc-adapter-claude

> ARC runtime adapter for Claude Code -- auth detection, config sync, and shared artifact management.

Part of the [ARC](https://github.com/Codename-11/ARC) monorepo -- Agent Runtime Control.

## What This Package Does

Implements the `RuntimeAdapter` interface for Claude Code. Detects Claude installations and auth types (OAuth, API key, Bedrock, Vertex), reads credential status, builds profile-scoped environment variables, and manages shared CLAUDE.md synchronization across profiles.

## Main Exports

- **`claudeAdapter`** (default export) -- `RuntimeAdapter` implementation for Claude Code with detect, auth, launch, health, and config capabilities
- **`getClaudeCredentialStatus(profile)`** -- Returns credential status including auth type, account tier, and expiry
- **`buildClaudeProfileEnv(profile)`** -- Builds environment variables for isolated Claude profile execution
- **`detectClaudeConfig()`** -- Detects the local Claude Code configuration directory and marker files
- **`importClaudeArtifacts(source, target)`** -- Copies Claude-specific artifacts (`.claude.json`) into a profile directory
- **`syncSharedClaudeMd(configDir)`** -- Injects the shared-layer CLAUDE.md block into a profile's CLAUDE.md
- **`pullSharedClaudeMd(configDir)`** -- Extracts CLAUDE.md content from a profile into the shared layer
- **`removeSharedClaudeMd(configDir)`** -- Removes the shared-layer block from a profile's CLAUDE.md

## Usage

```typescript
import claudeAdapter from "@axiom-labs/arc-adapter-claude";

// Detect Claude Code installation
const configs = claudeAdapter.detectConfigs();

// Check credential status for a profile
import { getClaudeCredentialStatus } from "@axiom-labs/arc-adapter-claude";
const status = getClaudeCredentialStatus(profile);
// => { authType: "oauth", authenticated: true, accountTier: "pro (5x)", ... }
```

## Development

```bash
cd packages/adapter-claude
pnpm typecheck
pnpm build
```

## License

MIT
