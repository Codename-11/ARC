/**
 * ToolRegistry — central dispatcher for agent tool calls.
 *
 * Responsibilities:
 *   1. Store `Tool` definitions with unique names.
 *   2. Expose `ToolDefinition`s to LLMs filtered by permission mode.
 *   3. Validate inputs against each tool's zod schema before dispatch.
 *   4. Enforce permission gating (`canUseTool`) and confirmation gating
 *      (`needsConfirmation`) before calling the handler.
 *   5. Catch handler errors and return a structured `ToolResult`.
 */

import type { z } from "zod";
import { writeLogEvent } from "../logging.js";
import { canUseTool, needsConfirmation } from "./permissions.js";
import type {
  PermissionMode,
  Tool,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Minimal zod → JSON-schema shim
// ---------------------------------------------------------------------------

/**
 * Inline, dependency-free converter covering the zod shapes we actually use
 * in ARC tool definitions: objects of primitives, optionals, arrays, enums.
 * We intentionally do NOT re-implement the full spec — any exotic shape falls
 * through to `{}` which the LLM will treat as "any JSON".
 */
function zodToSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const values = (def as { values?: readonly string[] }).values ?? [];
      return { type: "string", enum: [...values] };
    }
    case "ZodArray": {
      const inner = (def as { type?: z.ZodTypeAny }).type;
      return { type: "array", items: inner ? zodToSchema(inner) : {} };
    }
    case "ZodOptional":
    case "ZodNullable": {
      const inner = (def as { innerType?: z.ZodTypeAny }).innerType;
      return inner ? zodToSchema(inner) : {};
    }
    case "ZodObject": {
      const shape = (def as { shape?: () => Record<string, z.ZodTypeAny> }).shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToSchema(child);
        const childDef = (child as { _def?: { typeName?: string } })._def;
        if (childDef?.typeName !== "ZodOptional" && childDef?.typeName !== "ZodDefault") {
          required.push(key);
        }
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) out["required"] = required;
      return out;
    }
    case "ZodDefault": {
      const inner = (def as { innerType?: z.ZodTypeAny }).innerType;
      return inner ? zodToSchema(inner) : {};
    }
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

// Tool<any, any> is used internally to avoid variance issues when callers
// register typed Tool<Input, Output> values — TypeScript treats `unknown`
// contravariantly on handler input, so `Tool<{...}, ...>` is not assignable
// to `Tool<unknown, unknown>` without `any` on the storage side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: AnyTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Check whether a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Retrieve a tool by name (or undefined if missing). */
  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List registered tools. If `filter` is provided, only tools matching the
   * predicate are returned.
   */
  list(filter?: (t: AnyTool) => boolean): AnyTool[] {
    const all = [...this.tools.values()];
    return filter ? all.filter(filter) : all;
  }

  /**
   * Produce the public `ToolDefinition[]` that should be sent to the LLM for
   * the given permission mode.
   *
   * If `modeFilter` is omitted, returns definitions for every registered
   * tool regardless of permission tier.
   */
  getSchemas(modeFilter?: PermissionMode): ToolDefinition[] {
    return this.list((t) => (modeFilter ? canUseTool(t, modeFilter) : true)).map((t) => ({
      name: t.name,
      description: t.description,
      permission: t.permission,
      inputSchema: zodToSchema(t.schema as z.ZodTypeAny),
    }));
  }

  /**
   * Validate + dispatch a tool call.
   *
   * Returns a `ToolResult` — never throws for ordinary failure paths
   * (unknown tool, validation failure, permission denial, handler error).
   */
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }

    // Permission tier vs. current mode.
    if (!canUseTool(tool, ctx.mode)) {
      writeLogEvent({
        level: "warn",
        component: "agent:registry",
        action: "tool-blocked",
        message: `Tool '${name}' blocked under permission mode '${ctx.mode}'`,
        data: { tool: name, permission: tool.permission, mode: ctx.mode },
      });
      return {
        ok: false,
        blocked: true,
        error: `Tool '${name}' is not available in '${ctx.mode}' mode (requires '${tool.permission}')`,
      };
    }

    // Input validation via zod.
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      return { ok: false, error: `Invalid input for '${name}': ${issues}` };
    }

    // Supervised write/dangerous → human confirmation.
    if (needsConfirmation(tool, ctx.mode)) {
      const prompt =
        tool.permission === "dangerous"
          ? `DANGEROUS: run tool '${name}'? ${tool.description}`
          : `Run tool '${name}'? ${tool.description}`;
      let approved = false;
      try {
        approved = await ctx.confirm(prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Confirmation failed: ${msg}` };
      }
      if (!approved) {
        writeLogEvent({
          level: "info",
          component: "agent:registry",
          action: "tool-declined",
          message: `User declined tool '${name}'`,
          data: { tool: name, permission: tool.permission },
        });
        return { ok: false, blocked: true, error: `User declined tool '${name}'` };
      }
    }

    // Dispatch.
    ctx.log(`tool:${name} dispatching`);
    writeLogEvent({
      level: "info",
      component: "agent:registry",
      action: "tool-dispatch",
      message: `Executing tool '${name}'`,
      data: { tool: name, permission: tool.permission, mode: ctx.mode },
    });

    try {
      const output = await tool.handler(parsed.data, ctx);
      return { ok: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeLogEvent({
        level: "error",
        component: "agent:registry",
        action: "tool-error",
        message: `Tool '${name}' threw: ${msg}`,
        data: { tool: name },
      });
      return { ok: false, error: msg };
    }
  }
}
