import { hasErrorCode, withDaemonClient } from "../daemon-client.js";
import { error, success } from "../display.js";

export async function handleSend(agentId: string, text: string): Promise<void> {
  if (!agentId) {
    error("missing agent id");
    process.exitCode = 1;
    return;
  }
  if (!text) {
    error("missing message text");
    process.exitCode = 1;
    return;
  }

  await withDaemonClient(async (client) => {
    try {
      await client.agents.send({ agentId, text });
      success(`sent to ${agentId}`);
    } catch (err) {
      if (hasErrorCode(err, "unimplemented")) {
        error("agent.send is not implemented yet — the daemon-side lifecycle lands in the next unit.");
      } else {
        error(err instanceof Error ? err.message : String(err));
      }
      process.exitCode = 1;
    }
  });
}
