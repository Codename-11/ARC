import { loadConfig } from "@axiom-labs/arc-core";
import type { RpcHandler } from "./types.js";

/**
 * Minimal profile read-only surface for Phase 1. Write ops
 * (create/update/delete/switch) land in Phase 4 when the CLI
 * is ported off direct config.json mutation.
 */

export const profileList: RpcHandler = () => {
  const cfg = loadConfig();
  const active = cfg.activeProfile ?? null;
  const names = cfg.profileOrder ?? Object.keys(cfg.profiles);
  return {
    profiles: names
      .filter((name) => cfg.profiles[name])
      .map((name) => {
        const p = cfg.profiles[name]!;
        return { name, tool: p.tool, active: active === name };
      }),
  };
};

export const profileGet: RpcHandler = (raw) => {
  const params = raw as { name?: string };
  const name = params.name;
  if (!name) {
    const err = new Error("name required") as Error & { code: string };
    err.code = "bad_request";
    throw err;
  }
  const cfg = loadConfig();
  const profile = cfg.profiles[name];
  if (!profile) {
    const err = new Error(`profile not found: ${name}`) as Error & { code: string };
    err.code = "not_found";
    throw err;
  }
  return { profile };
};
