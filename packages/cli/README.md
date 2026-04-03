# @axiom-labs/arc-cli-internal

> Internal CLI package that wires arc-core, adapters, and MCP into the `arc` command.

Part of the [ARC](https://github.com/Codename-11/ARC) monorepo -- Agent Runtime Control.

## What This Package Does

Provides the Commander.js program and TUI dashboard that power the `arc` CLI. This is an internal package consumed by the root `arc` entry point -- it is not intended for direct installation. It depends on `@axiom-labs/arc-core`, `@axiom-labs/arc-adapter-claude`, and `@axiom-labs/arc-mcp`.

## Main Exports

- **`createProgram()`** -- Returns the configured Commander.js `Command` instance with all subcommands registered
- **`runCli(argv?)`** -- Parses argv, runs the matched command, and returns an exit code

## Usage

```typescript
import { runCli } from "@axiom-labs/arc-cli-internal";

const exitCode = await runCli(process.argv);
process.exit(exitCode);
```

Or use the program directly for embedding:

```typescript
import { createProgram } from "@axiom-labs/arc-cli-internal";

const program = createProgram();
await program.parseAsync(["node", "arc", "status"]);
```

## Development

```bash
cd packages/cli
pnpm typecheck
pnpm build
```

## License

MIT
