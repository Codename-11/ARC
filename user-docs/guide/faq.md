# FAQ

## Can I use ARC with any AI tool?

Yes. ARC ships built-in adapters for Claude Code, Codex CLI, Gemini CLI, and OpenClaw. The generic adapter supports anything that speaks MCP or accepts HTTP configuration. If a tool reads environment variables or config files, ARC can manage it.

## Does ARC replace Claude Code / Codex CLI / Gemini CLI?

No. ARC wraps and manages these tools — it does not replace them. You still install and use the tools directly. ARC provides the isolation layer: per-profile configs, credentials, environment variables, and supervision hooks.

## Can I sync profiles across machines?

Yes. The filesystem sync provider is available now:

```bash
arc sync push    # Push profile data to shared location
arc sync pull    # Pull from shared location
```

Git and S3 providers are planned.

## How do I backup my profiles?

Copy the `~/.arc/` directory. It contains all profile configs, credentials, and settings.

Alternatively, use sync to push to a shared location:

```bash
arc sync push
```

## Is ARC compatible with VS Code / Cursor / JetBrains?

ARC manages CLI tools, not IDE extensions. However, any IDE extension or tool that respects `CLAUDE_CONFIG_DIR` or similar environment variables will work with ARC profiles. Use `arc exec` to launch IDE processes with the correct profile environment.

## Can two profiles share MCP servers?

Yes. Enable the shared layer for a profile:

```bash
arc shared enable <profile> --mcp
```

MCP server configurations from `~/.arc/shared/` are merged into the profile. Changes to the shared layer propagate to all profiles that have it enabled.

## What happens if a hook fails?

In log mode (the default), failures are logged and the hook is skipped — execution continues. The circuit breaker trips after 3 consecutive failures for the same hook, bypassing it automatically. The breaker resets after 5 minutes.

Check hook status:

```bash
arc logs
```

## Is the web dashboard required?

No. The dashboard is optional. All ARC features — profiles, secrets, hooks, tasks, sessions — work from the CLI and TUI. The dashboard provides a visual overview but is not required for any workflow.

## Can I use ARC in CI/CD?

Yes. `arc exec` runs commands with the correct profile environment:

```bash
arc exec my-profile -- npm test
```

Use `--json` flags for machine-readable output in scripts:

```bash
arc list --json
arc status --json
```
