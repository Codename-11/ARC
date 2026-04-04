# Multi-Account Management

## Common Scenarios

### "I have two Claude Max accounts (work + personal) and want easy switching"

This is the most common use case. Here's the full setup — takes about 2 minutes:

```bash
# 1. Create two profiles
arc create work --tool claude --auth-type oauth
arc create personal --tool claude --auth-type oauth

# 2. Login to each (opens browser for OAuth)
arc auth login work        # Login with your work account
arc auth login personal    # Login with your personal account

# 3. Verify both are set up
arc auth status
```

You'll see something like:

```
PROFILE      TOOL     AUTH    STATUS           TIER
work         claude   oauth   authenticated    pro / default_claude_pro
personal     claude   oauth   authenticated    pro / default_claude_pro
```

**Now use them:**

```bash
# Launch Claude Code with your work account
arc use work
arc launch

# Or launch directly
arc launch --profile personal

# Quick check: which account am I using?
arc auth whoami
```

Each profile is fully isolated — separate credentials, separate settings, separate MCP servers, separate session history.

### "I also want Claude Desktop to use my work account"

Claude Desktop reads from `~/.claude/`, not ARC's profile directories. Use the **swap bridge**:

```bash
# Push your work profile's credentials to ~/.claude/
arc swap from-profile work

# Switch Desktop to personal
arc swap from-profile personal

# Check what's active
arc swap status
```

Output:

```
claude     → profile:work (pro/default_claude_pro)
gemini     → (none)
codex      → (none)
```

### "I want to sync settings but switch accounts"

Use profiles for isolated auth, but enable the **shared layer** for common settings:

```bash
# Enable shared MCP servers and CLAUDE.md across both profiles
arc shared enable work --mcp --claude-md
arc shared enable personal --mcp --claude-md
```

Now both profiles share the same MCP server config and custom instructions, but each has its own OAuth credentials.

### "I use Claude, Gemini, AND Codex"

Create one profile per tool-account combination:

```bash
arc create claude-work --tool claude --auth-type oauth
arc create gemini-work --tool gemini --auth-type oauth
arc create codex-work --tool codex --auth-type oauth

# Login to each
arc auth login claude-work
arc auth login gemini-work
arc auth login codex-work

# Switch between them
arc use claude-work && arc launch
arc use gemini-work && arc launch
```

### "I want workspace-specific defaults"

Put an `arc.json` in your project root:

```json
{
  "profile": "work",
  "adapter": "claude-code"
}
```

Now `arc launch` in that directory automatically uses the `work` profile — no need to `arc use` first.

---

## How It Works

ARC provides two complementary systems:

| | **Profile Isolation** | **Credential Hot-Swap** |
|---|---|---|
| **What it does** | Separate config directory per account | Swaps credential files in canonical tool dir |
| **Best for** | CLI tools (Claude Code, Codex CLI, Gemini CLI) | Desktop apps (Claude Desktop, Codex Desktop) |
| **What changes** | Everything (creds, settings, MCPs, history) | Only credential files |
| **Settings** | Per-profile | Shared — nothing changes |
| **How to switch** | `arc use <profile>` | `arc swap to <account>` or `arc swap from-profile <profile>` |

### Profile Isolation

Each profile gets its own directory at `~/.arc/profiles/<name>/` with separate:
- `.credentials.json` (OAuth tokens)
- `settings.json` (tool settings)
- `.claude.json` (MCP servers)
- `commands/`, `memory/`, `projects/`

When you `arc launch`, ARC sets `CLAUDE_CONFIG_DIR` (or `GEMINI_CLI_HOME` / `CODEX_HOME`) to point the CLI tool at the profile's directory. Complete isolation.

### Credential Hot-Swap

Captures credential snapshots to `~/.arc/credentials/<name>/` and swaps them into the tool's canonical directory (`~/.claude/`, `~/.gemini/`, `~/.codex/`).

```bash
# Capture current credentials
arc swap capture personal --tool claude

# Swap to a different account
arc swap to work

# Bridge a profile's creds to Desktop
arc swap from-profile work
```

::: warning Experimental
Hot-swap is experimental. It works reliably but the API may change.
:::

---

## Quick Reference

```bash
# Profile management
arc create <name> --tool claude --auth-type oauth
arc use <name>
arc auth login <name>
arc auth status
arc auth whoami [name]
arc launch [--profile name]

# Desktop app switching
arc swap capture <name> --tool claude
arc swap to <name>
arc swap from-profile <profile>
arc swap status
arc swap list

# Shared settings across profiles
arc shared enable <profile> --mcp --claude-md
arc shared disable <profile>

# Workspace defaults
echo '{"profile":"work"}' > arc.json
```

---

## Tips

- **Quick switch**: `arc use work && arc launch` is the fastest CLI workflow
- **Dashboard alongside**: `arc launch --dashboard` starts the web dashboard with your session
- **Check auth anytime**: `arc auth whoami` shows active account in one line
- **Multiple tools**: Create separate profiles per tool — `work-claude`, `work-gemini`, `work-codex`
- **Desktop + CLI**: Use profiles for CLI isolation, swap bridge for Desktop. They complement each other.
- **Shared MCP servers**: Enable the shared layer so both accounts get the same tool integrations
