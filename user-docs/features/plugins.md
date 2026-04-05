# Plugin System

ARC supports plugins that extend its capabilities with new adapters, hooks, skills, MCP servers, and dashboard widgets. Plugins are installed into `~/.arc/plugins/` and managed through the CLI.

## Installing a Plugin

Plugins are distributed as directories containing a `plugin.json` manifest. Install from a local path:

```bash
arc plugins install ./my-plugin
```

ARC copies the plugin into `~/.arc/plugins/<name>/`, validates the manifest, and enables it automatically.

## Listing Installed Plugins

```bash
arc plugins list
arc plugins list --json
```

The table shows each plugin's name, version, enabled state, capabilities, and install date.

## Enabling and Disabling

Disable a plugin without removing it, or re-enable it later:

```bash
arc plugins disable my-plugin
arc plugins enable my-plugin
```

Disabled plugins remain on disk but are not loaded at runtime.

## Uninstalling

```bash
arc plugins uninstall my-plugin
```

This removes the plugin directory and its registry entry.

## Plugin Manifest Format

Every plugin requires a `plugin.json` in its root directory:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Adds custom linting hooks to ARC",
  "author": "your-name",
  "capabilities": ["hook"],
  "compatibility": { "arc": "^0.1.0" },
  "entryPoint": "index.js"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique plugin identifier |
| `version` | `string` | SemVer version |
| `description` | `string` | Human-readable summary |
| `capabilities` | `string[]` | What the plugin provides |
| `compatibility.arc` | `string` | SemVer range of compatible ARC versions |

### Capabilities

A plugin declares one or more capabilities:

| Capability | Description |
|------------|-------------|
| `adapter` | New agent tool adapter |
| `hook` | Custom hook for the supervision pipeline |
| `skill` | Reusable skill definition |
| `mcp` | MCP server integration |
| `dashboard` | Web dashboard widget |

## Web Dashboard Plugin Management

The [Web Dashboard](/features/dashboard) Plugins view displays real plugin data from the registry and supports enable/disable actions directly from the browser:

- **Browse** — view all installed plugins with name, version, capabilities, and enabled state
- **Enable/Disable** — toggle a plugin's enabled state without removing it

::: tip
Plugin install and uninstall operations are CLI-only. Use the Web Dashboard for quick enable/disable toggling when monitoring remotely.
:::

## Compatibility Checking

ARC validates the `compatibility.arc` field against the running ARC version before loading a plugin. Supported range formats are exact versions (`1.2.3`) and caret ranges (`^1.2.0`).

## Storage

Plugins are stored in `~/.arc/plugins/`. The registry is tracked in `~/.arc/plugins/installed.json`. See the `examples/` directory in the ARC repository for sample plugin structures.
