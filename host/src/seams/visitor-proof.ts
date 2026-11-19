// How the daemon knows a visitor address came from its own relay (lane r42-mcp, 19 Nov 2026). The relay client forwards each visitor's request to the daemon over the loopback and writes the address it saw in
// x-vyre-visitor. A local reverse proxy or a process on the host can reach the same loopback and write that header too, so the relay also writes a secret that exists only in this process; the daemon believes the
// visitor header only with it, and nothing leaves the process with it. The secret is never logged and changes at every start.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const PROOF_HEADER = "x-vyre-relay-proof";
const SECRET = randomBytes(32).toString("hex");

/** The value the relay writes into PROOF_HEADER. */
export const relayProof = (): string => SECRET;

/** Does this header value prove the request came through this process's relay? */
export function provesRelay(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== SECRET.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(SECRET));
}
