import { describe, it, expect } from "vitest";
import {
  AgentWatchdog,
  isLowSignalWatchdogReply,
  WATCHDOG_STALL_OPTIONS,
  type WatchdogEvent,
} from "../../../packages/core/src/orchestration/watchdog.js";

describe("isLowSignalWatchdogReply", () => {
  it("flags short status filler", () => {
    expect(isLowSignalWatchdogReply("still working")).toBe(true);
    expect(isLowSignalWatchdogReply("looking into it")).toBe(true);
    expect(isLowSignalWatchdogReply("status update:")).toBe(true);
  });

  it("flags no-progress status indicators", () => {
    expect(
      isLowSignalWatchdogReply(
        "Current status: conversation remains idle; awaiting a concrete task.",
      ),
    ).toBe(true);
  });

  it("treats concrete progress updates as high-signal", () => {
    expect(
      isLowSignalWatchdogReply(
        "Implemented the orchestrator and wired up the delivery policy; all tests pass.",
      ),
    ).toBe(false);
  });

  it("flags empty strings", () => {
    expect(isLowSignalWatchdogReply("")).toBe(true);
    expect(isLowSignalWatchdogReply("   ")).toBe(true);
  });
});

describe("AgentWatchdog", () => {
  function makeClock(startMs: number) {
    let t = startMs;
    return {
      now: () => t,
      advance: (delta: number) => {
        t += delta;
      },
    };
  }

  it("emits a nudge after the nudge threshold", () => {
    const clock = makeClock(1_000_000);
    const nudges: Array<{ agentId: string; text: string }> = [];
    const events: WatchdogEvent[] = [];

    const dog = new AgentWatchdog({
      now: clock.now,
      nudgeAfterMs: 3_000,
      stallAfterMs: 5_000,
      isAgentActive: () => true,
      getLastMessageAt: () => 1_000_000, // agent never spoke after start
      postDecision: () => {},
      postNudge: (id, text) => nudges.push({ agentId: id, text }),
      onEvent: (evt) => events.push(evt),
    });

    dog.track("alice");
    // below threshold
    clock.advance(2_500);
    expect(dog.tick()).toEqual([]);
    expect(nudges).toHaveLength(0);

    // past threshold
    clock.advance(1_000);
    const fired = dog.tick();
    expect(fired).toHaveLength(1);
    expect(fired[0].type).toBe("nudge");
    expect(fired[0].agentId).toBe("alice");
    expect(nudges).toHaveLength(1);
    expect(events.some((e) => e.type === "nudge")).toBe(true);
  });

  it("emits stall + decision after the stall threshold past nudge", () => {
    const clock = makeClock(0);
    const decisions: Array<{ agentId: string; options: readonly string[] }> = [];

    const dog = new AgentWatchdog({
      now: clock.now,
      nudgeAfterMs: 1_000,
      stallAfterMs: 2_000,
      isAgentActive: () => true,
      getLastMessageAt: () => 0,
      postDecision: (id, options) => decisions.push({ agentId: id, options }),
    });

    dog.track("bob");

    // First tick past nudge → nudge
    clock.advance(1_500);
    const firstEvents = dog.tick();
    expect(firstEvents.some((e) => e.type === "nudge")).toBe(true);

    // Not yet past stall
    clock.advance(1_000);
    const midEvents = dog.tick();
    expect(midEvents).toEqual([]);

    // Past stall
    clock.advance(1_500);
    const stallEvents = dog.tick();
    expect(stallEvents.some((e) => e.type === "stall")).toBe(true);
    expect(stallEvents.some((e) => e.type === "decision")).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].options).toEqual(WATCHDOG_STALL_OPTIONS);
  });

  it("reset() clears nudge marker so nudges fire again", () => {
    const clock = makeClock(0);
    const dog = new AgentWatchdog({
      now: clock.now,
      nudgeAfterMs: 1_000,
      stallAfterMs: 2_000,
      isAgentActive: () => true,
      getLastMessageAt: () => 0,
      postDecision: () => {},
    });
    dog.track("carol");
    clock.advance(2_000);
    dog.tick(); // nudge

    dog.reset("carol");
    expect(dog.snapshot().carol).toEqual({});

    clock.advance(2_000);
    const events = dog.tick();
    expect(events.some((e) => e.type === "nudge")).toBe(true);
  });

  it("skips agents flagged inactive by the host", () => {
    const clock = makeClock(0);
    const dog = new AgentWatchdog({
      now: clock.now,
      nudgeAfterMs: 1_000,
      stallAfterMs: 2_000,
      isAgentActive: () => false,
      getLastMessageAt: () => 0,
      postDecision: () => {},
    });
    dog.track("ghost");
    clock.advance(10_000);
    expect(dog.tick()).toEqual([]);
  });
});
