import { runCli } from "../packages/cli/src/index.js";

void runCli().then((code) => process.exit(code));
