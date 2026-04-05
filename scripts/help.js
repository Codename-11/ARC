#!/usr/bin/env node
// pnpm run help — Show available dev commands with descriptions

const sections = [
  {
    title: "DEVELOP",
    cmds: [
      ["dev", "Run CLI from source"],
      ["dev:tui", "TUI dashboard from source"],
      ["dev:tui:watch", "TUI with hot-reload"],
      ["dev:dashboard", "Web dashboard on :3700 (hot-reload)"],
      ["dev:watch", "CLI with hot-reload (tsup watch)"],
      ["dev:docs", "Docs site on :5173"],
      ["site:dev", "Landing site on :5173"],
      ["web", "Landing + docs concurrently (:5173 + :5174)"],
    ],
  },
  {
    title: "BUILD",
    cmds: [
      ["build", "Production CLI bundle → dist/"],
      ["site:build", "Landing site → site/dist/"],
      ["build:docs", "Docs → user-docs/.vitepress/dist/"],
      ["web:build", "Build landing + docs"],
      ["web:merge", "Build + merge into _site/"],
      ["web:preview", "Build + merge + serve on :4000"],
    ],
  },
  {
    title: "TEST",
    cmds: [
      ["test", "Run all tests"],
      ["test:watch", "Tests with hot-reload"],
      ["typecheck", "TypeScript strict check"],
    ],
  },
  {
    title: "INSTALL / LINK",
    cmds: [
      ["link:global", "Build + link as global `arc` (pnpm)"],
      ["link:global:npm", "Build + link as global `arc` (npm)"],
      ["unlink:global", "Remove global pnpm link"],
      ["install:local", "Build + install shims to ~/.local/bin"],
      ["uninstall:local", "Remove local shims"],
    ],
  },
  {
    title: "RELEASE",
    cmds: [
      ["version:set", "Set version (syncs version.ts + package.json)"],
      ["tag", "Create + push git tag for current version"],
      ["tag:repush", "Force re-push existing tag"],
      ["cli", "Run built CLI from dist/"],
      ["cli:dev", "Run CLI from source (same as dev)"],
    ],
  },
  {
    title: "CLEANUP",
    cmds: [
      ["teardown", "Remove shims + unlink"],
      ["teardown:force", "Remove everything including ~/.arc data"],
    ],
  },
];

const maxCmd = Math.max(...sections.flatMap((s) => s.cmds.map(([c]) => c.length)));

console.log("\n  \x1b[1mARC — Available Commands\x1b[0m\n");

for (const section of sections) {
  console.log(`  \x1b[2m${section.title}\x1b[0m`);
  for (const [cmd, desc] of section.cmds) {
    const pad = " ".repeat(maxCmd - cmd.length + 2);
    console.log(`    \x1b[36mpnpm ${cmd}\x1b[0m${pad}\x1b[2m${desc}\x1b[0m`);
  }
  console.log();
}
