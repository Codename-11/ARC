import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __ARC_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
  },
});
