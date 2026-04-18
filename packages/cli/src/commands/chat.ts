/**
 * `arc chat` — interactive terminal chat REPL that streams an ARC profile's
 * agent responses and drives ARC tools via the tool registry.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 4.
 *
 * Architecture:
 *   - `AgentClient` (Phase 1) — spawns the profile's CLI tool one-shot.
 *   - `ToolRegistry` + `runAgent` (Phase 2) — local dispatch of tool calls.
 *   - `buildSystemPrompt` (Phase 3) — system-prompt composition.
 *   - `ChatSession` + store (Phase 4) — multi-turn persistence.
 */

import readline from "node:readline";
import pc from "picocolors";
import {
  ChatSession,
  saveSession,
  loadSession,
  listSessions,
  getAgentClientForProfile,
  ToolRegistry,
  registerArcTools,
  runAgent,
  buildSystemPrompt,
  getRecentLaunches,
  loadConfig,
  resolveProfile,
  estimateTokens,
  type AgentClient,
  type Profile,
  type ChatMessage,
  type ToolCallRecord,
  type PermissionMode,
  type ToolContext,
  type AgentEvent,
} from "@axiom-labs/arc-core";
import { getVersion } from "../display.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ChatOptions {
  profile?: string;
  mode?: PermissionMode;
  once?: string;
  noTools?: boolean;
  session?: string;
  new?: boolean;
}

// ---------------------------------------------------------------------------
// ANSI helpers (self-contained — no dependency on TTY-only helpers in display)
// ---------------------------------------------------------------------------

function writeText(s: string): void {
  process.stdout.write(s);
}
function writeLine(s: string): void {
  process.stdout.write(s + "\n");
}
function printAssistantText(s: string): void {
  writeText(s);
}
function printThinking(s: string): void {
  writeText(pc.dim(s));
}
function printToolCall(tool: string, input: unknown): void {
  let body: string;
  try {
    body = JSON.stringify(input);
  } catch {
    body = String(input);
  }
  writeLine("\n" + pc.cyan(`→ tool:${tool}`) + " " + pc.dim(body));
}
function printToolResult(tool: string, result: unknown, ok: boolean): void {
  const label = ok ? pc.gray("← result") : pc.red("← error");
  let body: string;
  try {
    body = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    body = String(result);
  }
  if (body.length > 400) body = body.slice(0, 400) + "...";
  writeLine(label + ` ${pc.gray(tool)} ` + pc.dim(body));
}
function printSystem(s: string): void {
  writeLine(pc.blue("\u2139") + " " + s);
}
function printError(s: string): void {
  process.stderr.write(pc.red("\u2716") + " " + s + "\n");
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Construct the single-string prompt fed to a one-shot `AgentClient` on every
 * turn.
 *
 * v1 LIMITATION (see docs/plans/ai-and-roundtable.md — Phase 4):
 * One-shot agent clients cannot accept additional `tool_result` messages into
 * an existing session, so we must replay the full conversation on every turn.
 * This produces O(n^2) context growth as the conversation lengthens. A future
 * phase will upgrade to persistent TTY sessions (`inputMethod: "sendKeys"`)
 * and remove this replay entirely.
 */
export function constructPromptFromSession(session: ChatSession): string {
  const MAX_PROMPT_TOKENS = 15_000;

  const parts: string[] = [];
  parts.push("<conversation>");

  // We iterate sequentially and drop the oldest non-system turns first if
  // we're over budget. System messages are always kept at the top.
  const systemMsgs: ChatMessage[] = [];
  const convMsgs: ChatMessage[] = [];
  for (const m of session.messages) {
    if (m.role === "system") systemMsgs.push(m);
    else convMsgs.push(m);
  }

  // Work backwards so we preserve the most recent context when truncating.
  const kept: ChatMessage[] = [];
  let runningChars = 0;
  const softLimitChars = MAX_PROMPT_TOKENS * 4;
  for (let i = convMsgs.length - 1; i >= 0; i--) {
    const m = convMsgs[i];
    runningChars += m.content.length + 64;
    if (runningChars > softLimitChars && kept.length > 0) break;
    kept.unshift(m);
  }
  if (kept.length < convMsgs.length) {
    kept.unshift({
      role: "system",
      content: `(${convMsgs.length - kept.length} earlier messages omitted to fit context)`,
      timestamp: new Date().toISOString(),
    });
  }

  for (const m of systemMsgs) {
    parts.push(`System: ${m.content}`);
  }
  for (const m of kept) {
    if (m.role === "user") {
      parts.push(`User: ${m.content}`);
    } else if (m.role === "assistant") {
      let line = `Assistant: ${m.content}`;
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          const resultBlob =
            tc.error !== undefined
              ? `error=${tc.error}`
              : tc.result !== undefined
                ? `result=${JSON.stringify(tc.result).slice(0, 300)}`
                : "(no result)";
          line += `\n  (tool_call:${tc.name} ${JSON.stringify(tc.input).slice(0, 200)}) → ${resultBlob}`;
        }
      }
      parts.push(line);
    } else if (m.role === "tool") {
      parts.push(`tool_result: ${m.content}`);
    } else {
      parts.push(`System: ${m.content}`);
    }
  }

  parts.push("</conversation>");
  parts.push("");
  parts.push("Respond to the last user message.");
  const joined = parts.join("\n");
  // Final safety clamp — if we're still over budget, hard-truncate.
  if (estimateTokens(joined) > MAX_PROMPT_TOKENS) {
    const maxChars = MAX_PROMPT_TOKENS * 4;
    return joined.slice(0, maxChars);
  }
  return joined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMode(val: string | undefined): PermissionMode {
  if (val === "read-only" || val === "supervised" || val === "autonomous") return val;
  if (val === undefined) return "supervised";
  throw new Error(
    `Unknown --mode "${val}". Expected one of: read-only, supervised, autonomous.`,
  );
}

