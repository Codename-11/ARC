/**
 * Integration tests for the 6 MCP team tools — Phase 6.
 *
 * Uses the MCP SDK's in-memory transport to exercise the full
 * server/client loop. The shared bus is a module-level singleton, so
 * we `.reset()` it between tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { createArcMcpServer } from "@axiom-labs/arc-mcp";
import { teamBus } from "../../packages/mcp/src/tools/team/shared-bus.js";

async function connect() {
  const server = createArcMcpServer();
  const client = new Client({ name: "test", version: "0.0.1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server, ct, st };
}

async function callJson(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const content = (res as { content: { type: string; text: string }[] }).content;
  const txt = content[0].text;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

describe("MCP team tools", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const { client: c, ct, st } = await connect();
    client = c;
    cleanup = async () => {
      await ct.close();
      await st.close();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    teamBus.reset();
  });

  it("registers all 6 team tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "team_say",
        "team_read",
        "team_status",
        "team_done",
        "team_plan",
        "team_ask",
      ]),
    );
  });

  it("team_say posts a message that team_read returns", async () => {
    const postRes = await callJson(client, "team_say", {
      text: "hello team",
      priority: "urgent",
    });
    expect(postRes.ok).toBe(true);
    expect(typeof postRes.id).toBe("string");

    const readRes = await callJson(client, "team_read", { cursor: 0 });
    expect(readRes.messages.length).toBe(1);
    expect(readRes.messages[0].content).toBe("hello team");
    expect(readRes.messages[0].meta.priority).toBe("urgent");
    expect(readRes.cursor).toBe(1);
  });

  it("team_read honours the cursor (new messages only)", async () => {
    await callJson(client, "team_say", { text: "first" });
    const first = await callJson(client, "team_read", {});
    expect(first.messages.length).toBe(1);
    const cursor = first.cursor;

    await callJson(client, "team_say", { text: "second" });
    const second = await callJson(client, "team_read", { cursor });
    expect(second.messages.length).toBe(1);
    expect(second.messages[0].content).toBe("second");
  });

  it("team_done updates status and posts a done-tagged message", async () => {
    const doneRes = await callJson(client, "team_done", {
      summary: "shipped parser",
      agent: "alice",
    });
    expect(doneRes.ok).toBe(true);
    expect(doneRes.agent.status).toBe("done");
    expect(doneRes.agent.name).toBe("alice");

    const statusRes = await callJson(client, "team_status", {});
    expect(statusRes.agents.length).toBe(1);
    expect(statusRes.agents[0].name).toBe("alice");
    expect(statusRes.agents[0].status).toBe("done");

    const readRes = await callJson(client, "team_read", {});
    expect(readRes.messages[0].content).toBe("shipped parser");
    expect(readRes.messages[0].meta.tag).toBe("done");
  });

  it("team_plan tags messages as plan", async () => {
    await callJson(client, "team_plan", {
      plan: "1. parse 2. emit",
      agent: "planner",
    });
    const readRes = await callJson(client, "team_read", {});
    expect(readRes.messages[0].meta.tag).toBe("plan");
    expect(readRes.messages[0].from).toBe("planner");
  });

  it("team_ask posts a DM-priority message with `to`", async () => {
    await callJson(client, "team_ask", {
      to: "bob",
      question: "ready?",
      from: "alice",
    });
    const readRes = await callJson(client, "team_read", {});
    expect(readRes.messages[0].content).toBe("ready?");
    expect(readRes.messages[0].from).toBe("alice");
    expect(readRes.messages[0].meta.tag).toBe("dm");
    expect(readRes.messages[0].meta.priority).toBe("urgent");
    expect(readRes.messages[0].meta.to).toBe("bob");
  });

  it("team_status returns empty list when no one has reported", async () => {
    const statusRes = await callJson(client, "team_status", {});
    expect(statusRes.agents).toEqual([]);
  });
});
