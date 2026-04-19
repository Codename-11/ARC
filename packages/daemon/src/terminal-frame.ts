/**
 * Terminal-channel payload format shared between the WS session layer and
 * the agent runtime. Channel-1 frames are prefixed with a 36-byte ASCII
 * UUID identifying the source agent, followed by raw byte payload.
 */

export const TERMINAL_ID_LEN = 36;

export function encodeTerminalPayload(agentId: string, bytes: Uint8Array): Uint8Array {
  const id = agentId.length === TERMINAL_ID_LEN
    ? agentId
    : agentId.padEnd(TERMINAL_ID_LEN, " ").slice(0, TERMINAL_ID_LEN);
  const idBytes = new TextEncoder().encode(id);
  const out = new Uint8Array(TERMINAL_ID_LEN + bytes.length);
  out.set(idBytes, 0);
  out.set(bytes, TERMINAL_ID_LEN);
  return out;
}

export function decodeTerminalPayload(buf: Uint8Array): { agentId: string; bytes: Uint8Array } {
  if (buf.length < TERMINAL_ID_LEN) {
    return { agentId: "", bytes: buf };
  }
  const agentId = new TextDecoder().decode(buf.subarray(0, TERMINAL_ID_LEN));
  const bytes = buf.subarray(TERMINAL_ID_LEN);
  return { agentId, bytes };
}
