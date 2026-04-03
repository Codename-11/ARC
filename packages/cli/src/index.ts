import { createProgram } from "./cli.js";
import { error } from "./display.js";

export * from "./cli.js";

export async function runCli(argv = process.argv): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    return 1;
  }
}
