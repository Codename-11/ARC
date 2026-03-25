import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["@napi-rs/keyring", "@inquirer/prompts"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
