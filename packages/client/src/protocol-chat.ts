import { z } from "zod";

/**
 * Protocol v1 chat room schemas. All new fields MUST be `.optional()` with a
 * default on the daemon side to keep the wire format forward-compatible.
 */

export const ChatCreateParams = z.object({
  name: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const ChatRoomSummary = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const ChatCreateResult = z.object({ room: ChatRoomSummary });

export const ChatListResult = z.object({ rooms: z.array(ChatRoomSummary) });

export const ChatPostParams = z.object({
  room: z.string(),
  author: z.string(),
  body: z.string(),
  replyTo: z.number().int().nonnegative().optional(),
  /** Optional explicit mentions; overrides body extraction when provided. */
  mentions: z.array(z.string()).optional(),
});

export const ChatMessage = z.object({
  id: z.number(),
  roomId: z.string(),
  author: z.string(),
  body: z.string(),
  ts: z.number(),
  replyTo: z.number().nullable().optional(),
  mentions: z.array(z.string()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatPostResult = z.object({ message: ChatMessage });

export const ChatReadParams = z.object({
  room: z.string(),
  sinceMs: z.number().int().nonnegative().optional(),
  mentionsOnly: z.boolean().optional(),
  mentioning: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

export const ChatReadResult = z.object({ messages: z.array(ChatMessage) });

export const ChatWaitParams = z.object({
  room: z.string(),
  mentioning: z.string().optional(),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1000).optional(),
});

export const ChatWaitResult = z.object({
  message: ChatMessage.nullable(),
  timedOut: z.boolean(),
});

/** Extract `@token` mentions from a message body. */
export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  // Match @word, allow letters, digits, _, - and . (for agent ids like @agent-abc.1)
  const re = /(^|[\s.,;:!?()[\]{}"'])@([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const id = m[2];
    if (id) out.add(id);
  }
  return Array.from(out);
}

/** Returns true if `mentions` matches the caller `id` (or `@everyone`). */
export function mentionMatches(mentions: string[] | undefined, id: string): boolean {
  if (!mentions || mentions.length === 0) return false;
  const target = id.startsWith("@") ? id.slice(1) : id;
  for (const raw of mentions) {
    const m = raw.startsWith("@") ? raw.slice(1) : raw;
    if (m === target) return true;
    if (m === "everyone") return true;
  }
  return false;
}
