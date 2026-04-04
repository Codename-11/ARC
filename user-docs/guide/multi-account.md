# Multi-Account Management

ARC provides two complementary systems for working with multiple accounts. Use **profile isolation** for CLI tools where you want fully separate configs, and **credential hot-swap** for desktop apps where you want to share settings but switch auth.

## Profile Isolation (CLI Tools)

Each profile gets its own config directory, credentials, and settings. This is the primary approach for CLI agent tools.

```bash
# Create two Claude profiles with separate OAuth accounts
arc create work --tool claude --auth-type oauth
arc create personal --tool claude --auth-type oauth

# Login to each (opens browser OAuth flow)
arc auth login work
arc auth login personal

# Check which account is in each profile
arc auth status
arc auth whoami work

# Launch with a specific account
arc use work
arc launch
```

### When to Use Profiles

- Different tools (Claude, Gemini, Codex)
- Different settings or MCP servers per account
- Complete isolation between work and personal

## Credential Hot-Swap <Badge type="warning" text="experimental" />

Hot-swap lets you switch between authenticated accounts on the **same tool** without changing MCPs, settings, or session history. Instead of isolated directories, it swaps only the credential files in the tool's canonical config directory.

### How It Differs from Profiles

| | Profile switch (`arc use`) | Hot-swap (`arc swap to`) |
|---|---|---|
| **What changes** | Entire config directory | Only credential files |
| **MCPs, settings** | Each profile has its own | Shared, nothing changes |
| **Session history** | Per-profile (isolated) | Shared, stays in place |
| **Use case** | Different tools or configs | Same tool, multiple accounts |
| **Desktop apps** | Not affected | Auth changes for Desktop too |

### Capture an Account

First, authenticate with the tool normally. Then capture the credentials:

```bash
arc swap capture personal --tool claude
arc swap capture work --tool claude

# Multi-tool support
arc swap capture gemini-work --tool gemini
arc swap capture codex-main --tool codex
```

This copies the credential files from the tool's canonical directory into `~/.arc/credentials/<name>/`.

### Swap Between Accounts

```bash
arc swap to work       # Swap credentials to the "work" account
arc swap to personal   # Swap back to "personal"
```

The current account's credentials are automatically saved before restoring the target.

### Bridge from Profile to Desktop

Push a profile's credentials into the tool's canonical directory (e.g. for Claude Desktop):

```bash
arc swap from-profile work
```

This captures the profile's credentials as a swap snapshot and activates them in the canonical directory, bridging profile isolation with desktop app access.

### Status and Management

```bash
arc swap status        # Show active account per tool and last swap time
arc swap list          # Show all captured accounts with metadata
arc swap delete work   # Remove a snapshot (can't delete the active one)
```

### TUI Access

Open the hot-swap overlay via the Command Palette (Ctrl+P) and select "Swap Credentials". The overlay lets you capture, swap, and delete accounts directly.

### Safety

- `arc swap to` requires confirmation (`[y/N]`) unless `--force` is passed
- If the restore step fails, credentials are rolled back to their previous state
- The swap manifest is updated only after a successful swap

### Data Layout

```
~/.arc/credentials/
  swap-manifest.json       # Tracks accounts and active per tool
  personal/                # Credential snapshot
    .credentials.json
  work/
    .credentials.json
  gemini-work/
    credentials.json
```
