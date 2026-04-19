import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  sourcemap: false,
  // Unminified so Node's ESM loader can follow dynamic `require()` calls
  // inside CJS deps (ws, better-sqlite3). The minified helper mangles them.
  minify: false,
  // Bundle our workspace siblings (so no pre-build step is required on
  // their dists) but let Node resolve real third-party deps from
  // node_modules at runtime.
  noExternal: ["@axiom-labs/arc-core", "@axiom-labs/arc-client"],
  external: ["ws", "better-sqlite3", "zod", "@napi-rs/keyring"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
