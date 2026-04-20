import crypto from "node:crypto";
import {
  ChatCreateParams,
  ChatPostParams,
  ChatReadParams,
  ChatWaitParams,
  Topics,
  extractMentions,
  mentionMatches,
  type ChatMessage,
} from "@axiom-labs/arc-client";
import type { RpcHandler } from "./types.js";
import type { DB } from "../db.js";

/**
 * Chat-room RPCs — rooms + append-only messages with mention extraction.
 * Schemas live in `@axiom-labs/arc-client/protocol-chat.ts`.
 */

interface ChatRoomRow {
  id: string;
  name: string;
  created_at: number;
  metadata: string | null;
}

interface ChatMessageRow {
  id: number;
  room_id: string;
  author: string;
  reply_to: number | null;
  mentions: string | null;
  body: string;
  ts: number;
}

function roomRowToSummary(row: ChatRoomRow): {
  id: string;
  name: string;
  createdAt: number;
  metadata: Record<string, unknown> | null;
} {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
  };
}

function messageRowToWire(row: ChatMessageRow): ChatMessage {
  const mentions = row.mentions ? (JSON.parse(row.mentions) as string[]) : [];
  return {
    id: row.id,
    roomId: row.room_id,
    author: row.author,
    body: row.body,
    ts: row.ts,
    replyTo: row.reply_to,
    mentions,
  };
}

function badRequest(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = "bad_request";
  return err;
}

function notFound(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = "not_found";
  return err;
}

/** Resolve a room by id or by name. */
function findRoom(db: DB, key: string): ChatRoomRow | null {
  const byId = db.prepare("SELECT * FROM chat_rooms WHERE id = ?").get(key) as
    | ChatRoomRow
    | undefined;
  if (byId) return byId;
  const byName = db.prepare("SELECT * FROM chat_rooms WHERE name = ?").get(key) as
    | ChatRoomRow
    | undefined;
  return byName ?? null;
}

export const chatCreate: RpcHandler = (raw, ctx) => {
  const { name, metadata } = ChatCreateParams.parse(raw);
  const existing = ctx.db.prepare("SELECT * FROM chat_rooms WHERE name = ?").get(name) as
    | ChatRoomRow
    | undefined;
  if (existing) return { room: roomRowToSummary(existing) };

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const metaStr = metadata ? JSON.stringify(metadata) : null;
  ctx.db
    .prepare("INSERT INTO chat_rooms (id, name, created_at, metadata) VALUES (?, ?, ?, ?)")
    .run(id, name, createdAt, metaStr);
  return { room: { id, name, createdAt, metadata: metadata ?? null } };
};

export const chatList: RpcHandler = (_params, ctx) => {
  const rows = ctx.db
    .prepare("SELECT * FROM chat_rooms ORDER BY created_at ASC")
    .all() as ChatRoomRow[];
  return { rooms: rows.map(roomRowToSummary) };
};

export const chatPost: RpcHandler = (raw, ctx) => {
  const params = ChatPostParams.parse(raw);
  const room = findRoom(ctx.db, params.room);
  if (!room) throw notFound(`chat room not found: ${params.room}`);

  if (params.replyTo !== undefined) {
    const parent = ctx.db
      .prepare("SELECT id, room_id FROM chat_messages WHERE id = ?")
      .get(params.replyTo) as { id: number; room_id: string } | undefined;
    if (!parent) throw badRequest(`reply_to message not found: ${params.replyTo}`);
    if (parent.room_id !== room.id) {
      throw badRequest("reply_to message is in a different room");
    }
  }

  const mentions = params.mentions ?? extractMentions(params.body);
  const mentionsStr = mentions.length > 0 ? JSON.stringify(mentions) : null;
  const ts = Date.now();
  const result = ctx.db
    .prepare(
      "INSERT INTO chat_messages (room_id, author, reply_to, mentions, body, ts) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(room.id, params.author, params.replyTo ?? null, mentionsStr, params.body, ts);
  const id = Number(result.lastInsertRowid);
  const message: ChatMessage = {
    id,
    roomId: room.id,
    author: params.author,
    body: params.body,
    ts,
    replyTo: params.replyTo ?? null,
    mentions,
  };

  ctx.hub.publish(Topics.chatRoom(room.id), message);
  return { message };
};

export const chatRead: RpcHandler = (raw, ctx) => {
  const params = ChatReadParams.parse(raw);
  const room = findRoom(ctx.db, params.room);
  if (!room) throw notFound(`chat room not found: ${params.room}`);
  const limit = Math.min(params.limit ?? 200, 1000);
  const sinceMs = params.sinceMs ?? 0;
  const rows = ctx.db
    .prepare(
      "SELECT * FROM chat_messages WHERE room_id = ? AND ts > ? ORDER BY ts ASC, id ASC LIMIT ?",
    )
    .all(room.id, sinceMs, limit) as ChatMessageRow[];
  let messages = rows.map(messageRowToWire);
  if (params.mentionsOnly) {
    messages = messages.filter((m) => (m.mentions?.length ?? 0) > 0);
  }
  if (params.mentioning) {
    messages = messages.filter((m) => mentionMatches(m.mentions, params.mentioning!));
  }
  return { messages };
};

/**
 * chat.wait — blocks until a new message arrives in `room` that matches the
 * optional `mentioning` filter, or until `timeoutMs` elapses.
 */
export const chatWait: RpcHandler = (raw, ctx) => {
  const params = ChatWaitParams.parse(raw);
  const room = findRoom(ctx.db, params.room);
  if (!room) throw notFound(`chat room not found: ${params.room}`);
  const timeoutMs = params.timeoutMs ?? 60_000;
  const topic = Topics.chatRoom(room.id);

  return new Promise<{ message: ChatMessage | null; timedOut: boolean }>((resolve) => {
    let resolved = false;
    let unsubscribe: () => void = () => {};
    let timer: NodeJS.Timeout | null = null;

    const finish = (value: { message: ChatMessage | null; timedOut: boolean }): void => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };

    unsubscribe = ctx.hub.subscribeRaw(topic, (payload) => {
      const message = payload as ChatMessage;
      if (params.mentioning && !mentionMatches(message.mentions, params.mentioning)) return;
      finish({ message, timedOut: false });
    });

    timer = setTimeout(() => finish({ message: null, timedOut: true }), timeoutMs);
  });
};
