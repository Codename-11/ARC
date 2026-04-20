import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDaemon, type DaemonHandle } from "@axiom-labs/arc-daemon";
import { ArcClient, extractMentions, mentionMatches } from "@axiom-labs/arc-client";

interface TestCtx {
  tmp: string;
  port: number;
  handle: DaemonHandle & { stop: () => Promise<void> };
  client: ArcClient;
  token: string;
}

describe("chat rooms primitive — daemon + client", () => {
  let ctx: TestCtx | null = null;

  beforeEach(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-chat-test-"));
    process.env["ARC_DIR"] = tmp;
    const port = 18200 + Math.floor(Math.random() * 800);
    const handle = await startDaemon({ port, version: "1.0.0-alpha.0-chat-test" });
    const authFile = JSON.parse(
      fs.readFileSync(path.join(tmp, "auth.json"), "utf8"),
    ) as { rootToken: string };
    const client = new ArcClient({
      url: `ws://127.0.0.1:${port}`,
      token: authFile.rootToken,
      noReconnect: true,
    });
    await client.connect();
    ctx = { tmp, port, handle, client, token: authFile.rootToken };
  });

  afterEach(async () => {
    if (!ctx) return;
    await ctx.client.close();
    await ctx.handle.stop();
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
    ctx = null;
  });

  it("extractMentions parses @tokens from body", () => {
    expect(extractMentions("hey @agent-1 and @you").sort()).toEqual(
      ["agent-1", "you"].sort(),
    );
    expect(extractMentions("no mentions here")).toEqual([]);
    expect(extractMentions("end of line @tail")).toEqual(["tail"]);
    expect(extractMentions("punct:@a, @b!")).toEqual(["a", "b"]);
    // Email addresses should not match because `@` is not preceded by a boundary.
    expect(extractMentions("contact me@example.com")).toEqual([]);
  });

  it("mentionMatches honours @everyone", () => {
    expect(mentionMatches(["agent-1"], "agent-1")).toBe(true);
    expect(mentionMatches(["everyone"], "someone-else")).toBe(true);
    expect(mentionMatches(["other"], "agent-1")).toBe(false);
    expect(mentionMatches([], "x")).toBe(false);
    expect(mentionMatches(undefined, "x")).toBe(false);
  });

  it("creates a room and lists it", async () => {
    const created = await ctx!.client.chat.create({ name: "standup" });
    expect(created.room.name).toBe("standup");
    expect(typeof created.room.id).toBe("string");

    const again = await ctx!.client.chat.create({ name: "standup" });
    expect(again.room.id).toBe(created.room.id);

    const list = await ctx!.client.chat.list();
    expect(list.rooms.map((r) => r.name)).toContain("standup");
  });

  it("posts messages by name and id, reads them back, and threads replies", async () => {
    await ctx!.client.chat.create({ name: "general" });

    const first = await ctx!.client.chat.post({
      room: "general",
      author: "user",
      body: "hello world",
    });
    expect(first.message.body).toBe("hello world");
    expect(first.message.author).toBe("user");
    expect(first.message.mentions).toEqual([]);

    const second = await ctx!.client.chat.post({
      room: "general",
      author: "agent-bot",
      body: "reply",
      replyTo: first.message.id,
    });
    expect(second.message.replyTo).toBe(first.message.id);

    const read = await ctx!.client.chat.read({ room: "general" });
    expect(read.messages).toHaveLength(2);
    expect(read.messages[0]!.id).toBe(first.message.id);
    expect(read.messages[1]!.replyTo).toBe(first.message.id);
  });

  it("extracts @mentions on post and filters by mentioning", async () => {
    await ctx!.client.chat.create({ name: "triage" });
    await ctx!.client.chat.post({
      room: "triage",
      author: "user",
      body: "plain message",
    });
    await ctx!.client.chat.post({
      room: "triage",
      author: "user",
      body: "hey @agent-1 can you take this?",
    });
    await ctx!.client.chat.post({
      room: "triage",
      author: "user",
      body: "FYI @everyone",
    });

    const all = await ctx!.client.chat.read({ room: "triage" });
    expect(all.messages).toHaveLength(3);
    expect(all.messages[0]!.mentions).toEqual([]);
    expect(all.messages[1]!.mentions).toEqual(["agent-1"]);
    expect(all.messages[2]!.mentions).toEqual(["everyone"]);

    const mentionsOnly = await ctx!.client.chat.read({
      room: "triage",
      mentionsOnly: true,
    });
    expect(mentionsOnly.messages).toHaveLength(2);

    const mentioningAgent1 = await ctx!.client.chat.read({
      room: "triage",
      mentioning: "agent-1",
    });
    // agent-1 + @everyone both match
    expect(mentioningAgent1.messages).toHaveLength(2);
  });

  it("chat.wait resolves when a new mentioning message arrives", async () => {
    await ctx!.client.chat.create({ name: "watch" });

    // schedule a post ~50ms in the future
    const scheduler = setTimeout(() => {
      ctx!.client.chat
        .post({ room: "watch", author: "sender", body: "yo @me" })
        .catch(() => {});
    }, 50);

    const result = await ctx!.client.chat.wait({
      room: "watch",
      mentioning: "me",
      timeoutMs: 5000,
    });
    clearTimeout(scheduler);

    expect(result.timedOut).toBe(false);
    expect(result.message).not.toBeNull();
    expect(result.message!.body).toContain("@me");
    expect(result.message!.mentions).toContain("me");
  });

  it("chat.wait times out if no matching message arrives", async () => {
    await ctx!.client.chat.create({ name: "quiet" });
    const result = await ctx!.client.chat.wait({
      room: "quiet",
      mentioning: "me",
      timeoutMs: 150,
    });
    expect(result.timedOut).toBe(true);
    expect(result.message).toBeNull();
  });

  it("chat.read honours sinceMs", async () => {
    await ctx!.client.chat.create({ name: "recent" });
    await ctx!.client.chat.post({ room: "recent", author: "a", body: "first" });
    // ensure ts spacing
    await new Promise((r) => setTimeout(r, 10));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 10));
    await ctx!.client.chat.post({ room: "recent", author: "b", body: "second" });

    const after = await ctx!.client.chat.read({
      room: "recent",
      sinceMs: cutoff,
    });
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]!.body).toBe("second");
  });

  it("chat.post rejects reply_to pointing to another room", async () => {
    const a = await ctx!.client.chat.create({ name: "a" });
    const b = await ctx!.client.chat.create({ name: "b" });
    const first = await ctx!.client.chat.post({
      room: a.room.name,
      author: "user",
      body: "hi",
    });
    await expect(
      ctx!.client.chat.post({
        room: b.room.name,
        author: "user",
        body: "cross",
        replyTo: first.message.id,
      }),
    ).rejects.toThrow(/different room/);
  });

  it("chat.post returns not_found for an unknown room", async () => {
    await expect(
      ctx!.client.chat.post({ room: "ghost", author: "u", body: "hi" }),
    ).rejects.toThrow(/chat room not found/);
  });
});
