import { connectDaemon, hasErrorCode } from "../daemon-client.js";
import { error, info } from "../display.js";

/**
 * Stream terminal bytes from a running agent. Ctrl+C detaches cleanly
 * without stopping the underlying agent. Unit 2 owns the daemon-side
 * producer; until that lands we surface the `unimplemented` error.
 */
export async function handleAttach(agentId: string): Promise<void> {
  if (!agentId) {
    error("missing agent id");
    process.exitCode = 1;
    return;
  }

  let client;
  try {
    client = await connectDaemon({ noReconnect: true });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  client.attachTerminal((_id, bytes) => {
    process.stdout.write(Buffer.from(bytes));
  });

  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const detach = async () => {
    client.attachTerminal(null);
    await client.close().catch(() => {});
    info(`detached from ${agentId}`);
    resolveDone();
  };
  process.once("SIGINT", async () => {
    await detach();
    process.exit(0);
  });

  try {
    await client.call("agent.attach", { agentId });
  } catch (err) {
    if (hasErrorCode(err, "unimplemented")) {
      error("agent.attach is not implemented yet — the daemon-side streaming producer lands in the next unit.");
    } else if (hasErrorCode(err, "not_found")) {
      error(`agent not found: ${agentId}`);
    } else {
      error(err instanceof Error ? err.message : String(err));
    }
    await detach();
    process.exitCode = 1;
    return;
  }

  await done;
}
