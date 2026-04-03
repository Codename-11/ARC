import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifestPath = path.resolve(
  __dirname,
  "../../packages/adapter-openclaw/openclaw.plugin.json",
);

describe("OpenClaw plugin manifest", () => {
  it("openclaw.plugin.json is valid JSON", () => {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has required fields: id, configSchema', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest).toHaveProperty("id");
    expect(manifest).toHaveProperty("configSchema");
  });

  it('id is "arc"', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.id).toBe("arc");
  });

  it("configSchema is a valid JSON Schema with expected properties", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const schema = manifest.configSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties.profileName).toBeDefined();
    expect(schema.properties.profileName.type).toBe("string");
    expect(schema.required).toContain("profileName");
  });

  it("configSchema includes enforcementMode enum", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const schema = manifest.configSchema;
    expect(schema.properties.enforcementMode).toBeDefined();
    expect(schema.properties.enforcementMode.type).toBe("string");
    expect(schema.properties.enforcementMode.enum).toEqual(
      expect.arrayContaining(["strict", "permissive", "audit"]),
    );
  });
});
