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
  // a MAC is 64 lower-case hex digits and nothing else: any other header value (non-ASCII, wrong length) is refused before a byte is compared, so no header a client sends can make the comparison throw
  if (typeof visitor !== "string" || typeof proof !== "string" || !/^[0-9a-f]{64}$/.test(proof)) return false;
  try {
    return timingSafeEqual(Buffer.from(mac(visitor), "hex"), Buffer.from(proof, "hex"));
  } catch {
    return false;
  }
}

const VISITOR_HEADER = "x-vyre-visitor";
const verified = new WeakMap<object, string>();
const isLoopback = (a: string | undefined): boolean => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";

/**
 * The first thing the daemon does with every request: read the visitor the relay vouched for, then remove both headers, so they exist only on the relay-to-daemon hop and no route, proxy, site or outbound fetch
 * ever sees or forwards them. The visitor is kept for this request only when it came over the loopback with a MAC that checks out for that exact value; a client-written header, with no MAC or a wrong one, is dropped.
 */
export function takeVisitor(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string | undefined } }): void {
  try {
    const said = req.headers[VISITOR_HEADER];
    const proof = req.headers[PROOF_HEADER];
    if (isLoopback(req.socket.remoteAddress) && typeof said === "string" && said !== "" && provesVisitor(said, proof))
      verified.set(req, said.slice(0, 64));
  } catch {
    /* whatever a client sent, the request goes on keyed by its address and never takes the daemon down */
  }
  delete req.headers[VISITOR_HEADER];
  delete req.headers[PROOF_HEADER];
}

/** Who is asking, for the per-visitor limits: the address the relay vouched for, else the connection's own. */
export function visitorOfRequest(req: { socket: { remoteAddress?: string | undefined } }): string {
  return verified.get(req) ?? req.socket.remoteAddress ?? "";
}

/** Did the relay vouch for this request's visitor? */
export const verifiedVisitor = (req: object): boolean => verified.has(req);
