import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { createArcMcpServer } from "@axiom-labs/arc-mcp";

// ─── Shared setup ────────────────────────────────────────────────────

/** Helper: create a connected client↔server pair using in-memory transport. */
async function createTestClient() {
  const server = createArcMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.1" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server, clientTransport, serverTransport };
}

/** Helper: call a tool and parse the JSON text content from the first content block. */
async function callToolJSON(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content).toBeDefined();
  expect(content.length).toBeGreaterThan(0);
  expect(content[0].type).toBe("text");
  return JSON.parse(content[0].text);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("MCP Server — arc-supervision tools", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestClient();
    client = ctx.client;
    cleanup = async () => {
      await ctx.clientTransport.close();
      await ctx.serverTransport.close();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  // ── Tool discovery ──────────────────────────────────────────────

  describe("tool listing", () => {
    it("lists all 5 supervision tools", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "arc_audit_completion",
        "arc_classify_risk",
        "arc_derive_completion",
        "arc_expand_intent",
        "arc_explain_trace",
      ]);
    });
  });

  // ── arc_classify_risk ───────────────────────────────────────────

  describe("arc_classify_risk", () => {
    it("classifies deploy-affecting action", async () => {
      const result = await callToolJSON(client, "arc_classify_risk", {
        action: "deploy to production",
      });
      expect(result.tier).toBe("deploy-affecting");
      expect(result.requiresConfirmation).toBe(true);
    });

    it("classifies read-only action", async () => {
      const result = await callToolJSON(client, "arc_classify_risk", {
        action: "explain this code",
      });
      expect(result.tier).toBe("read-only");
      expect(result.requiresConfirmation).toBe(false);
    });

    it("classifies destructive action", async () => {
      const result = await callToolJSON(client, "arc_classify_risk", {
        action: "rm -rf /tmp/data",
      });
      expect(result.tier).toBe("destructive");
      expect(result.requiresConfirmation).toBe(true);
    });

    it("returns read-only for empty string with reason", async () => {
      const result = await callToolJSON(client, "arc_classify_risk", {
        action: "",
      });
      expect(result.tier).toBe("read-only");
      expect(result.reasons).toEqual(expect.arrayContaining([
        expect.stringContaining("empty"),
      ]));
    });

    it("handles very long action string without error", async () => {
      const longAction = "explain ".repeat(5000);
      const result = await callToolJSON(client, "arc_classify_risk", {
        action: longAction,
      });
      expect(result.tier).toBeDefined();
      expect(typeof result.tier).toBe("string");
    });
  });

  // ── arc_audit_completion ────────────────────────────────────────

  describe("arc_audit_completion", () => {
    it("audits complete response", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "done, all tests pass",
      });
      expect(result.status).toBe("complete");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.recommendation).toBe("complete");
    });

    it("audits failed response", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "failed with error: connection refused",
      });
      expect(result.status).toBe("failed");
      expect(result.checksFailed).toContain("no-failure-signals");
    });

    it("returns uncertain for empty response", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "",
      });
      expect(result.status).toBe("uncertain");
      expect(result.confidence).toBe(0);
    });

    it("detects partial (mixed signals)", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "done but one test failed with an error",
      });
      expect(result.status).toBe("partial");
      expect(result.recommendation).toBe("continue");
    });

    it("accepts optional tool_calls parameter", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "completed the task successfully",
        tool_calls: JSON.stringify([{ name: "write_file", args: {} }]),
      });
      expect(result.status).toBe("complete");
    });

    it("handles malformed tool_calls JSON gracefully", async () => {
      const result = await callToolJSON(client, "arc_audit_completion", {
        response_content: "done",
        tool_calls: "not valid json {{{",
      });
      // Should still succeed — parseToolCalls returns undefined on bad JSON
      expect(result.status).toBe("complete");
    });
  });

  // ── arc_expand_intent ───────────────────────────────────────────

  describe("arc_expand_intent", () => {
    it("expands deploy action with risk and sub-actions", async () => {
      const result = await callToolJSON(client, "arc_expand_intent", {
        action: "deploy the app to production",
      });
      expect(result.risk.tier).toBe("deploy-affecting");
      expect(result.risk.requiresConfirmation).toBe(true);
      expect(result.summary).toContain("deploy-affecting");
    });

    it("expands read-only action with low risk", async () => {
      const result = await callToolJSON(client, "arc_expand_intent", {
        action: "read the README",
      });
      expect(result.risk.tier).toBe("read-only");
      expect(result.risk.requiresConfirmation).toBe(false);
    });

    it("detects file-ops sub-actions", async () => {
      const result = await callToolJSON(client, "arc_expand_intent", {
        action: "create a file called config.json and delete the old one",
      });
      expect(result.subActions.length).toBeGreaterThan(0);
      const categories = result.subActions.map((s: { category: string }) => s.category);
      expect(categories).toContain("file-ops");
    });

    it("handles action with no detected sub-actions", async () => {
      const result = await callToolJSON(client, "arc_expand_intent", {
        action: "think about the meaning of life",
      });
      expect(result.subActions).toEqual([]);
      expect(result.summary).toContain("No explicit sub-actions detected");
    });

    it("truncates very long action in result", async () => {
      const longAction = "a".repeat(600);
      const result = await callToolJSON(client, "arc_expand_intent", {
        action: longAction,
      });
      // The action field in result should be truncated to ~500+…
      expect(result.action.length).toBeLessThanOrEqual(502);
      expect(result.action).toContain("…");
    });
  });

  // ── arc_derive_completion ───────────────────────────────────────

  describe("arc_derive_completion", () => {
    it("derives completed status for matching response", async () => {
      const result = await callToolJSON(client, "arc_derive_completion", {
        task_description: "1. Add a login page\n2. Add form validation\n3. Add error handling",
        agent_response: "I added a login page with form validation and comprehensive error handling for all input fields.",
      });
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(["complete", "continue"]).toContain(result.recommendation);
      expect(result.criteriaCount).toBeGreaterThan(0);
    });

    it("derives low score for unrelated response", async () => {
      const result = await callToolJSON(client, "arc_derive_completion", {
        task_description: "1. Implement payment processing\n2. Add Stripe integration",
        agent_response: "I updated the README with a new section about the project.",
      });
      expect(result.score).toBeLessThan(0.8);
    });

    it("handles empty task description", async () => {
      const result = await callToolJSON(client, "arc_derive_completion", {
        task_description: "",
        agent_response: "did everything",
      });
      // No criteria can be extracted from empty description
      expect(result.criteriaCount).toBe(0);
    });

    it("handles empty agent response", async () => {
      const result = await callToolJSON(client, "arc_derive_completion", {
        task_description: "1. Add tests\n2. Fix bugs",
        agent_response: "",
      });
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("escalate");
    });

    it("extracts criteria from checkbox-style tasks", async () => {
      const result = await callToolJSON(client, "arc_derive_completion", {
        task_description: "- [ ] Create user model\n- [ ] Add migration\n- [ ] Write seed data",
        agent_response: "Created the user model with all fields, added the database migration, and wrote seed data for testing.",
      });
      expect(result.criteriaCount).toBeGreaterThanOrEqual(3);
      expect(result.metCount).toBeGreaterThan(0);
    });
  });

  // ── arc_explain_trace ───────────────────────────────────────────

  describe("arc_explain_trace", () => {
    it("returns structured trace with default limit", async () => {
      const result = await callToolJSON(client, "arc_explain_trace", {});
      // In test context, there may or may not be log events — but the structure should be correct
      expect(result.status).toBeDefined();
      expect(["ok", "empty"]).toContain(result.status);
      expect(typeof result.eventCount).toBe("number");
    });

    it("accepts custom limit parameter", async () => {
      const result = await callToolJSON(client, "arc_explain_trace", {
        limit: 5,
      });
      expect(result.status).toBeDefined();
      expect(result.eventCount).toBeLessThanOrEqual(5);
    });

    it("accepts component filter", async () => {
      const result = await callToolJSON(client, "arc_explain_trace", {
        component: "mcp",
        limit: 10,
      });
      expect(result.status).toBeDefined();
      expect(result.filters.component).toBe("mcp");
    });

    it("accepts session_id filter", async () => {
      const result = await callToolJSON(client, "arc_explain_trace", {
        session_id: "nonexistent-session",
        limit: 5,
      });
      expect(result.status).toBeDefined();
      expect(result.filters.sessionId).toBe("nonexistent-session");
    });

    it("returns empty trace array when no events match", async () => {
      const result = await callToolJSON(client, "arc_explain_trace", {
        component: "definitely-nonexistent-component-xyz",
        limit: 5,
      });
      expect(result.status).toBe("empty");
      expect(result.eventCount).toBe(0);
      expect(result.trace).toEqual([]);
    });
  });

  // ── Negative / edge-case tests ─────────────────────────────────

  describe("negative tests", () => {
    it("returns error for non-existent tool", async () => {
      const result = await client.callTool({ name: "arc_nonexistent_tool", arguments: {} });
      expect((result as { isError?: boolean }).isError).toBe(true);
      const content = (result as { content: { type: string; text: string }[] }).content;
      expect(content[0].text).toContain("not found");
    });

    it("returns error for arc_classify_risk with missing action (Zod validation)", async () => {
      // Sending no arguments when action is required
      const result = await client.callTool({ name: "arc_classify_risk", arguments: {} });
      expect((result as { isError?: boolean }).isError).toBe(true);
      const content = (result as { content: { type: string; text: string }[] }).content;
      expect(content[0].text).toContain("Invalid arguments");
    });

    it("returns error for arc_derive_completion with missing required fields", async () => {
      // Missing agent_response
      const result = await client.callTool({
        name: "arc_derive_completion",
        arguments: { task_description: "do stuff" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      const content = (result as { content: { type: string; text: string }[] }).content;
      expect(content[0].text).toContain("agent_response");
    });

    it("returns error for arc_audit_completion with missing response_content", async () => {
      const result = await client.callTool({ name: "arc_audit_completion", arguments: {} });
      expect((result as { isError?: boolean }).isError).toBe(true);
      const content = (result as { content: { type: string; text: string }[] }).content;
      expect(content[0].text).toContain("response_content");
    });
  });
});