function resolveProfileForChat(
  profileName?: string,
): { profile: Profile; name: string } | null {
  const config = loadConfig();
  const explicit = profileName;
  const active = config.activeProfile ?? undefined;
  const name = explicit ?? active;
  if (!name) {
    printError(
      "No active profile and --profile not given. Run 'arc profile switch <name>' or pass --profile.",
    );
    return null;
  }
  let profile: Profile;
  try {
    profile = resolveProfile(config, name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    return null;
  }
  if (!profile.tool) {
    printError(
      `Profile "${name}" has no tool set — cannot run chat. Set a tool with 'arc profile create' or edit ~/.arc/config.json.`,
    );
    return null;
  }
  return { profile, name };
}

function buildToolCategories(noTools: boolean): string[] {
  if (noTools) return [];
  return [
    "profiles (list, show, clone, switch, export)",
    "state (active profile, recent launches, doctor)",
    "logs + memory + tasks (read + search)",
    "skills + remote agents (read)",
    "shared layer (read)",
  ];
}

// ---------------------------------------------------------------------------
// Interactive confirmation
// ---------------------------------------------------------------------------

function makeInteractiveConfirm(
  rl: readline.Interface,
): (prompt: string) => Promise<boolean> {
  return (prompt: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      rl.question(`\n${pc.yellow("?")} ${prompt} [y/N] `, (answer) => {
        const a = answer.trim().toLowerCase();
        resolve(a === "y" || a === "yes");
      });
    });
  };
}

function makeNonInteractiveConfirm(): (prompt: string) => Promise<boolean> {
  // In `--once` mode we do not have a persistent readline; auto-deny writes
  // to avoid blocking on missing stdin.
  return async () => false;
}

// ---------------------------------------------------------------------------
// Core turn execution
// ---------------------------------------------------------------------------

