import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@axiom-labs/arc-core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@axiom-labs/arc-adapter-claude": path.resolve(__dirname, "packages/adapter-claude/src/index.ts"),
      "@axiom-labs/arc-adapter-openclaw": path.resolve(__dirname, "packages/adapter-openclaw/src/index.ts"),
      "@axiom-labs/arc-mcp": path.resolve(__dirname, "packages/mcp/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
