/**
 * Chat session primitive — a replayable transcript of a single `arc chat`
 * conversation. Serialized to JSON on disk for resume support.
 *
 * See docs/plans/ai-and-roundtable.md — Phase 4.
 */

import crypto from "node:crypto";
import type { PermissionMode } from "../agent/types.js";

/** A recorded tool invocation within an assistant turn. */
export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  error?: string;
  confirmed?: boolean;
}

/** A single message in the chat transcript. */
export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCallRecord[];
  /** Present on `role: "tool"` messages — points back at the originating tool_call id. */
  toolCallId?: string;
  timestamp: string;
}

/** Summary payload for session listings. */
export interface ChatSessionSummary {
  id: string;
  summary: string;
  profileName: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

/** On-disk wire format. */
export interface ChatSessionJson {
  id: string;
  profileName: string;
  permissionMode: PermissionMode;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * In-memory chat session. Holds an ordered list of messages and a permission
 * mode. Serializes to and from disk via `serialize`/`ChatSession.load`.
 */
export class ChatSession {
  readonly id: string;
  readonly profileName: string;
  readonly createdAt: string;
  permissionMode: PermissionMode;
  messages: ChatMessage[];
  updatedAt: string;

  constructor(init: {
    id?: string;
    profileName: string;
    permissionMode: PermissionMode;
    messages?: ChatMessage[];
    createdAt?: string;
    updatedAt?: string;
  }) {
    this.id = init.id ?? crypto.randomUUID();
    this.profileName = init.profileName;
    this.permissionMode = init.permissionMode;
    this.messages = init.messages ? [...init.messages] : [];
    this.createdAt = init.createdAt ?? nowIso();
    this.updatedAt = init.updatedAt ?? this.createdAt;
  }

  /** Append a message and bump `updatedAt`. Returns the stored message. */
  append(msg: Omit<ChatMessage, "timestamp"> & { timestamp?: string }): ChatMessage {
    const stored: ChatMessage = {
      ...msg,
      timestamp: msg.timestamp ?? nowIso(),
    };
    this.messages.push(stored);
    this.updatedAt = stored.timestamp;
    return stored;
  }

  /** Short, human-readable summary — first user message truncated to 60 chars. */
  summary(): string {
    const firstUser = this.messages.find((m) => m.role === "user");
    if (!firstUser) return "(empty session)";
    const oneLine = firstUser.content.replace(/\s+/g, " ").trim();
    if (oneLine.length <= 60) return oneLine;
    return oneLine.slice(0, 57) + "...";
  }

  /** Produce the on-disk representation. */
  serialize(): ChatSessionJson {
    return {
      id: this.id,
      profileName: this.profileName,
      permissionMode: this.permissionMode,
      messages: this.messages,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Rebuild a `ChatSession` from parsed JSON. Throws on structural errors
   * (missing id / profileName, malformed messages).
   */
  static load(json: unknown): ChatSession {
    if (typeof json !== "object" || json === null) {
      throw new Error("Invalid ChatSession JSON: not an object");
    }
    const obj = json as Record<string, unknown>;
    if (typeof obj["id"] !== "string" || obj["id"].length === 0) {
      throw new Error("Invalid ChatSession JSON: missing id");
    }
    if (typeof obj["profileName"] !== "string") {
      throw new Error("Invalid ChatSession JSON: missing profileName");
    }
    const mode = obj["permissionMode"];
    if (
      mode !== "read-only" &&
      mode !== "supervised" &&
      mode !== "autonomous"
    ) {
      throw new Error(`Invalid ChatSession JSON: bad permissionMode "${String(mode)}"`);
    }
    if (!Array.isArray(obj["messages"])) {
      throw new Error("Invalid ChatSession JSON: messages must be an array");
    }
    const messages: ChatMessage[] = obj["messages"].map((m, i) => {
      if (typeof m !== "object" || m === null) {
        throw new Error(`Invalid ChatSession JSON: message[${i}] not an object`);
      }
      const mm = m as Record<string, unknown>;
      const role = mm["role"];
      if (
        role !== "user" &&
        role !== "assistant" &&
        role !== "system" &&
        role !== "tool"
      ) {
        throw new Error(`Invalid ChatSession JSON: message[${i}].role is invalid`);
      }
      if (typeof mm["content"] !== "string") {
        throw new Error(`Invalid ChatSession JSON: message[${i}].content must be a string`);
      }
      if (typeof mm["timestamp"] !== "string") {
        throw new Error(`Invalid ChatSession JSON: message[${i}].timestamp must be a string`);
      }
      const out: ChatMessage = {
        role,
        content: mm["content"],
        timestamp: mm["timestamp"],
      };
      if (Array.isArray(mm["toolCalls"])) {
        out.toolCalls = mm["toolCalls"] as ToolCallRecord[];
      }
      if (typeof mm["toolCallId"] === "string") {
        out.toolCallId = mm["toolCallId"];
      }
      return out;
    });

    return new ChatSession({
      id: obj["id"],
      profileName: obj["profileName"],
      permissionMode: mode,
      messages,
      createdAt: typeof obj["createdAt"] === "string" ? obj["createdAt"] : nowIso(),
      updatedAt: typeof obj["updatedAt"] === "string" ? obj["updatedAt"] : nowIso(),
    });
  }
}
