import { createProgram } from "./cli.js";
import { error } from "./display.js";

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
    process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  }
}

void main();
