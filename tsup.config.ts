import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["@napi-rs/keyring", "@inquirer/prompts"],
  noExternal: ["@axiom-labs/arc-core", "@axiom-labs/arc-adapter-claude", "@axiom-labs/arc-adapter-openclaw"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
