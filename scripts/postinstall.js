#!/usr/bin/env node

// Suppress Node 24 DEP0190 warning triggered by pnpm's shell-based script runner.
// This is a pnpm-internal issue — our script does not spawn child processes.
process.removeAllListeners("warning");

// Skip during CI or non-interactive installs
if (process.env.CI || !process.stderr.isTTY) process.exit(0);

const R = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const BL = "\x1b[34m";
const WH = "\x1b[37m";
const GR = "\x1b[32m";
const CY = "\x1b[36m";

console.error();
console.error(`  ${BL}███╗${WH}██╗${BL} ███╗     █████╗ ██████╗  ██████╗        ${WH}██╗ ██╗${R}`);
console.error(`  ${BL}██╔╝${WH}╚██╗${BL}╚██║    ██╔══██╗██╔══██╗██╔════╝       ${WH}██╔╝██╔╝${R}`);
console.error(`  ${BL}██║  ${WH}╚██╗${BL}██║    ███████║██████╔╝██║           ${WH}██╔╝██╔╝${R}`);
console.error(`  ${BL}██║  ${WH}██╔╝${BL}██║    ██╔══██║██╔══██╗██║          ${WH}██╔╝██╔╝${R}`);
console.error(`  ${BL}███╗${WH}██╔╝${BL}███║    ██║  ██║██║  ██║╚██████╗    ${WH}██╔╝██╔╝${R}`);
console.error(`  ${BL}╚══╝${WH}╚═╝${BL} ╚══╝    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ${WH}╚═╝ ╚═╝${R}`);
console.error();
console.error(`  ${D}Agent Runtime Control${R}  ${GR}✔ Installed${R}`);
console.error();
console.error(`  ${B}Get started:${R}`);
console.error(`  ${CY}arc${R}          Open the TUI (onboarding wizard on first run)`);
console.error(`  ${CY}arc setup${R}    Set up PATH and shell integration`);
console.error(`  ${CY}arc --help${R}   View all commands`);
console.error();
console.error(`  ${D}arc-cli.dev${R}`);
console.error();
