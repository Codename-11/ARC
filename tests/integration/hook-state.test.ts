import { describe, it, expect, beforeEach } from "vitest";
import { HookStateStore } from "@axiom-labs/arc-core";

describe("HookStateStore", () => {
  let store: HookStateStore;

  beforeEach(() => {
    store = new HookStateStore();
  });

  // ─── get/set roundtrip ────────────────────────────────────────────

  it("round-trips a value through set then get", () => {
    store.set("sess-1", "attempt-tracker", "count", 3);
    expect(store.get("sess-1", "attempt-tracker", "count")).toBe(3);
  });

  it("round-trips complex objects", () => {
    const audit = { status: "partial", confidence: 0.6 };
    store.set("sess-1", "audit-score", "lastAudit", audit);
    expect(store.get("sess-1", "audit-score", "lastAudit")).toEqual(audit);
  });

  // ─── missing keys ─────────────────────────────────────────────────

  it("returns undefined for a missing key in an existing scope", () => {
    store.set("sess-1", "hook-a", "existing", true);
    expect(store.get("sess-1", "hook-a", "missing")).toBeUndefined();
  });

  it("returns undefined for a completely unknown scope", () => {
    expect(store.get("no-session", "no-hook", "no-key")).toBeUndefined();
  });

  // ─── session isolation ────────────────────────────────────────────

  it("isolates state between different sessions", () => {
    store.set("sess-1", "tracker", "count", 1);
    store.set("sess-2", "tracker", "count", 99);

    expect(store.get("sess-1", "tracker", "count")).toBe(1);
    expect(store.get("sess-2", "tracker", "count")).toBe(99);
  });

  it("isolates state between different hooks in the same session", () => {
    store.set("sess-1", "hook-a", "value", "alpha");
    store.set("sess-1", "hook-b", "value", "beta");

    expect(store.get("sess-1", "hook-a", "value")).toBe("alpha");
    expect(store.get("sess-1", "hook-b", "value")).toBe("beta");
  });

  // ─── clear ────────────────────────────────────────────────────────

  it("clear() removes all state for a session", () => {
    store.set("sess-1", "hook-a", "x", 1);
    store.set("sess-1", "hook-b", "y", 2);

    store.clear("sess-1");

    expect(store.get("sess-1", "hook-a", "x")).toBeUndefined();
    expect(store.get("sess-1", "hook-b", "y")).toBeUndefined();
  });

  it("clear() does not affect other sessions", () => {
    store.set("sess-1", "tracker", "count", 1);
    store.set("sess-2", "tracker", "count", 2);

    store.clear("sess-1");

    expect(store.get("sess-1", "tracker", "count")).toBeUndefined();
    expect(store.get("sess-2", "tracker", "count")).toBe(2);
  });

  // ─── type-safe get<T> ─────────────────────────────────────────────

  it("get<T> returns correctly typed values", () => {
    store.set("sess-1", "hook", "str", "hello");
    store.set("sess-1", "hook", "num", 42);
    store.set("sess-1", "hook", "bool", true);
    store.set("sess-1", "hook", "arr", [1, 2, 3]);

    const str = store.get<string>("sess-1", "hook", "str");
    const num = store.get<number>("sess-1", "hook", "num");
    const bool = store.get<boolean>("sess-1", "hook", "bool");
    const arr = store.get<number[]>("sess-1", "hook", "arr");

    expect(str).toBe("hello");
    expect(num).toBe(42);
    expect(bool).toBe(true);
    expect(arr).toEqual([1, 2, 3]);
  });

  // ─── overwrite ────────────────────────────────────────────────────

  it("set overwrites an existing value", () => {
    store.set("sess-1", "hook", "count", 1);
    store.set("sess-1", "hook", "count", 5);
    expect(store.get("sess-1", "hook", "count")).toBe(5);
  });
});
