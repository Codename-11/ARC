import { describe, it, expect } from "vitest";
import {
  computeAdaptiveGraceMs,
  createDeliveryState,
  MessagePriorityQueue,
  resolveDeliveryPolicyForTool,
  updateReplyLatencyAverage,
} from "../../../packages/core/src/orchestration/delivery-policy.js";

describe("orchestration/delivery-policy", () => {
  describe("createDeliveryState", () => {
    it("returns an empty EMA state", () => {
      const s = createDeliveryState();
      expect(s.observedLatencyMs).toBe(0);
      expect(s.sampleCount).toBe(0);
    });
  });

  describe("resolveDeliveryPolicyForTool", () => {
    it("dispatches to the gemini profile", () => {
      const p = resolveDeliveryPolicyForTool("gemini");
      expect(p.minReplyGraceMs).toBe(18_000);
      expect(p.adaptiveReplyMultiplier).toBeCloseTo(1.6);
    });

    it("dispatches to the claude profile (case-insensitive)", () => {
      const p = resolveDeliveryPolicyForTool("CLAUDE");
      expect(p.minReplyGraceMs).toBe(12_000);
      expect(p.adaptiveReplyMultiplier).toBeCloseTo(1.45);
    });

    it("dispatches to the codex profile", () => {
      const p = resolveDeliveryPolicyForTool("codex");
      expect(p.minReplyGraceMs).toBe(8_000);
    });

    it("falls back to the default profile for unknown tool", () => {
      const p = resolveDeliveryPolicyForTool("mystery-tool");
      expect(p.minReplyGraceMs).toBe(10_000);
    });

    it("falls back to the default profile when tool is undefined", () => {
      const p = resolveDeliveryPolicyForTool(undefined);
      expect(p.minReplyGraceMs).toBe(10_000);
    });
  });

  describe("updateReplyLatencyAverage", () => {
    it("seeds the EMA on the first sample", () => {
      const updated = updateReplyLatencyAverage(createDeliveryState(), 2_000);
      expect(updated.observedLatencyMs).toBe(2_000);
      expect(updated.sampleCount).toBe(1);
    });

    it("decays prior state 70% and folds new sample at 30%", () => {
      // observed=1000, new=3000 → 1000*0.7 + 3000*0.3 = 1600
      const next = updateReplyLatencyAverage(
        { observedLatencyMs: 1_000, sampleCount: 1 },
        3_000,
      );
      expect(next.observedLatencyMs).toBe(1_600);
      expect(next.sampleCount).toBe(2);
    });

    it("ignores invalid samples", () => {
      const state = { observedLatencyMs: 1_000, sampleCount: 1 };
      expect(updateReplyLatencyAverage(state, 0)).toEqual(state);
      expect(updateReplyLatencyAverage(state, -5)).toEqual(state);
      expect(updateReplyLatencyAverage(state, Number.NaN)).toEqual(state);
    });
  });

  describe("computeAdaptiveGraceMs", () => {
    const policy = resolveDeliveryPolicyForTool("claude");

    it("returns 0 when pacing is disabled", () => {
      const p = { ...policy, respectAgentPace: false };
      expect(computeAdaptiveGraceMs(p, { observedLatencyMs: 5_000, sampleCount: 1 })).toBe(0);
    });

    it("returns minReplyGrace when no samples exist", () => {
      expect(computeAdaptiveGraceMs(policy, createDeliveryState())).toBe(
        policy.minReplyGraceMs,
      );
    });

    it("clamps to min when observed*multiplier is small", () => {
      const grace = computeAdaptiveGraceMs(policy, {
        observedLatencyMs: 100,
        sampleCount: 1,
      });
      expect(grace).toBe(policy.minReplyGraceMs);
    });

    it("scales linearly in the middle of the range", () => {
      const grace = computeAdaptiveGraceMs(policy, {
        observedLatencyMs: 20_000,
        sampleCount: 3,
      });
      // 20_000 * 1.45 = 29_000, within [12_000, 90_000]
      expect(grace).toBe(29_000);
    });

    it("clamps to max when observed latency is huge", () => {
      const grace = computeAdaptiveGraceMs(policy, {
        observedLatencyMs: 10_000_000,
        sampleCount: 10,
      });
      expect(grace).toBe(policy.maxReplyGraceMs);
    });
  });

  describe("MessagePriorityQueue", () => {
    it("drains urgent items before normal items", () => {
      const q = new MessagePriorityQueue();
      q.enqueue({ text: "n1", priority: "normal", createdAt: 1 });
      q.enqueue({ text: "u1", priority: "urgent", createdAt: 2 });
      q.enqueue({ text: "l1", priority: "low", createdAt: 3 });
      expect(q.dequeue()?.text).toBe("u1");
      expect(q.dequeue()?.text).toBe("n1");
      expect(q.dequeue()?.text).toBe("l1");
      expect(q.dequeue()).toBeUndefined();
    });

    it("preserves FIFO within a priority level", () => {
      const q = new MessagePriorityQueue();
      q.enqueue({ text: "a", priority: "normal", createdAt: 1 });
      q.enqueue({ text: "b", priority: "normal", createdAt: 2 });
      expect(q.dequeue()?.text).toBe("a");
      expect(q.dequeue()?.text).toBe("b");
    });

    it("exposes size, peek, snapshot, and clear", () => {
      const q = new MessagePriorityQueue();
      q.enqueue({ text: "x", priority: "normal", createdAt: 1 });
      expect(q.size).toBe(1);
      expect(q.peek()?.text).toBe("x");
      expect(q.snapshot().length).toBe(1);
      q.clear();
      expect(q.size).toBe(0);
    });
  });
});
