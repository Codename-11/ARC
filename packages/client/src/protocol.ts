import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const Channel = {
  Control: 0x00,
  Terminal: 0x01,
  File: 0x02,
  Audio: 0x03,
} as const;

export type ChannelId = (typeof Channel)[keyof typeof Channel];

export const FLAG_FRAGMENTED = 0x01;

export const EnvelopeType = z.enum([
  "request",
  "response",
  "event",
  "subscribe",
  "unsubscribe",
  "error",
]);
export type EnvelopeType = z.infer<typeof EnvelopeType>;

export const Envelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string(),
  type: EnvelopeType,
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  topic: z.string().optional(),
  payload: z.unknown().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type Envelope = z.infer<typeof Envelope>;

export const ErrorCode = {
  Unauthorized: "unauthorized",
  BadRequest: "bad_request",
  NotFound: "not_found",
  Internal: "internal",
  Unimplemented: "unimplemented",
} as const;

// --- Method catalog (v1) ----------------------------------------------------
//
// Keep this list authoritative. The daemon registers handlers by method name
// and the client SDK exposes typed wrappers keyed off it.

export const Methods = {
  auth_login: "auth.login",
  health_get: "health.get",
  profile_list: "profile.list",
  profile_get: "profile.get",
  agent_list: "agent.list",
  agent_run: "agent.run",
  agent_stop: "agent.stop",
  agent_send: "agent.send",
} as const;
export type MethodName = (typeof Methods)[keyof typeof Methods];

// --- Method param / result schemas -----------------------------------------

export const AuthLoginParams = z.object({ token: z.string().min(16) });
export const AuthLoginResult = z.object({
  sessionId: z.string(),
  clientId: z.string(),
  serverVersion: z.string(),
  protocol: z.literal(PROTOCOL_VERSION),
});

export const HealthGetResult = z.object({
  ok: z.literal(true),
  version: z.string(),
  protocol: z.literal(PROTOCOL_VERSION),
  uptime_ms: z.number(),
  pid: z.number(),
  host: z.string(),
  port: z.number(),
});

export const ProfileSummary = z.object({
  name: z.string(),
  tool: z.string(),
  active: z.boolean().optional(),
});
export const ProfileListResult = z.object({ profiles: z.array(ProfileSummary) });

export const AgentSummary = z.object({
  id: z.string(),
  profile: z.string(),
  cwd: z.string(),
  status: z.string(),
  launchMode: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable().optional(),
  worktree: z.string().nullable().optional(),
});
export const AgentListResult = z.object({ agents: z.array(AgentSummary) });

export const AgentRunParams = z.object({
  profile: z.string(),
  prompt: z.string().optional(),
  cwd: z.string().optional(),
  worktree: z.string().optional(),
  launchMode: z.enum(["native", "worker"]).optional(),
});
export const AgentRunResult = z.object({ agentId: z.string() });

export const AgentStopParams = z.object({ agentId: z.string() });
export const AgentSendParams = z.object({ agentId: z.string(), text: z.string() });
export const AgentOkResult = z.object({ ok: z.literal(true) });

// --- Topic helpers ----------------------------------------------------------

export const Topics = {
  agents: "agents",
  agent: (id: string) => `agent:${id}`,
  profiles: "profiles",
  chatRoom: (room: string) => `chat:${room}`,
  loop: (id: string) => `loop:${id}`,
  daemon: "daemon",
} as const;
