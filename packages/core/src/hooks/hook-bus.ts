import { writeLogEvent } from "../logging.js";
import type {
  Hook,
  HookContext,
  HookConfig,
  HookResult,
  HookMetadata,
  EnforcementMode,
  PreHookPipelineResult,
  AgentResponse,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Central bus for registering and running hooks in priority order.
 * Handles enforcement mode branching, per-hook timeouts, and structured logging.
 */
export class HookBus {
  private hooks = new Map<string, Hook>();
  private hookConfigs = new Map<string, HookConfig>();

  /** Register a hook on the bus. Replaces any existing hook with the same name. */
  register(hook: Hook, config?: HookConfig): void {
    this.hooks.set(hook.name, hook);
    if (config) {
      this.hookConfigs.set(hook.name, config);
    }
  }

  /** Remove a hook by name. Returns true if a hook was removed. */
  unregister(name: string): boolean {
    this.hookConfigs.delete(name);
    return this.hooks.delete(name);
  }

  /** List all registered hooks, sorted by priority ascending. */
  list(): Hook[] {
    return [...this.hooks.values()].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Run pre-message/pre-launch hooks in priority order.
   * Returns aggregated results, whether the pipeline was blocked, and merged metadata.
   */
  async runPre(
    ctx: HookContext,
    enforcement: EnforcementMode,
    event: "pre-message" | "pre-launch" = "pre-message"
  ): Promise<PreHookPipelineResult> {
    if (enforcement === "off") {
      this.log("info", "hook-bus:skip-all", "Enforcement is off — skipping all hooks", {
        enforcement,
        event,
      });
      return { results: [], blocked: false, metadata: {} };
    }

    const sorted = this.list().filter((h) => h.events.includes(event));
    const results: HookResult[] = [];
    const mergedMetadata: HookMetadata = {};
    let blocked = false;
    const mutableCtx = { ...ctx };

    for (const hook of sorted) {
      const config = this.hookConfigs.get(hook.name);

      // Skip disabled hooks
      if (config && !config.enabled) {
        this.log("info", "hook:skip", `Hook '${hook.name}' disabled — skipping`, {
          hook: hook.name,
          priority: hook.priority,
          enforcement,
        });
        continue;
      }

      const timeoutMs = config?.timeout ?? DEFAULT_TIMEOUT_MS;
      const startMs = Date.now();
      let result: HookResult;

      try {
        result = await this.runWithTimeout(hook, mutableCtx, timeoutMs);
        const durationMs = Date.now() - startMs;

        this.log("info", "hook:check", `Hook '${hook.name}' completed`, {
          hook: hook.name,
          priority: hook.priority,
          enforcement,
          durationMs,
          pass: result.pass,
          block: result.block ?? false,
        });
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const isTimeout =
          err instanceof Error && err.message.includes("timed out");

        if (isTimeout) {
          this.log("warn", "hook:timeout", `Hook '${hook.name}' timed out after ${timeoutMs}ms`, {
            hook: hook.name,
            priority: hook.priority,
            enforcement,
            durationMs,
            timeoutMs,
          });
        } else {
          this.log("error", "hook:error", `Hook '${hook.name}' threw: ${String(err)}`, {
            hook: hook.name,
            priority: hook.priority,
            enforcement,
            durationMs,
            error: String(err),
          });
        }

        // Timeout/error treated as a non-blocking failure in log/advise, blocking in enforce
        result = {
          pass: false,
          reason: isTimeout
            ? `Hook '${hook.name}' timed out after ${timeoutMs}ms`
            : `Hook '${hook.name}' error: ${String(err)}`,
          block: enforcement === "enforce",
        };
      }

      results.push(result);

      // Merge metadata from result
      if (result.metadata) {
        Object.assign(mergedMetadata, result.metadata);
      }

      // Run inject() if present — lets hooks enrich context for downstream hooks
      if (hook.inject) {
        try {
          const injected = hook.inject(mutableCtx);
          if (injected) {
            Object.assign(mergedMetadata, injected);
            mutableCtx.hookMetadata = { ...mutableCtx.hookMetadata, ...injected };
          }
        } catch {
          // inject failure is non-fatal
        }
      }

      // Enforcement mode branching for blocking
      if (result.block) {
        if (enforcement === "enforce") {
          blocked = true;
          this.log("error", "hook:block", `Hook '${hook.name}' blocked the pipeline`, {
            hook: hook.name,
            priority: hook.priority,
            enforcement,
            reason: result.reason,
          });
          // Stop processing further hooks on block
          break;
        }
        // In log/advise modes, record the flag but don't block
        if (enforcement === "log") {
          this.log("warn", "hook:flag", `Hook '${hook.name}' would block (enforcement=log)`, {
            hook: hook.name,
            reason: result.reason,
          });
        }
        if (enforcement === "advise") {
          this.log("warn", "hook:advise", `Hook '${hook.name}' advises: ${result.reason ?? "blocked"}`, {
            hook: hook.name,
            reason: result.reason,
            flag: result.flag,
          });
        }
      }
    }

    return { results, blocked, metadata: mergedMetadata };
  }

  /**
   * Run post-message/post-launch hooks in priority order.
   * Post hooks call postProcess() — they don't block.
   */
  async runPost(
    ctx: HookContext,
    response: AgentResponse,
    enforcement: EnforcementMode,
    event: "post-message" | "post-launch" = "post-message"
  ): Promise<void> {
    if (enforcement === "off") {
      return;
    }

    const sorted = this.list().filter((h) => h.events.includes(event));

    for (const hook of sorted) {
      const config = this.hookConfigs.get(hook.name);
      if (config && !config.enabled) {
        continue;
      }

      if (!hook.postProcess) {
        continue;
      }

      const startMs = Date.now();
      try {
        await hook.postProcess(ctx, response);
        const durationMs = Date.now() - startMs;
        this.log("info", "hook:postProcess", `Post-hook '${hook.name}' completed`, {
          hook: hook.name,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - startMs;
        this.log("warn", "hook:postProcess:error", `Post-hook '${hook.name}' threw: ${String(err)}`, {
          hook: hook.name,
          durationMs,
          error: String(err),
        });
      }
    }
  }

  /** Run a hook's check() with a Promise.race timeout. */
  private async runWithTimeout(
    hook: Hook,
    ctx: HookContext,
    timeoutMs: number
  ): Promise<HookResult> {
    const checkPromise = Promise.resolve(hook.check(ctx));
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Hook '${hook.name}' timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    return Promise.race([checkPromise, timeoutPromise]);
  }

  /** Emit a structured log event for hook pipeline activity. */
  private log(
    level: "info" | "warn" | "error",
    action: string,
    message: string,
    data: Record<string, unknown>
  ): void {
    writeLogEvent({ level, component: "hook-bus", action, message, data });
  }
}
