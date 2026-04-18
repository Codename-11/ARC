import { describe, it, expect } from "vitest";
import {
  FEATURES_INDEX,
  getFeature,
  getFeaturesByStatus,
} from "../../../packages/core/src/knowledge/feature-index.js";

describe("FEATURES_INDEX", () => {
  it("contains the roundtable feature and its core orchestration siblings", () => {
    const ids = FEATURES_INDEX.map((f) => f.id);
    for (const required of [
      "roundtable",
      "shared-layer",
      "hook-pipeline",
      "telemetry",
      "profile-management",
      "profile-inheritance",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("entries have unique ids", () => {
    const ids = FEATURES_INDEX.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("entries have a valid status", () => {
    for (const f of FEATURES_INDEX) {
      expect(["shipped", "roadmap", "deferred"]).toContain(f.status);
      expect(f.summary.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getFeature", () => {
  it("finds features by exact id", () => {
    const f = getFeature("roundtable");
    expect(f).toBeDefined();
    expect(f?.name).toBe("Roundtable");
  });

  it("finds features by exact name (case-insensitive)", () => {
    const f = getFeature("Shared Layer");
    expect(f?.id).toBe("shared-layer");
    const f2 = getFeature("shared layer");
    expect(f2?.id).toBe("shared-layer");
  });

  it("does fuzzy matching on normalized id/name", () => {
    expect(getFeature("shared_layer")?.id).toBe("shared-layer");
    expect(getFeature("HookPipeline")?.id).toBe("hook-pipeline");
    // partial
    expect(getFeature("roundtab")?.id).toBe("roundtable");
  });

  it("returns undefined for garbage", () => {
    expect(getFeature("xyz-not-a-feature-zzz")).toBeUndefined();
    expect(getFeature("")).toBeUndefined();
  });
});

describe("getFeaturesByStatus", () => {
  it("returns only shipped features when asked", () => {
    const shipped = getFeaturesByStatus("shipped");
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.every((f) => f.status === "shipped")).toBe(true);
  });

  it("returns roadmap features when asked", () => {
    const roadmap = getFeaturesByStatus("roadmap");
    // At least one roadmap entry is seeded (ai-assistant).
    expect(roadmap.length).toBeGreaterThan(0);
    expect(roadmap.every((f) => f.status === "roadmap")).toBe(true);
  });
});
