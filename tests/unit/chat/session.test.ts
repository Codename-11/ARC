import { describe, it, expect } from "vitest";
import { ChatSession } from "../../../packages/core/src/chat/session.js";

describe("ChatSession", () => {
  it("constructs with defaults and generates an id", () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "supervised" });
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(s.profileName).toBe("p");
    expect(s.messages).toEqual([]);
    expect(s.permissionMode).toBe("supervised");
    expect(typeof s.createdAt).toBe("string");
  });

  it("appends messages and updates updatedAt", async () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "read-only" });
    const firstUpdated = s.updatedAt;
    // ensure clock advances
    await new Promise((r) => setTimeout(r, 5));
    s.append({ role: "user", content: "hi" });
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.messages[0].content).toBe("hi");
    expect(typeof s.messages[0].timestamp).toBe("string");
    expect(s.updatedAt).not.toBe(firstUpdated);
  });

  it("summary() returns (empty session) when no user message", () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "autonomous" });
    expect(s.summary()).toBe("(empty session)");
    s.append({ role: "assistant", content: "hi" });
    expect(s.summary()).toBe("(empty session)");
  });

  it("summary() truncates first user message to 60 chars", () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "supervised" });
    s.append({ role: "user", content: "a".repeat(120) });
    const sum = s.summary();
    expect(sum.length).toBe(60);
    expect(sum.endsWith("...")).toBe(true);
  });

  it("summary() collapses whitespace", () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "supervised" });
    s.append({ role: "user", content: "hello   world\nline2" });
    expect(s.summary()).toBe("hello world line2");
  });

  it("serialize/load roundtrips losslessly", () => {
    const s = new ChatSession({ profileName: "p", permissionMode: "supervised" });
    s.append({ role: "user", content: "hello" });
    s.append({
      role: "assistant",
      content: "hi back",
      toolCalls: [
        {
          id: "t1",
          name: "list_profiles",
          input: {},
          result: { profiles: [] },
        },
      ],
    });
    s.append({ role: "tool", content: "done", toolCallId: "t1" });

    const json = s.serialize();
    const revived = ChatSession.load(JSON.parse(JSON.stringify(json)));
    expect(revived.id).toBe(s.id);
    expect(revived.profileName).toBe(s.profileName);
    expect(revived.permissionMode).toBe(s.permissionMode);
    expect(revived.messages.length).toBe(3);
    expect(revived.messages[1].toolCalls?.[0]?.name).toBe("list_profiles");
    expect(revived.messages[2].toolCallId).toBe("t1");
  });

  it("load() rejects non-object JSON", () => {
    expect(() => ChatSession.load(null)).toThrow(/not an object/);
    expect(() => ChatSession.load(42)).toThrow(/not an object/);
  });

  it("load() rejects missing id / profileName", () => {
    expect(() => ChatSession.load({ profileName: "p", permissionMode: "supervised", messages: [] })).toThrow(/missing id/);
    expect(() =>
      ChatSession.load({ id: "x", permissionMode: "supervised", messages: [] }),
    ).toThrow(/missing profileName/);
  });

  it("load() rejects unknown permissionMode", () => {
    expect(() =>
      ChatSession.load({ id: "x", profileName: "p", permissionMode: "loose", messages: [] }),
    ).toThrow(/bad permissionMode/);
  });

  it("load() rejects non-array messages", () => {
    expect(() =>
      ChatSession.load({ id: "x", profileName: "p", permissionMode: "supervised", messages: "nope" }),
    ).toThrow(/must be an array/);
  });

  it("load() rejects malformed message entries", () => {
    expect(() =>
      ChatSession.load({
        id: "x",
        profileName: "p",
        permissionMode: "supervised",
        messages: [{ role: "x", content: "hi", timestamp: "2026-01-01" }],
      }),
    ).toThrow(/role is invalid/);

    expect(() =>
      ChatSession.load({
        id: "x",
        profileName: "p",
        permissionMode: "supervised",
        messages: [{ role: "user", content: 42, timestamp: "2026-01-01" }],
      }),
    ).toThrow(/content must be a string/);

    expect(() =>
      ChatSession.load({
        id: "x",
        profileName: "p",
        permissionMode: "supervised",
        messages: [{ role: "user", content: "hi", timestamp: 123 }],
      }),
    ).toThrow(/timestamp must be a string/);
  });
});
