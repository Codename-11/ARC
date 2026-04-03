import { error } from "../display.js";

export function failCli(message: string): never {
  error(message);
  process.exit(1);
}
