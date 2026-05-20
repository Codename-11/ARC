import { Methods } from "@axiom-labs/arc-client";
import { authLogin } from "./auth.js";
import { healthGet } from "./health.js";
import { profileGet, profileList } from "./profile.js";
import { agentAttach, agentList, agentRun, agentSend, agentStop } from "./agent.js";
import type { RpcHandler } from "./types.js";

/** Methods that do NOT require an authenticated session. */
export const PUBLIC_METHODS = new Set<string>([Methods.auth_login, Methods.health_get]);

export const handlers: Record<string, RpcHandler> = {
  [Methods.auth_login]: authLogin,
  [Methods.health_get]: healthGet,
  [Methods.profile_list]: profileList,
  [Methods.profile_get]: profileGet,
  [Methods.agent_list]: agentList,
  [Methods.agent_run]: agentRun,
  [Methods.agent_stop]: agentStop,
  [Methods.agent_send]: agentSend,
  [Methods.agent_attach]: agentAttach,
};

export type { RpcContext } from "./types.js";
