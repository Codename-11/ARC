import { hasErrorCode, withDaemonClient } from "../daemon-client.js";
import { error, success } from "../display.js";

// Named `stop-agent.ts` to avoid clashing with the `daemon stop` handler.
export async function handleStopAgent(agentId: string): Promise<void> {
  if (!agentId) {
    error("missing agent id");
    process.exitCode = 1;
    return;
  }

  await withDaemonClient(async (client) => {
    try {
      await client.agents.stop({ agentId });
      success(`stopped ${agentId}`);
    } catch (err) {
      if (hasErrorCode(err, "unimplemented")) {
        error("agent.stop is not implemented yet — the daemon-side lifecycle lands in the next unit.");
      } else {
        error(err instanceof Error ? err.message : String(err));
      }
      process.exitCode = 1;
    }
  });
}