async function executeTurn(args: {
  client: AgentClient;
  registry: ToolRegistry;
  ctx: ToolContext;
  session: ChatSession;
  systemPrompt: string;
  userMessage: string;
}): Promise<void> {
  const { client, registry, ctx, session, systemPrompt, userMessage } = args;
  session.append({ role: "user", content: userMessage });

  // Proxy the session into the one-shot client as a single prompt.
  const prompt = constructPromptFromSession(session);

  let assistantText = "";
  const toolCalls: ToolCallRecord[] = [];
  const pendingById = new Map<string, ToolCallRecord>();

  // Wrap the client.send invocation to surface the system prompt via
  // instructions — the one-shot adapters prepend it to the prompt.
  const wrappedClient: AgentClient = {
    send(p) {
      return client.send(p, { instructions: systemPrompt });
    },
    shutdown() {
      return client.shutdown();
    },
  };

  let events: AsyncIterable<AgentEvent>;
  try {
    events = runAgent({ client: wrappedClient, registry, ctx }, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`Agent failed: ${msg}`);
    return;
  }

  try {
    for await (const ev of events) {
      switch (ev.type) {
        case "text":
          assistantText += ev.content;
          printAssistantText(ev.content);
          break;
        case "thinking":
          printThinking(ev.content);
          break;
        case "tool_call": {
          printToolCall(ev.tool, ev.input);
          const rec: ToolCallRecord = {
            id: ev.id,
            name: ev.tool,
            input: ev.input,
          };
          pendingById.set(ev.id, rec);
          toolCalls.push(rec);
          break;
        }
        case "tool_result": {
          const rec = pendingById.get(ev.id);
          const ok = ev.result.ok;
          if (ok) {
            if (rec) rec.result = ev.result.output;
            printToolResult(ev.tool, ev.result.output, true);
          } else {
            if (rec) {
              rec.error = ev.result.error;
              if (ev.result.blocked) rec.confirmed = false;
            }
            printToolResult(ev.tool, ev.result.error, false);
          }
          break;
        }
        case "error":
          printError(ev.message);
          break;
        case "done":
          if (ev.reason === "max_turns") {
            writeLine(pc.yellow("\n(max tool-turns reached)"));
          }
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`Stream error: ${msg}`);
  }

  // Ensure we terminate the line.
  if (assistantText && !assistantText.endsWith("\n")) writeText("\n");

  session.append({
    role: "assistant",
    content: assistantText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });

  try {
    saveSession(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`Failed to save session: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function handleChat(opts: ChatOptions): Promise<void> {
  const mode = parseMode(opts.mode);
  const resolved = resolveProfileForChat(opts.profile);
  if (!resolved) {
    process.exit(1);
  }
  const { profile, name: profileName } = resolved;

  // Agent client.
  let client: AgentClient;
  try {
    client = getAgentClientForProfile(profile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    process.exit(1);
    return;
  }

  // Tool registry.
  const registry = new ToolRegistry();
  if (!opts.noTools) {
    registerArcTools(registry);
  }

  // System prompt.
  const config = loadConfig();
  const recentLaunches = getRecentLaunches(3).map((l) => ({
    profile: l.profile,
    tool: l.tool,
    startedAt: l.timestamp,
    exitCode: l.exitCode,
  }));
  const systemPrompt = buildSystemPrompt({
    config,
    recentLaunches,
    activeProfile: profile,
    arcVersion: getVersion(),
    doctorIssues: [],
    permissionMode: mode,
    toolCategories: buildToolCategories(opts.noTools ?? false),
  });

  // ── Resume or create session ──────────────────────────
  let session: ChatSession;
  if (opts.session) {
    try {
      session = loadSession(profileName, opts.session);
      printSystem(`Resuming session ${session.id} (${session.messages.length} msgs).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(msg);
      process.exit(1);
      return;
    }
  } else {
    session = new ChatSession({ profileName, permissionMode: mode });
    // Save baseline system context as a system message (useful for resume).
    session.append({
      role: "system",
      content: `ARC chat session — profile=${profileName}, mode=${mode}, tool=${profile.tool}`,
    });
  }

  // ── One-shot mode ─────────────────────────────────────
  if (opts.once !== undefined) {
    const ctx: ToolContext = {
      mode,
      confirm: makeNonInteractiveConfirm(),
      log: () => {},
      profile,
    };
    await executeTurn({
      client,
      registry,
      ctx,
      session,
      systemPrompt,
      userMessage: opts.once,
    });
    try {
      await client.shutdown();
    } catch {
      /* ignore */
    }
    return;
  }

  // ── Interactive REPL ──────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const confirm = makeInteractiveConfirm(rl);

  printSystem(
    `ARC chat — profile=${profileName} tool=${profile.tool} mode=${mode}. Type /help for commands, /exit to quit.`,
  );

  let currentMode: PermissionMode = mode;
  let currentSession = session;
  let currentSystemPrompt = systemPrompt;

  const promptUser = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(pc.bold(pc.cyan("\nyou > ")), (line) => resolve(line));
    });
  };

  const rebuildSystemPromptForMode = (m: PermissionMode): string => {
    return buildSystemPrompt({
      config: loadConfig(),
      recentLaunches,
      activeProfile: profile,
      arcVersion: getVersion(),
      doctorIssues: [],
      permissionMode: m,
      toolCategories: buildToolCategories(opts.noTools ?? false),
    });
  };

  const printHelp = (): void => {
    writeLine("");
    writeLine(pc.bold("Commands:"));
    writeLine("  /exit, /quit         End the session");
    writeLine("  /save                Save the session to disk");
    writeLine("  /new                 Start a new session (forgets current)");
    writeLine("  /mode <m>            Switch permission mode (read-only|supervised|autonomous)");
    writeLine("  /clear               Clear the in-memory transcript (keeps id)");
    writeLine("  /sessions            List saved sessions for this profile");
    writeLine("  /resume <id>         Resume a saved session");
    writeLine("  /help                Show this help");
    writeLine("");
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const input = (await promptUser()).trim();
      if (!input) continue;

      if (input.startsWith("/")) {
        const [cmd, ...rest] = input.slice(1).split(/\s+/);
        const arg = rest.join(" ").trim();

        if (cmd === "exit" || cmd === "quit") {
          break;
        }
        if (cmd === "help") {
          printHelp();
          continue;
        }
        if (cmd === "save") {
          try {
            saveSession(currentSession);
            printSystem(`Saved session ${currentSession.id}.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            printError(msg);
          }
          continue;
        }
        if (cmd === "new") {
          currentSession = new ChatSession({
            profileName,
            permissionMode: currentMode,
          });
          currentSession.append({
            role: "system",
            content: `ARC chat session — profile=${profileName}, mode=${currentMode}, tool=${profile.tool}`,
          });
          printSystem(`Started new session ${currentSession.id}.`);
          continue;
        }
        if (cmd === "mode") {
          try {
            const newMode = parseMode(arg);
            currentMode = newMode;
            currentSession.permissionMode = newMode;
            currentSystemPrompt = rebuildSystemPromptForMode(newMode);
            printSystem(`Permission mode → ${newMode}.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            printError(msg);
          }
          continue;
        }
        if (cmd === "clear") {
          currentSession.messages = [];
          currentSession.append({
            role: "system",
            content: `ARC chat session — profile=${profileName}, mode=${currentMode}, tool=${profile.tool}`,
          });
          printSystem("Transcript cleared.");
          continue;
        }
        if (cmd === "sessions") {
          const summaries = listSessions(profileName);
          if (summaries.length === 0) {
            printSystem("No saved sessions.");
          } else {
            writeLine("");
            for (const s of summaries.slice(0, 20)) {
              const marker = s.id === currentSession.id ? pc.green("*") : " ";
              writeLine(
                `  ${marker} ${pc.cyan(s.id)} ${pc.dim(s.updatedAt)} ${pc.dim(`(${s.messageCount} msgs)`)}  ${s.summary}`,
              );
            }
            writeLine("");
          }
          continue;
        }
        if (cmd === "resume") {
          if (!arg) {
            printError("/resume <id> — pass a session id from /sessions.");
            continue;
          }
          try {
            currentSession = loadSession(profileName, arg);
            currentMode = currentSession.permissionMode;
            currentSystemPrompt = rebuildSystemPromptForMode(currentMode);
            printSystem(
              `Resumed ${currentSession.id} (${currentSession.messages.length} msgs, mode=${currentMode}).`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            printError(msg);
          }
          continue;
        }
        printError(`Unknown command: /${cmd}. Try /help.`);
        continue;
      }

      const ctx: ToolContext = {
        mode: currentMode,
        confirm,
        log: () => {},
        profile,
      };
      await executeTurn({
        client,
        registry,
        ctx,
        session: currentSession,
        systemPrompt: currentSystemPrompt,
        userMessage: input,
      });
    }
  } finally {
    rl.close();
    try {
      await client.shutdown();
    } catch {
      /* ignore */
    }
  }

  printSystem("Goodbye.");
}
