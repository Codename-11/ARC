# Chat with ARC

`arc chat` is an interactive REPL that lets you talk to ARC through your active profile's CLI tool (Claude Code, Codex, or Gemini). The profile's tool is the *model backend* — ARC spawns it one-shot per turn, streams the response back to your terminal, and dispatches any ARC tool calls the model makes.

This is the safest way to ask questions about your ARC setup or drive ARC operations through natural language: *"list my profiles"*, *"clone `work` to `work-backup`"*, *"show the last ten launches and any doctor issues"*.

## Quickstart

```bash
arc chat                                 # interactive REPL using the active profile
arc chat --once "summarize my profiles"  # one-shot question, exit when done
arc chat --profile work                  # override the active profile
arc chat --mode read-only                # forbid any write-tool calls
arc chat --no-tools                      # plain chat — model only, no ARC tools
arc chat --session <id>                  # resume a prior session
arc chat --new                           # start fresh (ignore any prior session)
```

`arc chat` requires an active profile (or an explicit `--profile`) whose `tool` field is set to `claude`, `codex`, or `gemini`. OpenAI-compatible profiles fall back to their underlying CLI.

## How it works

Every turn, ARC:

1. Composes a system prompt from the knowledge layer (ARC architecture, command catalog, feature index, live state snapshot).
2. Spawns the profile's CLI in one-shot mode with that prompt plus the full replayed conversation.
3. Parses the tool-use stream and dispatches any `tool_call` events through the ARC tool registry.
4. Appends the response to the session file and waits for your next input.

## Permission modes

The permission mode controls what ARC tools the model can run.

| Mode         | Read tools | Write tools                   | Dangerous tools |
|--------------|------------|-------------------------------|-----------------|
| `read-only`  | allowed    | blocked                       | blocked         |
| `supervised` (default) | allowed | require `[y/N]` confirmation  | blocked         |
| `autonomous` | allowed    | allowed                       | require confirmation |

Confirmation prompts appear inline in the REPL. In `--once` mode, write and dangerous tools auto-deny (no stdin is available for a Y/N gate), so pair `--once` with `--mode read-only` for headless use or `--mode autonomous` when you trust the tool call chain.

The **read tier** covers `list_profiles`, `show_profile`, `get_active_profile`, `list_launches`, `query_logs`, `list_skills`, `list_memories`, `list_tasks`, `list_remote_agents`, `list_mcp_servers`, `get_arc_version`.

The **write tier** covers `clone_profile`, `switch_active_profile`, `set_profile_instructions`, `set_profile_flags`.

The **dangerous tier** covers `delete_profile` (and will grow as features land).

## REPL commands

Inside the interactive REPL, slash-prefixed commands are captured by `arc chat` and never sent to the model:

| Command          | Effect                                                    |
|------------------|-----------------------------------------------------------|
| `/exit`, `/quit` | End the session                                           |
| `/save`          | Force-save the session (auto-saves after each turn anyway)|
| `/new`           | Start a new session, drop the current transcript          |
| `/mode <m>`      | Switch permission mode mid-session                        |
| `/clear`         | Clear the in-memory transcript but keep the session id    |
| `/sessions`      | List saved sessions for this profile                      |
| `/resume <id>`   | Load a prior session by id                                |
| `/help`          | Show the command list                                     |

## Session persistence

Sessions are stored per profile under:

```
~/.arc/profiles/<profile>/chat-sessions/<session-id>.json
```

Each file holds the ordered message list (user / assistant / system / tool), the permission mode, and timestamps. Writes are atomic (temp file + rename). Use `/sessions` and `/resume <id>` inside the REPL, or `arc chat --session <id>` from the CLI, to pick up where you left off.

## Tool-use overview

ARC ships about 16 built-in tools spanning the three permission tiers. The system prompt advertises them by category so the model knows what it can reach for:

- **Profiles** — list, show, clone, switch, flags, instructions, delete
- **State** — active profile, recent launches, ARC version
- **Logs + memory + tasks** — read and search
- **Skills + remote agents** — read
- **Shared layer** — read MCP servers

A tool call renders in the transcript as:

```
→ tool:list_profiles {}
← result list_profiles [{"name":"work", ...}]
```

The registry auto-truncates large results at 400 characters to keep the terminal readable. The full result is still sent back to the model.

## Known limitations

- **O(n²) context growth.** One-shot agent clients cannot accept additional `tool_result` messages into an existing session, so ARC replays the whole conversation on every turn. A soft cap clips history to roughly 15K tokens; expect the oldest turns to be elided in long sessions.
- **Gemini has no structured tool events.** The Gemini CLI streams plain text, so `tool_use` / `tool_result` events are surfaced through the MCP side-channel rather than the stdout stream. You may see tool activity in the logs without the inline `→ tool:` line.
- **`--once` mode auto-denies writes.** There is no stdin for a confirmation prompt; use `--mode autonomous` if you need write tools to run non-interactively.
- **Active profile required.** `arc chat` without `--profile` errors if `activeProfile` is `null`. Set one with `arc use <name>` or pass `--profile <name>`.

## See also

- [Roundtables](/guide/roundtable) — drive multiple profiles through a structured discussion.
- [Multi-agent pipelines](/guide/multi-agent-pipelines) — PLAN → EXEC → VERIFY state machines.
- [Profiles](/guide/profiles) — create, switch, and import profiles.
- [Permission model](/features/permissions) — three-tier permission semantics and audit.
