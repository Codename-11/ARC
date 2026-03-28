import { spawn } from "child_process";
import { watch } from "fs";
import { resolve } from "path";

const srcDir = resolve(import.meta.dirname, "..", "src");
let child = null;
let debounce = null;

function start() {
  child = spawn("node", ["--import", "tsx", "src/index.ts", "dashboard"], {
    stdio: "inherit",
    cwd: resolve(import.meta.dirname, ".."),
  });
  child.on("exit", () => { child = null; });
}

function restart() {
  if (child) {
    child.on("exit", () => start());
    child.kill();
  } else {
    start();
  }
}

watch(srcDir, { recursive: true }, (_event, filename) => {
  if (!filename?.match(/\.[tj]sx?$/)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.clear();
    console.log(`\x1b[2m[dev] ${filename} changed, restarting...\x1b[0m`);
    restart();
  }, 300);
});

start();
