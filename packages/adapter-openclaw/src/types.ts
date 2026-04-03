/**
 * Minimal OpenClaw Plugin API interface.
 *
 * OpenClaw doesn't publish typed SDK exports, so we define the subset
 * that the ARC plugin module uses. This covers registerHook, registerTool,
 * and config access on the plugin API object that OpenClaw's jiti loader
 * passes to the register() entry point.
 */

/** Content block returned by tool execute functions (MCP-compatible shape). */
export interface ToolContent {
  type: string;
  text: string;
}

/** Result shape returned by tool execute functions. */
export interface ToolResult {
  content: ToolContent[];
}

/** Tool definition registered with the OpenClaw plugin API. */
export interface OpenClawToolDefinition {
  name: string;
  description: string;
  parameters: object;
  execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
}

/** Options passed alongside tool registration. */
export interface ToolRegistrationOptions {
  optional: boolean;
}

/** Hook handler metadata. */
export interface HookMeta {
  name: string;
  description: string;
}

/**
 * The plugin API object that OpenClaw passes to the register() entry point.
 *
 * This is a minimal contract — real OpenClaw may expose additional methods,
 * but the ARC adapter only depends on these three surfaces.
 */
export interface OpenClawPluginApi {
  registerHook(
    event: string,
    handler: Function,
    meta: HookMeta,
  ): void;

  registerTool(
    tool: OpenClawToolDefinition,
    options?: ToolRegistrationOptions,
  ): void;

  config: Record<string, unknown>;
}
