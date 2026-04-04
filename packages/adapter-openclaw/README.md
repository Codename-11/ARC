# @axiom-labs/arc-adapter-openclaw

> ARC runtime adapter and plugin for OpenClaw -- lifecycle hooks and agent tools via the plugin API.

Part of the [ARC](https://arc-cli.dev) monorepo ([GitHub](https://github.com/Codename-11/ARC)) -- Agent Runtime Control.

## What This Package Does

Implements the `RuntimeAdapter` interface for OpenClaw and provides a plugin entry point that OpenClaw's jiti loader invokes at startup. The plugin registers ARC supervision hooks (source classification, risk detection, supervision gates) into OpenClaw's lifecycle bus and exposes agent tools through the plugin API.

## Main Exports

- **`openclawAdapter`** (default export) -- `RuntimeAdapter` implementation for OpenClaw with config detection, health checks, and capability declarations
- **`register(api)`** -- Plugin entry point called by OpenClaw's loader; registers 3 lifecycle hooks and agent tools
- **Type exports** -- `OpenClawPluginApi`, `OpenClawToolDefinition`, `ToolRegistrationOptions`, `ToolContent`, `ToolResult`, `HookMeta`

## Usage

As an ARC adapter:

```typescript
import openclawAdapter from "@axiom-labs/arc-adapter-openclaw";

const configs = openclawAdapter.detectConfigs();
const health = await openclawAdapter.checkHealth(profile);
```

As an OpenClaw plugin (loaded automatically by OpenClaw when configured):

```typescript
// openclaw.config.ts
export default {
  plugins: ["@axiom-labs/arc-adapter-openclaw"],
};
```

## Development

```bash
cd packages/adapter-openclaw
pnpm typecheck
pnpm build
```

## License

MIT
