/**
 * Standalone daemon entrypoint.
 *
 * Used as the ENTRYPOINT for the `ghcr.io/axiom-labs/arc-daemon` Docker
 * image and as the `arc-daemon` bin for headless installs that don't want
 * the full CLI. Runs in the foreground only; the richer `arc daemon start`
 * command handles backgrounding / status / logs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon, type DaemonOptions } from "./bootstrap.js";

interface ParsedArgs {
  port?: number;
  host?: string;
  arcDir?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      // Accepted for compatibility with the richer `arc daemon start`
      // command; this binary is foreground-only, so the flag is a no-op.
      case "-f":
      case "--foreground":
        break;
      case "--port": {
        const next = argv[++i];
        if (!next) throw new Error("--port requires a value");
        const port = Number.parseInt(next, 10);
        if (!Number.isFinite(port) || port <= 0 || port > 65535) {
          throw new Error(`invalid --port value: ${next}`);
        }
        out.port = port;
        break;
      }
      case "--host": {
        const next = argv[++i];
        if (!next) throw new Error("--host requires a value");
        out.host = next;
        break;
      }
      case "--arc-dir": {
        const next = argv[++i];
        if (!next) throw new Error("--arc-dir requires a value");
        out.arcDir = next;
        break;
      }
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      default:
        if (arg && arg.startsWith("-")) {
          throw new Error(`unknown flag: ${arg}`);
        }
        break;
    }
  }
  return out;
}

function readPkgVersion(): string {
  try {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP_TEXT = `arc-daemon — ARC daemon standalone entrypoint (foreground only)

Usage:
  arc-daemon [--port <n>] [--host <addr>] [--arc-dir <path>]

Flags:
  -f, --foreground      Accepted for compatibility; this binary always
                        runs in the foreground.
      --port <n>        TCP port to bind. Default: 7272 (or $ARC_PORT).
      --host <addr>     Host to bind. Default: 127.0.0.1 (or $ARC_HOST).
                        Use 0.0.0.0 in containers if exposing to LAN.
      --arc-dir <path>  ARC state directory. Default: $ARC_DIR or ~/.arc.
  -h, --help            Show this help.
  -v, --version         Print daemon version and exit.

Security:
  The daemon only accepts connections whose HTTP Host header resolves to a
  loopback address. To reach it from another machine, put it behind an
  authenticated reverse proxy or add the remote host to the allow-list.
`;

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`arc-daemon: ${(err as Error).message}\n`);
    process.stderr.write(HELP_TEXT);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const version = readPkgVersion();

  if (args.version) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const opts: DaemonOptions = { version };
  if (args.port !== undefined) opts.port = args.port;
  if (args.host !== undefined) opts.host = args.host;
  if (args.arcDir !== undefined) opts.arcDir = args.arcDir;

  try {
    const handle = await startDaemon(opts);
    process.stdout.write(
      `arc-daemon listening on ${handle.config.host}:${handle.config.port} ` +
        `(arcDir=${handle.config.arcDir})\n`,
    );
  } catch (err) {
    process.stderr.write(`arc-daemon: failed to start — ${(err as Error).message}\n`);
    process.exit(1);
  }

  // startDaemon installs SIGINT/SIGTERM handlers that exit(0) on shutdown;
  // this promise keeps the event loop alive until then.
  await new Promise<void>(() => {});
}

main().catch((err: Error) => {
  process.stderr.write(`arc-daemon: unhandled error — ${err.message}\n`);
  process.exit(1);
});
