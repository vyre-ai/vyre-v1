// How the daemon knows a visitor address came from its own relay (lane r42-mcp, 19 Nov 2026). The relay client forwards each visitor's request to the daemon over the loopback and writes the address it saw in
// x-vyre-visitor. Caddy, any local proxy and any process on the host reach the same loopback and may pass or write that header, so the relay also writes a MAC of that exact value, made with a secret the daemon
// creates when it starts and keeps in memory (the relay client runs in this process; the secret is in no header, file or log). The daemon believes the visitor value only when its MAC checks out; a value with no
// MAC, or with one made for another value, is ignored and the connection's own address stands.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The header that carries the MAC of the visitor value. */
export const PROOF_HEADER = "x-vyre-visitor-mac";
const SECRET = randomBytes(32);

const mac = (visitor: string): string => createHmac("sha256", SECRET).update(`vyre-visitor\n${visitor}`).digest("hex");

/** What the relay writes into PROOF_HEADER for the visitor value it writes. */
export const proofFor = (visitor: string): string => mac(visitor);

/** Does this MAC belong to exactly this visitor value? */
export function provesVisitor(visitor: unknown, proof: unknown): boolean {
  if (typeof visitor !== "string" || typeof proof !== "string" || proof.length !== 64) return false;
  return timingSafeEqual(Buffer.from(mac(visitor)), Buffer.from(proof));
}
