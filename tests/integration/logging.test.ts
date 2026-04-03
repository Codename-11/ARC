import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempArcDir } from "../fixtures/setup.js";

let arcDir: string;
let cleanup: () => void;
let originalArcDir: string | undefined;

beforeEach(() => {
  originalArcDir = process.env["ARC_DIR"];
  const tmp = createTempArcDir();
  arcDir = tmp.arcDir;
  cleanup = tmp.cleanup;
  process.env["ARC_DIR"] = arcDir;
});

afterEach(() => {
  cleanup();
  if (originalArcDir !== undefined) process.env["ARC_DIR"] = originalArcDir;
  else delete process.env["ARC_DIR"];
});

describe("structured logging", () => {
  it("writes and filters structured log entries", async () => {
    const { logAction, logEvent, getLogEntries } = await import("../../src/log.js");

    logAction("profile:create", "work", {
      component: "profile",
      profile: "work",
    });
    logEvent({
      level: "warn",
      component: "health",
      event: "health.quick",
      profile: "work",
      detail: "Credentials missing",
    });

    const allEntries = getLogEntries({ limit: 10 });
    const healthEntries = getLogEntries({ component: "health", limit: 10 });

    expect(allEntries.length).toBeGreaterThanOrEqual(2);
    expect(healthEntries).toHaveLength(1);
    expect(healthEntries[0]?.action).toBe("health.quick");
    expect(healthEntries[0]?.detail ?? healthEntries[0]?.message).toContain("Credentials missing");
  });
});
