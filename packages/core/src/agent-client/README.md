# agent-client — CLI-spawn Agent Foundation

Phase 1 of the AI chat / roundtable plan. See `docs/plans/ai-and-roundtable.md`
decision **AD-1** for the why.

## What it is

A tiny abstraction for programmatic agent invocation:

1. Take an ARC `Profile`.
2. Spawn the profile's native CLI tool in **one-shot mode** (no TUI).
3. Stream stdout back as structured `AgentChunk`s.
4. Optionally inject an MCP config at launch so the agent can call our tools.

We do **not** build a direct HTTP LLM client. We orchestrate the agent tools
that already exist (`claude`, `codex`, `gemini`), letting them handle auth,
retries, streaming, and tool-use negotiation.

## Usage

```ts
import { getAgentClientForProfile } from "@axiom-labs/arc-core";

const client = getAgentClientForProfile(profile);

for await (const chunk of client.send("What profiles do I have?")) {
  if (chunk.type === "text") process.stdout.write(chunk.content);
  if (chunk.type === "done") break;
}

await client.shutdown();
```

### With MCP injection

```ts
for await (const chunk of client.send("List my profiles", {
  mcpConfig: {
    mode: "config-file", // must match profile.tool's mcpMode
    servers: {
      arc: {
        command: "node",
        args: ["/path/to/arc-mcp-server.mjs"],
        env: { ARC_AUTH_TOKEN: "..." },
      },
    },
  },
})) {
  if (chunk.type === "tool_call") console.log("tool:", chunk.tool, chunk.input);
  if (chunk.type === "tool_result") console.log("result:", chunk.result);
  if (chunk.type === "text") process.stdout.write(chunk.content);
}
```

### With instructions / abort / timeout

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 30_000);

for await (const chunk of client.send("Summarize my setup", {
  instructions: "You are an ARC operator. Be concise.",
  signal: ac.signal,
  timeoutMs: 45_000,
})) { /* ... */ }
```

## MCP injection modes

| Tool   | `mcpMode`      | How |
|--------|----------------|-----|
| claude | `config-file`  | Write `{mcpServers:{...}}` to a temp file, pass `--mcp-config <path>`. |
| codex  | `config-args`  | Emit `-c mcp.servers.<name>.<field>=<value>` repeated. |
| gemini | `mcp-add`      | Run `gemini mcp add --scope project <name> ...` before launch. |

All three mirror Agent-Forge's `agents.json` tribal knowledge.

## Output parsing

| Tool   | stdout format       | Parser |
|--------|---------------------|--------|
| claude | line-delimited JSON | `parseClaudeStreamJson` |
| codex  | line-delimited JSON | `parseCodexJson` |
| gemini | plain text          | `parseGeminiPlain` (text passthrough) |

Each parser returns `AgentChunk | null` per line. Unknown event shapes return
`null` (we skip instead of crashing).

## Known gaps / TODOs

- **System prompt.** Claude's `-p` mode has no dedicated system-prompt flag.
  We synthesize one by wrapping: `System: ...\n\nUser: ...`. Same for Codex
  (no separate system flag in `exec --json`). Gemini follows the same pattern
  for consistency.
- **Codex event shape.** Codex's `exec --json` format has shifted between
  versions; the parser accepts both `kind` and `type` discriminators and maps
  the recognizable subset. Add real-binary smoke tests in Phase 4.
- **Gemini tool events.** Gemini `-p` prints plain text only; structured tool
  events arrive via the MCP side-channel, not stdout.
- **Flags verification.** The exact one-shot flags (`--output-format stream-json
  --verbose` for claude, `exec --json` for codex, `-p` for gemini) are drawn
  from Agent-Forge + upstream docs. Verify with real binaries in Phase 4 smoke
  tests before depending on them in CI.
- **Aider / opencode.** Omitted from Phase 1 — they're TUI-only with no clean
  one-shot mode.

## Files

- `types.ts` — `AgentClient`, `AgentChunk`, `McpConfigInjection`, `AgentProgram`.
- `registry.ts` — `AGENT_PROGRAMS` ported from Agent-Forge `agents.json`.
- `mcp-injection.ts` — three injection helpers + temp-file cleanup.
- `stream-parsers.ts` — line → `AgentChunk` for each tool's output dialect.
- `spawn-helpers.ts` — internal spawn + stream primitive.
- `claude.ts`, `codex.ts`, `gemini.ts` — per-tool `AgentClient` classes.
- `dispatch.ts` — `getAgentClientForProfile`.
- `index.ts` — barrel export.
