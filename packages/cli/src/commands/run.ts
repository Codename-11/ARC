import { handleLaunch } from "./launch.js";

/**
 * `arc run <tool> [args...]` — thin alias for `arc launch --bare <tool>`.
 *
 * Skips all profile resolution and env injection. The named binary is
 * launched with the ambient environment so ARC behaves as optional
 * orchestration rather than a required wrapper.
 */
export async function handleRun(
  tool: string,
  args: string[],
  opts?: { beforeSpawn?: () => void | Promise<void> }
): Promise<void> {
  // Delegate to handleLaunch in bare mode. The first positional to
  // handleLaunch is the "name" slot; bare mode consumes it as the tool.
  await handleLaunch(tool, [tool, ...args], {
    bare: true,
    tool,
    beforeSpawn: opts?.beforeSpawn,
  });
}
